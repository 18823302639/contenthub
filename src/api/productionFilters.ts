import { productionRiskLabel } from '../types/schema'
import type { ProductionItem } from '../types/schema'
import type { ProductionFilters } from './contracts'

export function matchesProductionFilters(item: ProductionItem, { trackTag, minScore, status, risk }: ProductionFilters): boolean {
  return (trackTag === undefined || item.track_tag === trackTag) &&
    (minScore === undefined || (item.score !== null && item.score >= minScore)) &&
    (status === undefined || item.workflow_status === status) &&
    (risk === undefined || (productionRiskLabel(item.compliance_risk) ?? item.compliance_risk) === risk)
}
