import type { ReactNode } from 'react'

type Tab<T extends string> = { value: T; label: string }

export const editorialTabs = [
  { value: 'article', label: '图文正文' },
  { value: 'script', label: '视频口播稿' },
  { value: 'remotion', label: 'Remotion 渲染数据' },
  { value: 'sources', label: '原始信源与大纲' },
] as const

export type EditorialTab = (typeof editorialTabs)[number]['value']

export function Tabs<T extends string>({ group, label, options, value, select, panelId, className = 'wb-tabs' }: {
  group: string
  className?: string
  label: string
  panelId?: (value: T) => string
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
          aria-controls={panelId?.(tab.value) ?? `${group}-panel`}
          tabIndex={value === tab.value ? 0 : -1}
          onClick={() => select(tab.value)}
        >{tab.label}</button>
      ))}
    </div>
  )
}

export function EditorialPanels({ group, value, select, tabsClassName, panelClassName, children }: {
  group: string
  value: EditorialTab
  select: (value: EditorialTab) => void
  tabsClassName: string
  panelClassName: string
  children: ReactNode
}) {
  const panelId = (tab: EditorialTab) => `${group}-${tab}-panel`
  return (
    <>
      <Tabs group={group} label="精修内容" options={editorialTabs} value={value}
        select={select} className={tabsClassName} panelId={panelId} />
      {editorialTabs.map(tab => (
        <div key={tab.value} id={panelId(tab.value)} role="tabpanel" aria-labelledby={`${group}-${tab.value}`}
          className={panelClassName} hidden={tab.value !== value} tabIndex={tab.value === 'sources' ? 0 : undefined}>
          {tab.value === value ? children : null}
        </div>
      ))}
    </>
  )
}
