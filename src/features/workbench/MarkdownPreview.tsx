import Markdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { externalUrl } from '../../utils/externalUrl'

const components: Components = {
  a: ({ href, children }) => {
    const url = href && externalUrl(href)
    if (url) return <a href={url} target="_blank" rel="noopener noreferrer">{children}</a>
    if (href?.startsWith('#') && href.length > 1) {
      return <a href={href} onClick={event => {
        event.preventDefault()
        document.getElementById(href.slice(1))?.scrollIntoView({ block: 'nearest' })
      }}>{children}</a>
    }
    return <span>{children}</span>
  },
  img: ({ alt }) => <span>{alt ? `［图片：${alt}］` : '［图片］'}</span>,
  table: ({ children }) => <div className="markdown-table"><table>{children}</table></div>,
}

export function MarkdownPreview({ text }: { text: string }) {
  return (
    <div className="markdown-preview">
      <Markdown skipHtml remarkPlugins={[remarkGfm]} components={components}>{text}</Markdown>
    </div>
  )
}
