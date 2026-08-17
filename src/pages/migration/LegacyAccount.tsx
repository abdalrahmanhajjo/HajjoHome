import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { useI18n } from '../../i18n/i18n'
import { formatNumber, formatDate } from '../../lib/format'

interface OrderRow {
  id: string; code: string; product_description: string | null; brand: string | null; model: string | null
  total_amount: number | null; paid_amount: number | null; order_date: string | null; date_precision: string
}
interface PayRow {
  id: string; amount: number | null; payment_date: string | null; payment_method: string | null; migration_order_id: string | null
}

const PRECISION = [
  { v: 'exact', ar: 'تاريخ دقيق', en: 'Exact' },
  { v: 'month_year', ar: 'شهر/سنة', en: 'Month/Year' },
  { v: 'year_only', ar: 'سنة فقط', en: 'Year only' },
  { v: 'unknown', ar: 'غير معروف', en: 'Unknown' },
]
const METHODS = [
  { v: 'cash', ar: 'نقدًا', en: 'Cash' }, { v: 'transfer', ar: 'حوالة', en: 'Transfer' },
  { v: 'card', ar: 'بطاقة', en: 'Card' }, { v: 'check', ar: 'شيك', en: 'Check' },
  { v: 'installment', ar: 'قسط', en: 'Installment' }, { v: 'other', ar: 'أخرى', en: 'Other' },
  { v: 'unknown', ar: 'غير معروف', en: 'Unknown' },
]

export default function LegacyAccount({ migrationCustomerId }: { migrationCustomerId: string }) {
  const { t, lang } = useI18n()
  const { profile } = useAuth()
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [pays, setPays] = useState<PayRow[]>([])
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    const [o, p] = await Promise.all([
      supabase.from('migration_orders').select('id, code, product_description, brand, model, total_amount, paid_amount, order_date, date_precision').eq('migration_customer_id', migrationCustomerId).order('created_at'),
      supabase.from('migration_payments').select('id, amount, payment_date, payment_method, migration_order_id').eq('migration_customer_id', migrationCustomerId).order('created_at'),
    ])
    if (o.error || p.error) setError((o.error || p.error)!.message)
    setOrders((o.data ?? []) as OrderRow[])
    setPays((p.data ?? []) as PayRow[])
  }
  useEffect(() => { void reload() }, [migrationCustomerId])

  return (
    <div className="card mt-4">
      <div className="card__header">{t('الحساب القديم (طلبات ودفعات)', 'Legacy account (orders & payments)')}</div>
      <div className="card__body">
        {error && <div className="alert alert--danger">{error}</div>}

        <div className="grid grid--2">
          <AddOrder migId={migrationCustomerId} enteredBy={profile?.id ?? null} onDone={reload} t={t} lang={lang} />
          <AddPayment migId={migrationCustomerId} orders={orders} enteredBy={profile?.id ?? null} onDone={reload} t={t} lang={lang} />
        </div>

        <h3 className="small muted mt-4">{t('الطلبات', 'Orders')}</h3>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{t('الرقم', 'Code')}</th><th>{t('الوصف', 'Description')}</th><th className="num">{t('الإجمالي', 'Total')}</th><th className="num">{t('المدفوع', 'Paid')}</th><th className="num">{t('التاريخ', 'Date')}</th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="num">{o.code}</td>
                  <td>{[o.product_description, o.brand, o.model].filter(Boolean).join(' — ') || '—'}</td>
                  <td className="num">{o.total_amount != null ? formatNumber(o.total_amount, 2) : '—'}</td>
                  <td className="num">{o.paid_amount != null ? formatNumber(o.paid_amount, 2) : '—'}</td>
                  <td className="num">{o.order_date ? formatDate(o.order_date) : t('غير معروف', 'Unknown')}</td>
                </tr>
              ))}
              {orders.length === 0 && <tr><td colSpan={5}><div className="empty">{t('لا طلبات.', 'No orders.')}</div></td></tr>}
            </tbody>
          </table>
        </div>

        <h3 className="small muted mt-4">{t('الدفعات', 'Payments')}</h3>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th className="num">{t('المبلغ', 'Amount')}</th><th>{t('الطريقة', 'Method')}</th><th className="num">{t('التاريخ', 'Date')}</th></tr></thead>
            <tbody>
              {pays.map((p) => (
                <tr key={p.id}>
                  <td className="num">{p.amount != null ? formatNumber(p.amount, 2) : '—'}</td>
                  <td>{METHODS.find((m) => m.v === p.payment_method)?.[lang] ?? p.payment_method ?? '—'}</td>
                  <td className="num">{p.payment_date ? formatDate(p.payment_date) : t('غير معروف', 'Unknown')}</td>
                </tr>
              ))}
              {pays.length === 0 && <tr><td colSpan={3}><div className="empty">{t('لا دفعات.', 'No payments.')}</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

type TFn = (ar: string, en?: string) => string

function AddOrder({ migId, enteredBy, onDone, t }: { migId: string; enteredBy: string | null; onDone: () => void; t: TFn; lang: 'ar' | 'en' }) {
  const [desc, setDesc] = useState(''); const [total, setTotal] = useState(''); const [paid, setPaid] = useState('')
  const [date, setDate] = useState(''); const [precision, setPrecision] = useState('unknown')
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null)
    if (!desc.trim() && !total) return setError(t('أدخل وصف الطلب أو قيمته', 'Enter a description or total'))
    setBusy(true)
    const { error } = await supabase.from('migration_orders').insert({
      migration_customer_id: migId, product_description: desc.trim() || null,
      total_amount: total ? Number(total) : null, paid_amount: paid ? Number(paid) : null,
      order_date: date || null, date_precision: precision, status: 'data_entry', entered_by: enteredBy,
    })
    setBusy(false)
    if (error) return setError(error.message)
    setDesc(''); setTotal(''); setPaid(''); setDate(''); setPrecision('unknown'); onDone()
  }

  return (
    <form className="card" onSubmit={submit} style={{ background: 'var(--c-surface-2)' }}>
      <div className="card__body">
        <strong className="small">{t('إضافة طلب قديم', 'Add legacy order')}</strong>
        {error && <div className="alert alert--danger mt-2">{error}</div>}
        <div className="field mt-2"><label>{t('الوصف (براد Samsung…)', 'Description')}</label><input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
        <div className="row">
          <div className="field"><label>{t('الإجمالي', 'Total')}</label><input className="input num" dir="ltr" value={total} onChange={(e) => setTotal(e.target.value)} /></div>
          <div className="field"><label>{t('المدفوع', 'Paid')}</label><input className="input num" dir="ltr" value={paid} onChange={(e) => setPaid(e.target.value)} /></div>
        </div>
        <div className="row">
          <div className="field"><label>{t('التاريخ', 'Date')}</label><input className="input num" dir="ltr" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="field"><label>{t('دقة التاريخ', 'Date precision')}</label>
            <select className="select" value={precision} onChange={(e) => setPrecision(e.target.value)}>
              {PRECISION.map((p) => <option key={p.v} value={p.v}>{t(p.ar, p.en)}</option>)}
            </select>
          </div>
        </div>
        <button className="btn btn--primary btn--sm" disabled={busy}>{busy ? <span className="spinner" /> : t('إضافة الطلب', 'Add order')}</button>
      </div>
    </form>
  )
}

