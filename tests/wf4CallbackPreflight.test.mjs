import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const script = fileURLToPath(new URL('../scripts/wf4-callback-preflight.mjs', import.meta.url))
const active = { id: 42, render_job_id: 'job-new', render_status: 'rendering' }
const callback = { record_id: 42, jobId: 'job-new', status: 'completed' }

function run(mode, input) {
  const result = spawnSync(process.execPath, [script, mode], {
    input: JSON.stringify(input), encoding: 'utf8', timeout: 5000,
  })
  return { exit: result.status, result: JSON.parse(result.stdout || 'null') }
}

it('拒绝 #96 形状的两条无标识输入，无匹配写回', () => {
  const input = { items: [{ json: {} }, { json: {} }], records: [active] }
  expect(run('check', input)).toEqual({
    exit: 1, result: { reason: 'invalid_item_count', eligibleWrites: 0 },
  })
})

it.each([
  { status: 'completed' },
  { ...callback, record_id: true },
  { ...callback, record_id: null },
  { ...callback, record_id: '4.2e1' },
])('拒绝缺失或不合法的记录 ID %j', payload => {
  expect(run('check', { items: [{ json: { body: payload } }], records: [active] })).toEqual({
    exit: 1, result: { reason: 'invalid_record_id', eligibleWrites: 0 },
  })
})

it('匹配有效任务时只允许一条记录，并兼容十进制数字字符串', () => {
  const otherRecord = { ...active, id: 43 }
  const input = {
    items: [{ json: { body: { ...callback, record_id: '42' } } }],
    records: [otherRecord, active],
  }
  expect(run('check', input)).toEqual({
    exit: 0, result: { reason: 'matching_active_job', eligibleWrites: 1 },
  })
})

it.each([
  ['没有匹配记录', callback, [{ ...active, id: 43 }], 'no_unique_record'],
  ['同一记录存在两条候选', callback, [active, active], 'no_unique_record'],
  ['缺少 jobId', { ...callback, jobId: null }, [active], 'invalid_job_id'],
  ['迟到的旧任务', { ...callback, jobId: 'job-old' }, [active], 'job_mismatch'],
  ['重复完成回调', callback, [{ ...active, render_status: 'completed' }], 'inactive_job'],
  ['重复失败回调', { ...callback, status: 'failed' }, [{ ...active, render_status: 'failed' }], 'inactive_job'],
])('%s 时不会产生写回候选', (_name, payload, records, reason) => {
  expect(run('check', { items: [payload], records })).toEqual({
    exit: 1, result: { reason, eligibleWrites: 0 },
  })
})

it('从解析节点回溯实际连接，列出紧邻上游及其两个入口', () => {
  const parser = '解析渲染回调数据'
  const edge = (node, index = 0) => ({ node, type: 'main', index })
  const input = {
    nodes: [
      { name: '接收回调', type: 'n8n-nodes-base.webhook' },
      { name: '发起渲染', type: 'n8n-nodes-base.webhook' },
      { name: '合并数据', type: 'n8n-nodes-base.merge' },
      { name: parser, type: 'n8n-nodes-base.code' },
    ],
    connections: {
      接收回调: { main: [[edge('合并数据')]] },
      发起渲染: { main: [[edge('合并数据', 1)]] },
      合并数据: { main: [[], [edge(parser)]] },
    },
  }
  expect(run('trace', input)).toEqual({
    exit: 0,
    result: {
      incoming: [{ node: '合并数据', output: 1, input: 0 }],
      entries: [
        { name: '接收回调', type: 'n8n-nodes-base.webhook' },
        { name: '发起渲染', type: 'n8n-nodes-base.webhook' },
      ],
    },
  })
})
