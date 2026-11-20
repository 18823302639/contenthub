export class ApiHttpError extends Error {
  constructor(readonly service: string, readonly status: number) {
    super(`${service} 请求失败（HTTP ${status}）。`)
    this.name = 'ApiHttpError'
  }
}

export async function request(
  fetcher: typeof fetch,
  service: string,
  url: string,
  options: RequestInit,
): Promise<Response> {
  let response: Response
  try {
    // 避免重定向时将令牌或写入请求发送到其他地址。
    response = await fetcher(url, { ...options, redirect: 'error' })
  } catch (cause) {
    throw new Error(`${service} 请求未收到响应，执行结果未知。`, { cause })
  }

  if (!response.ok) throw new ApiHttpError(service, response.status)
  return response
}
