const r2Host = /^(?:[a-z0-9][a-z0-9.-]*\.)?[a-f0-9]{32}(?:\.(?:eu|fedramp))?\.r2\.cloudflarestorage\.com$/

function onlyParam(params: URLSearchParams, key: string) {
  const values = params.getAll(key)
  return values.length === 1 ? values[0] : undefined
}

function signedWindow(params: URLSearchParams) {
  const stamp = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(onlyParam(params, 'X-Amz-Date') ?? '')
  const duration = onlyParam(params, 'X-Amz-Expires') ?? ''
  if (!stamp || !/^\d{1,6}$/.test(duration) || Number(duration) < 1 || Number(duration) > 604_800 ||
    !onlyParam(params, 'X-Amz-Signature')) return null

  const [, year, month, day, hours, minutes, seconds] = stamp
  const date = year + '-' + month + '-' + day + 'T' + hours + ':' + minutes + ':' + seconds + '.000Z'
  const start = Date.parse(date)
  if (!Number.isFinite(start) || new Date(start).toISOString() !== date) return null
  return { start, expiry: start + Number(duration) * 1000 }
}

function r2Attachment(url: URL, now: number) {
  if (url.protocol !== 'https:' || url.port || url.hash || url.pathname === '/' || !r2Host.test(url.hostname)) return null
  const params = url.searchParams
  const window = signedWindow(params)
  if (!window || now < window.start ||
    onlyParam(params, 'X-Amz-Algorithm') !== 'AWS4-HMAC-SHA256' ||
    !/^[a-f0-9]{64}$/i.test(onlyParam(params, 'X-Amz-Signature') ?? '') ||
    !/^[^/]+\/\d{8}\/[^/]+\/s3\/aws4_request$/.test(onlyParam(params, 'X-Amz-Credential') ?? '') ||
    onlyParam(params, 'X-Amz-SignedHeaders') !== 'host' ||
    (params.has('x-id') && onlyParam(params, 'x-id') !== 'GetObject') ||
    !/^attachment(?:\s*;|$)/i.test((onlyParam(params, 'response-content-disposition') ?? '').trim())) return null

  return window
}

type Download = { url: string; expiry?: number; sameOrigin: boolean }

export function selectVideoDownload(video: string | null, attachment: string | null, declaredExpiry: string | undefined, now: number) {
  const candidates: Download[] = []
  if (attachment && attachment !== video) {
    const url = new URL(attachment, window.location.href)
    const explicit = Date.parse(declaredExpiry?.replace(' ', 'T') ?? '')
    const signed = signedWindow(url.searchParams)
    const expiry = Math.min(Number.isFinite(explicit) ? explicit : Infinity, signed?.expiry ?? Infinity)
    candidates.push({ url: attachment, expiry: Number.isFinite(expiry) ? expiry : undefined, sameOrigin: url.origin === window.location.origin })
  }
  if (video) {
    const url = new URL(video, window.location.href)
    if (url.origin === window.location.origin) candidates.push({ url: video, sameOrigin: true })
    else {
      const signed = r2Attachment(url, now)
      if (signed) candidates.push({ url: video, expiry: signed.expiry, sameOrigin: false })
    }
  }
  const download = candidates.find(candidate => candidate.expiry === undefined || now < candidate.expiry)
  return { download, expired: !download && candidates.some(candidate => candidate.expiry !== undefined) }
}
