import type { ProductionItem } from '../types/schema'
import type { ProductionFilters } from './contracts'

export function matchesProductionFilters(item: ProductionItem, { trackTag, minScore, status }: ProductionFilters): boolean {
  return (trackTag === undefined || item.track_tag === trackTag) &&
    (minScore === undefined || (item.score !== null && item.score >= minScore)) &&
    (status === undefined || item.workflow_status === status)
}
