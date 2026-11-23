import type { JsonObject, JsonValue } from '../../types/schema'

export function remotionText(value: JsonObject | string | null | undefined) {
  return typeof value === 'string' ? value : value ? JSON.stringify(value, null, 2) : ''
}

export function parseRemotion(input: string): {
  value: JsonObject | null
  error: string | null
  missingSources: string[]
} {
  const empty = { value: null, error: null, missingSources: [] }
  if (!input.trim()) return empty

  let value: JsonValue
  try {
    value = JSON.parse(input)
  } catch (error) {
    return { ...empty, error: 'JSON 语法错误。' + (error instanceof Error ? error.message : '') }
  }
  if (value === null) return empty
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ...empty, error: 'Remotion JSON 顶层应为对象。' }
  }

  const missingSources: string[] = []
  for (const key of ['scenes', 'cards'] as const) {
    const rows = value[key]
    if (!Object.hasOwn(value, key)) continue
    if (!Array.isArray(rows)) {
      missingSources.push(key + ' 应为数组')
      continue
    }
    rows.forEach((item, index) => {
      const source = item && typeof item === 'object' && !Array.isArray(item) ? item.source : null
      if (typeof source !== 'string' || !source.trim()) missingSources.push(`${key}[${index}].source`)
    })
  }
  return { value, error: null, missingSources }
}

export function sameRemotion(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (left === right) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left)) {
    return Array.isArray(right) && left.length === right.length && left.every((item, index) => sameRemotion(item, right[index]))
  }
  return !Array.isArray(right) && Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every(key => Object.hasOwn(right, key) && sameRemotion(left[key], right[key]))
}