function AddPayment({ migId, orders, enteredBy, onDone, t }: { migId: string; orders: OrderRow[]; enteredBy: string | null; onDone: () => void; t: TFn; lang: 'ar' | 'en' }) {
  const [amount, setAmount] = useState(''); const [date, setDate] = useState('')
  const [method, setMethod] = useState('cash'); const [orderId, setOrderId] = useState('')
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null)
    if (!amount || !(Number(amount) > 0)) return setError(t('أدخل مبلغًا صحيحًا', 'Enter a valid amount'))
    setBusy(true)
    const { error } = await supabase.from('migration_payments').insert({
      migration_customer_id: migId, migration_order_id: orderId || null,
      amount: Number(amount), payment_date: date || null, payment_method: method,
      status: 'data_entry', entered_by: enteredBy,
    })
    setBusy(false)
    if (error) return setError(error.message)
    setAmount(''); setDate(''); setMethod('cash'); setOrderId(''); onDone()
  }

  return (
    <form className="card" onSubmit={submit} style={{ background: 'var(--c-surface-2)' }}>
      <div className="card__body">
        <strong className="small">{t('إضافة دفعة قديمة', 'Add legacy payment')}</strong>
        {error && <div className="alert alert--danger mt-2">{error}</div>}
        <div className="row mt-2">
          <div className="field"><label>{t('المبلغ', 'Amount')}</label><input className="input num" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div className="field"><label>{t('التاريخ', 'Date')}</label><input className="input num" dir="ltr" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <div className="row">
          <div className="field"><label>{t('الطريقة', 'Method')}</label>
            <select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
              {METHODS.map((m) => <option key={m.v} value={m.v}>{t(m.ar, m.en)}</option>)}
            </select>
          </div>
          <div className="field"><label>{t('على طلب (اختياري)', 'On order (optional)')}</label>
            <select className="select" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
              <option value="">{t('غير محدد', 'Unlinked')}</option>
              {orders.map((o) => <option key={o.id} value={o.id}>{o.code}</option>)}
            </select>
          </div>
        </div>
        <button className="btn btn--primary btn--sm" disabled={busy}>{busy ? <span className="spinner" /> : t('إضافة الدفعة', 'Add payment')}</button>
      </div>
    </form>
  )
}
