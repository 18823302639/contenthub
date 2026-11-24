type Tab<T extends string> = { value: T; label: string }

export const editorialTabs = [
  { value: 'article', label: '图文正文' },
  { value: 'script', label: '视频口播稿' },
  { value: 'remotion', label: 'Remotion 渲染数据' },
  { value: 'sources', label: '原始信源与大纲' },
] as const

export type EditorialTab = (typeof editorialTabs)[number]['value']

export function Tabs<T extends string>({ group, label, options, value, select, className = 'wb-tabs' }: {
  group: string
  className?: string
  label: string
  options: readonly Tab<T>[]
  value: T
  select: (value: T) => void
}) {
  return (
    <div className={className} role="tablist" aria-label={label} onKeyDown={event => {
      const current = options.findIndex(tab => tab.value === value)
      let next: number
      switch (event.key) {
        case 'ArrowLeft': next = (current + options.length - 1) % options.length; break
        case 'ArrowRight': next = (current + 1) % options.length; break
        case 'Home': next = 0; break
        case 'End': next = options.length - 1; break
        default: return
      }
      event.preventDefault()
      select(options[next].value)
      event.currentTarget.querySelectorAll('button')[next]?.focus()
    }}>
      {options.map(tab => (
        <button
          key={tab.value}
          type="button"
          id={`${group}-${tab.value}`}
          role="tab"
          aria-selected={value === tab.value}
          aria-controls={`${group}-panel`}
          tabIndex={value === tab.value ? 0 : -1}
          onClick={() => select(tab.value)}
        >{tab.label}</button>
      ))}
    </div>
  )
}
