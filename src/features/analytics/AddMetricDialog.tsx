import { X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, RefObject } from 'react'
import type { NewAccountMetric } from '../../api'
import { platforms } from '../../types/schema'
import type { Platform, ProductionItem } from '../../types/schema'
import { calendarDay, calendarDayStart, isCalendarDay, metricDay } from '../../utils/metricDays'
import { isCount, isPercentage } from './review'

const numericFields = [
  { key: 'impressions', label: '新增展现量', step: '1', min: '0' },
  { key: 'views', label: '新增阅读量', step: '1', min: '0' },
  { key: 'ctr', label: '平台 CTR（%）', step: 'any', min: '0', max: '100' },
  { key: 'completion_rate', label: '平台完读率（%）', step: 'any', min: '0', max: '100' },
  { key: 'revenue', label: '单日收益（元）', step: 'any' },
] as const

export function AddMetricDialog({
  opener, articles, platform, pendingInput, error, operation, onClose, onSave, onVerify,
}: {
  opener: RefObject<HTMLButtonElement>
  articles: ProductionItem[]
  platform: Platform
  pendingInput: NewAccountMetric | null
  error: string | null
  operation: 'saving' | 'checking' | null
  onClose: () => void
  onSave: (input: NewAccountMetric) => Promise<void>
  onVerify: () => Promise<void>
}) {
  const uid = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const firstField = useRef<HTMLSelectElement>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const today = calendarDay(Date.now())

  useEffect(() => {
    const popup = dialog.current
    if (!popup) return
    popup.showModal()
    if (firstField.current?.matches(':disabled')) popup.querySelector<HTMLButtonElement>('.source-dialog-close')?.focus()
    else firstField.current?.focus()
    return () => {
      popup.close()
      opener.current?.focus()
    }
  }, [opener])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (operation || pendingInput) return
    const form = event.currentTarget
    const fields = new FormData(form)
    const number = (name: string) => {
      const raw = String(fields.get(name) ?? '').trim()
      return raw ? Number(raw) : Number.NaN
    }
    const article = articles.find(item => item.id === Number(fields.get('production_id')))
    const platform = platforms.find(item => item === fields.get('platform'))
    const day = String(fields.get('day') ?? '')
    const impressions = number('impressions')
    const views = number('views')
    const ctr = number('ctr')
    const completion_rate = number('completion_rate')
    const revenue = number('revenue')
    const errors: Record<string, string> = {}

    if (!article) errors.production_id = '请选择已发布内容。'
    if (!platform) errors.platform = '请选择平台。'
    if (!isCalendarDay(day) || day > calendarDay(Date.now())) errors.day = '请选择今天或更早的有效日期。'
    if (!isCount(impressions)) errors.impressions = '请输入非负整数展现量。'
    if (!isCount(views)) errors.views = '请输入非负整数阅读量。'
    if (!isPercentage(ctr)) errors.ctr = '请输入平台填报的 0–100 CTR。'
    if (!isPercentage(completion_rate)) errors.completion_rate = '请输入平台填报的 0–100 完读率。'
    if (!Number.isFinite(revenue)) errors.revenue = '请输入有效的当日收益。'
    setErrors(errors)

    const firstInvalid = Object.keys(errors)[0]
    if (firstInvalid) {
      const control = form.elements.namedItem(firstInvalid)
      if (control instanceof HTMLElement) control.focus()
      return
    }
    if (!article || !platform) return

    void onSave({
      production_id: article.id, title: article.zh_title, platform, recorded_at: calendarDayStart(day),
      impressions, views, ctr, completion_rate, revenue,
    })
  }

  function fieldAttributes(key: string) {
    return {
      id: uid + '-' + key, name: key, required: true, 'aria-invalid': Boolean(errors[key]),
      'aria-describedby': errors[key] ? uid + '-error-' + key : undefined,
    }
  }

  function errorFor(key: string) {
    return errors[key] && <p className="source-field-error" id={uid + '-error-' + key}>{errors[key]}</p>
  }

  return (
    <dialog ref={dialog} className="source-dialog analytics-dialog" aria-modal="true"
      aria-labelledby={uid + '-title'} aria-describedby={uid + '-notes'} onCancel={event => {
        event.preventDefault()
        onClose()
      }}>
      <header className="source-dialog-header">
        <h2 id={uid + '-title'}>录入运营数据</h2>
        <button className="button button--quiet source-dialog-close" type="button" aria-label="关闭弹窗" onClick={onClose}>
          <X size={18} aria-hidden />
        </button>
      </header>
      <form className="source-form" noValidate onSubmit={submit}>
        <p className="metric-entry-notes" id={uid + '-notes'}>
          仅填写这一天的新增数据，请勿填写累计数。缺失项请留空，待数据齐全后再保存。
        </p>
        <fieldset disabled={operation !== null || pendingInput !== null}>
          <div className="source-field metric-entry-wide">
            <label htmlFor={uid + '-production_id'}>已发布内容</label>
            <select {...fieldAttributes('production_id')} ref={firstField} defaultValue={pendingInput?.production_id ?? ''}>
              <option value="">选择内容</option>
              {articles.map(item => <option key={item.id} value={item.id}>{item.zh_title}</option>)}
            </select>
            {errorFor('production_id')}
          </div>
          <div className="source-field">
            <label htmlFor={uid + '-platform'}>平台</label>
            <select {...fieldAttributes('platform')} defaultValue={pendingInput?.platform ?? platform}>
              {platforms.map(item => <option key={item}>{item}</option>)}
            </select>
            {errorFor('platform')}
          </div>
          <div className="source-field">
            <label htmlFor={uid + '-day'}>日期（UTC+8）</label>
            <input {...fieldAttributes('day')} type="date" max={today} defaultValue={pendingInput ? metricDay(pendingInput.recorded_at) ?? today : today} />
            {errorFor('day')}
          </div>
          {numericFields.map(field => (
            <div className="source-field" key={field.key}>
              <label htmlFor={uid + '-' + field.key}>{field.label}</label>
              <input {...fieldAttributes(field.key)} type="number" step={field.step}
                min={'min' in field ? field.min : undefined} max={'max' in field ? field.max : undefined}
                defaultValue={pendingInput?.[field.key] ?? ''} />
              {errorFor(field.key)}
            </div>
          ))}
        </fieldset>
        {error && <p className="topic-feedback topic-feedback--warning" role="alert">{error}</p>}
        {operation && <p className="topic-feedback" role="status">
          {operation === 'saving' ? '正在保存数据…' : '正在核对记录…'}
        </p>}
        <div className="source-dialog-actions">
          <button className="button button--secondary" type="button" onClick={onClose}>关闭</button>
          {pendingInput
            ? <button className="button button--primary" type="button" disabled={operation !== null} onClick={() => void onVerify()}>核对记录</button>
            : <button className="button button--primary" type="submit" disabled={operation !== null}>保存数据</button>}
        </div>
      </form>
    </dialog>
  )
}
