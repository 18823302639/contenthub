import { readFileSync } from 'node:fs'

const parserName = '解析渲染回调数据'
const activeStatuses = new Set(['queued', 'rendering'])
const terminalStatuses = new Set(['completed', 'failed'])

function asObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function checkCallback({ items, records }) {
  const reject = reason => ({ reason, eligibleWrites: 0 })
  if (!Array.isArray(items) || items.length !== 1) return reject('invalid_item_count')

  const item = asObject(items[0]) ?? {}
  const envelope = Object.hasOwn(item, 'json') ? (asObject(item.json) ?? {}) : item
  const payload = Object.hasOwn(envelope, 'body') ? (asObject(envelope.body) ?? {}) : envelope
  const rawId = payload.record_id
  const recordId = typeof rawId === 'string' && /^\d+$/.test(rawId) ? Number(rawId) : rawId
  if (!Number.isSafeInteger(recordId) || recordId <= 0) return reject('invalid_record_id')
  if (typeof payload.jobId !== 'string' || !payload.jobId.trim()) return reject('invalid_job_id')
  if (!terminalStatuses.has(payload.status)) return reject('invalid_callback_status')
  if (!Array.isArray(records)) return reject('invalid_record_snapshot')

  const candidates = records.filter(record => record?.id === recordId)
  if (candidates.length !== 1) return reject('no_unique_record')
  const [record] = candidates
  if (record.render_job_id !== payload.jobId) return reject('job_mismatch')
  if (!activeStatuses.has(record.render_status)) return reject('inactive_job')
  return { reason: 'matching_active_job', eligibleWrites: 1 }
}

function traceCallbackBranch({ nodes, connections }) {
  if (!Array.isArray(nodes) || !asObject(connections)) {
    throw new Error('invalid_workflow_graph')
  }
  const types = new Map(nodes.map(({ name, type }) => [name, type]))
  if (!types.has(parserName) || types.size !== nodes.length) throw new Error('invalid_workflow_graph')

  const incoming = new Map(nodes.map(({ name }) => [name, []]))
  for (const [source, outputs] of Object.entries(connections)) {
    if (!incoming.has(source)) throw new Error('invalid_workflow_graph')
    for (const [output, edges] of (outputs.main ?? []).entries()) {
      for (const { node, index } of edges ?? []) {
        if (!incoming.has(node) || !Number.isInteger(index) || index < 0) {
          throw new Error('invalid_workflow_graph')
        }
        incoming.get(node).push({ node: source, output, input: index })
      }
    }
  }

  const visited = new Set()
  const pending = [parserName]
  const entries = []
  while (pending.length) {
    const name = pending.shift()
    if (visited.has(name)) continue
    visited.add(name)
    const parents = incoming.get(name)
    if (!parents.length && name !== parserName) entries.push({ name, type: types.get(name) })
    pending.push(...parents.map(parent => parent.node))
  }
  return { incoming: incoming.get(parserName), entries }
}

try {
  const mode = process.argv[2]
  const fixture = JSON.parse(readFileSync(0, 'utf8'))
  if (mode === 'check') {
    const result = checkCallback(fixture)
    console.log(JSON.stringify(result))
    if (result.eligibleWrites === 0) process.exitCode = 1
  } else if (mode === 'trace') {
    console.log(JSON.stringify(traceCallbackBranch(fixture)))
  } else {
    throw new Error('invalid_mode')
  }
} catch {
  console.log(JSON.stringify({ reason: 'invalid_fixture_or_mode' }))
  process.exitCode = 2
}
