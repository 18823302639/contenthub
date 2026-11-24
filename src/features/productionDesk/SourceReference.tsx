import type { ProductionItem } from '../../types/schema'
import { externalUrl } from '../../utils/externalUrl'
import { MarkdownPreview } from '../workbench/MarkdownPreview'
import './sourceReference.css'

export function SourceReference({ record }: { record: ProductionItem }) {
  const url = externalUrl(record.url)
  const factCheck = record.fact_check_notes?.trim() || record.fact_check?.trim()
  const outline = record.ai_outline?.trim()

  return (
    <div className="desk-reference">
      <div>
        <h3>来源名称</h3><p>{record.source_name || '暂无来源名称。'}</p>
        <h3>原文标题</h3><p>{record.raw_title || '暂无原文标题。'}</p>
        {url
          ? <a className="topic-origin" href={url} target="_blank" rel="noopener noreferrer">打开原文</a>
          : <p>暂无可用原文链接。</p>}
      </div>
      <div><h3>事实核查备注</h3>{factCheck ? <MarkdownPreview text={factCheck} /> : <p>暂无事实核查备注。</p>}</div>
      <div><h3>AI 大纲</h3>{outline ? <MarkdownPreview text={outline} /> : <p>暂无大纲。</p>}</div>
      <div><h3>摘要与核心数据点</h3><p>{record.key_data_points || '暂无核心数据点。'}</p></div>
      <div><h3>原始素材</h3><p>{record.raw_content || '暂无原始素材。'}</p></div>
    </div>
  )
}
