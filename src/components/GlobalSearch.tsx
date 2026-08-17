import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../i18n/i18n'
import { phoneSearchDigits, displayPhone } from '../lib/phone'

type Kind = 'customer' | 'invoice' | 'receipt' | 'product'
interface Result { kind: Kind; id: string; title: string; sub: string; to: string; emoji: string }

const KIND_LABEL: Record<Kind, { ar: string; en: string }> = {
  customer: { ar: 'زبون', en: 'Customer' },
  invoice: { ar: 'فاتورة', en: 'Invoice' },
  receipt: { ar: 'إيصال', en: 'Receipt' },
  product: { ar: 'منتج', en: 'Product' },
}

export default function GlobalSearch() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const reqId = useRef(0)

  // اختصار: Ctrl/Cmd + K للتركيز على البحث
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // إغلاق عند النقر خارج الصندوق
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) { setResults([]); setLoading(false); return }
    const handle = setTimeout(() => void run(term), 220)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  async function run(term: string) {
    const myId = ++reqId.current
    setLoading(true)
    const safe = term.replace(/[%,()*]/g, ' ')
    const digits = phoneSearchDigits(term)
    const custOr = [`full_name.ilike.*${safe}*`, `code.ilike.*${safe}*`]
    if (digits) custOr.push(`phone.ilike.*${digits}*`)

    const [cust, ord, pay, prod] = await Promise.all([
      supabase.from('v_customer_balances').select('customer_id, code, full_name, phone').or(custOr.join(',')).limit(6),
      supabase.from('orders').select('id, code').ilike('code', `%${safe}%`).limit(5),
      supabase.from('payments').select('id, receipt_no').ilike('receipt_no', `%${safe}%`).limit(5),
      supabase.from('products').select('id, code, brand, model').eq('is_active', true)
        .or(`brand.ilike.*${safe}*,model.ilike.*${safe}*,code.ilike.*${safe}*`).limit(5),
    ])
    if (myId !== reqId.current) return

    const out: Result[] = []
    for (const c of (cust.data ?? []) as { customer_id: string; code: string; full_name: string; phone: string | null }[]) {
      out.push({ kind: 'customer', id: c.customer_id, title: c.full_name, sub: `${c.code} · ${displayPhone(c.phone)}`, to: `/customers/${c.customer_id}`, emoji: '👤' })
    }
    for (const o of (ord.data ?? []) as { id: string; code: string }[]) {
      out.push({ kind: 'invoice', id: o.id, title: o.code, sub: t('فاتورة', 'Invoice'), to: `/invoices/${o.id}`, emoji: '🧾' })
    }
    for (const p of (pay.data ?? []) as { id: string; receipt_no: string }[]) {
      out.push({ kind: 'receipt', id: p.id, title: p.receipt_no, sub: t('إيصال', 'Receipt'), to: `/receipts/${p.id}`, emoji: '💵' })
    }
    for (const p of (prod.data ?? []) as { id: string; code: string; brand: string | null; model: string | null }[]) {
      out.push({ kind: 'product', id: p.id, title: `${p.brand ?? ''} ${p.model ?? ''}`.trim() || p.code, sub: p.code, to: '/products', emoji: '📦' })
    }

    setResults(out)
    setActive(0)
    setLoading(false)
    setOpen(true)
  }

  function go(r: Result) {
    setOpen(false)
    setQuery('')
    setResults([])
    navigate(r.to)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); return }
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % results.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + results.length) % results.length) }
    else if (e.key === 'Enter') { e.preventDefault(); const r = results[active]; if (r) go(r) }
  }

  return (
    <div className="gsearch" ref={boxRef}>
      <input
        ref={inputRef}
        className="gsearch__input"
        placeholder={t('بحث سريع… (زبون، فاتورة، إيصال، منتج)', 'Quick search… (customer, invoice, receipt, product)')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => { if (results.length) setOpen(true) }}
        onKeyDown={onKeyDown}
        aria-label={t('بحث سريع', 'Quick search')}
      />
      {open && (
        <div className="gsearch__panel">
          {loading && <div className="gsearch__empty"><span className="spinner" /> {t('بحث…', 'Searching…')}</div>}
          {!loading && results.length === 0 && <div className="gsearch__empty">{t('لا نتائج', 'No results')}</div>}
          {results.map((r, i) => (
            <button
              key={`${r.kind}-${r.id}`}
              type="button"
              className={`gsearch__item ${i === active ? 'is-active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(r)}
            >
              <span className="gsearch__emoji" aria-hidden>{r.emoji}</span>
              <span className="gsearch__text">
                <span className="gsearch__title">{r.title}</span>
                <span className="gsearch__sub">{r.sub}</span>
              </span>
              <span className="gsearch__kind">{t(KIND_LABEL[r.kind].ar, KIND_LABEL[r.kind].en)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
