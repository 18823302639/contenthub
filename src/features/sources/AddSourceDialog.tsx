import { X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, RefObject } from 'react'
import type { NewRssSource } from '../../api'
import { poolTypes } from '../../types/schema'
import type { PoolType } from '../../types/schema'
import { poolLabels, rssUrl } from './sourceFields'

const fields = [
  { key: 'name', label: '信源名称', type: 'text', placeholder: '例如：零售行业简报' },
  { key: 'rss_url', label: 'RSS 链接', type: 'url', placeholder: 'https://example.invalid/feed.xml' },
  { key: 'track_tag', label: '赛道', type: 'text', placeholder: '例如：商业数据' },
] as const

type Field = (typeof fields)[number]['key']

export function AddSourceDialog({
  opener, defaultPool, pendingInput, error, saving, checking, unavailable, mayCheck,
  onCancel, onSave, onCheck, onOtherSource,
}: {
  opener: RefObject<HTMLButtonElement>
  defaultPool: PoolType
  pendingInput: NewRssSource | null
  error: string | null
  saving: boolean
  checking: boolean
  unavailable: boolean
  mayCheck: boolean
  onCancel: () => void
  onSave: (input: NewRssSource) => Promise<void>
  onCheck: () => Promise<void>
  onOtherSource: () => void
}) {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const firstField = useRef<HTMLInputElement>(null)
  const [values, setValues] = useState<NewRssSource>(() =>
    pendingInput ?? { name: '', rss_url: '', track_tag: '', pool_type: defaultPool, is_active: true })
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const busy = saving || checking
  const shown = pendingInput ?? values

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
    if (busy || pendingInput || unavailable) return

    const name = values.name.trim()
    const trackTag = values.track_tag.trim()
    const url = rssUrl(values.rss_url)
    const next: Partial<Record<Field, string>> = {}
    if (!name) next.name = '请输入信源名称。'
    if (!url) next.rss_url = '请输入有效的 HTTP(S) RSS 链接。'
    if (!trackTag) next.track_tag = '请输入赛道。'
    setErrors(next)

    const firstInvalid = fields.find(field => next[field.key])
    if (firstInvalid) {
      const control = event.currentTarget.elements.namedItem(firstInvalid.key)
      if (control instanceof HTMLElement) control.focus()
      return
    }
    if (!url) return

    void onSave({ ...values, name, track_tag: trackTag, rss_url: url })
  }

  return (
    <dialog
      className="source-dialog"
      ref={dialog}
      aria-labelledby={id + '-title'}
      aria-modal="true"
      onCancel={event => {
        event.preventDefault()
        onCancel()
      }}
    >
      <header className="source-dialog-header">
        <h2 id={id + '-title'}>新增 RSS 信源</h2>
        <button className="button button--quiet source-dialog-close" aria-label="关闭弹窗" type="button" onClick={onCancel}>
          <X size={18} aria-hidden />
        </button>
      </header>
      <form className="source-form" noValidate onSubmit={submit}>
        <fieldset disabled={busy || pendingInput !== null}>
          {fields.map(({ key, label, type, placeholder }) => (
            <div className="source-field" key={key}>
              <label htmlFor={id + '-' + key}>{label}</label>
              <input
                ref={key === 'name' ? firstField : undefined}
                id={id + '-' + key} name={key} type={type} required placeholder={placeholder}
                value={shown[key]}
                aria-invalid={Boolean(errors[key])}
                aria-describedby={errors[key] ? id + '-' + key + '-error' : undefined}
                onChange={event => {
                  setValues({ ...values, [key]: event.target.value })
                  setErrors({ ...errors, [key]: undefined })
                }}
              />
              {errors[key] && <p className="source-field-error" id={id + '-' + key + '-error'}>{errors[key]}</p>}
            </div>
          ))}
          <div className="source-field">
            <label htmlFor={id + '-pool'}>分组</label>
            <select id={id + '-pool'} required value={shown.pool_type}
              onChange={event => {
                const pool = poolTypes.find(choice => choice === event.target.value)
                if (pool) setValues({ ...values, pool_type: pool })
              }}>
              {poolTypes.map(pool => <option key={pool} value={pool}>{poolLabels[pool]}</option>)}
            </select>
          </div>
          <label className="source-activation">
            <input type="checkbox" checked={shown.is_active}
              onChange={event => setValues({ ...values, is_active: event.target.checked })} />
            <span>立即启用</span>
          </label>
        </fieldset>
        {error && <p className="topic-feedback topic-feedback--warning" role="alert">{error}</p>}
        {saving && <p className="topic-feedback" role="status">正在保存信源…</p>}
        {checking && <p className="topic-feedback" role="status">正在核对列表…</p>}
        <div className="source-dialog-actions">
          <button className="button button--secondary" type="button" onClick={onCancel}>取消</button>
          {pendingInput ? (
            <>
              <button className="button button--secondary" disabled={busy} type="button" onClick={onOtherSource}>
                新增其他信源
              </button>
              <button className="button button--primary" disabled={busy || !mayCheck} type="button" onClick={() => void onCheck()}>
                核对列表
              </button>
            </>
          ) : (
            <button className="button button--primary" type="submit" disabled={busy || unavailable}>保存信源</button>
          )}
        </div>
      </form>
    </dialog>
  )
}
