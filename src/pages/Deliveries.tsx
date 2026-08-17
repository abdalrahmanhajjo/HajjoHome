import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n, pick } from '../i18n/i18n'
import PageHeader from '../components/PageHeader'

type DeliveryStatus = 'pending' | 'scheduled' | 'delivered' | 'failed' | 'cancelled'
const STATUS: { value: DeliveryStatus; ar: string; en: string; badge: string }[] = [
  { value: 'pending', ar: 'قيد الانتظار', en: 'Pending', badge: 'badge--muted' },
  { value: 'scheduled', ar: 'مجدول', en: 'Scheduled', badge: 'badge--info' },
  { value: 'delivered', ar: 'تم التسليم', en: 'Delivered', badge: 'badge--ok' },
  { value: 'failed', ar: 'فشل', en: 'Failed', badge: 'badge--danger' },
  { value: 'cancelled', ar: 'ملغى', en: 'Cancelled', badge: 'badge--muted' },
]
const label = (s: string) => { const x = STATUS.find((x) => x.value === s); return x ? pick(x.ar, x.en) : s }
const badge = (s: string) => STATUS.find((x) => x.value === s)?.badge ?? 'badge--muted'

interface DeliveryRowT {
  id: string
  order_id: string
  status: string
  scheduled_at: string | null
  delivered_at: string | null
  address: string | null
  area: string | null
  driver_name: string | null
  orders: { code: string; customers: { full_name: string } | null } | null
}

export default function Deliveries() {
  const { t } = useI18n()
  const [rows, setRows] = useState<DeliveryRowT[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    setLoading(true)
    const { data, error } = await supabase
      .from('deliveries')
      .select('id, order_id, status, scheduled_at, delivered_at, address, area, driver_name, orders(code, customers(full_name))')
      .order('created_at', { ascending: false })
      .limit(300)
    if (error) setError(error.message)
    else setRows((data ?? []) as unknown as DeliveryRowT[])
    setLoading(false)
  }
  useEffect(() => { void reload() }, [])

  if (loading) return <span className="spinner" />

  return (
    <div>
      <PageHeader
        eyebrow={t('العمليات', 'Operations')}
        title={t('التوصيل والتركيب', 'Delivery & installation')}
        subtitle={t(`${rows.length} توصيلة`, `${rows.length} deliveries`)}
      />
      {error && <div className="alert alert--danger">{error}</div>}

      <CreateDelivery onDone={reload} />

      <div className="card mt-4">
        <div className="card__header">{t('التوصيلات', 'Deliveries')}</div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t('الفاتورة', 'Invoice')}</th><th>{t('الزبون', 'Customer')}</th><th>{t('المنطقة', 'Area')}</th>
                <th>{t('السائق', 'Driver')}</th><th>{t('الموعد', 'Scheduled')}</th><th>{t('الحالة', 'Status')}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => <DeliveryRow key={d.id} d={d} onSaved={reload} onError={setError} />)}
              {rows.length === 0 && <tr><td colSpan={7}><div className="empty">{t('لا توصيلات.', 'No deliveries.')}</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function DeliveryRow({ d, onSaved, onError }: { d: DeliveryRowT; onSaved: () => void; onError: (m: string) => void }) {
  const { t } = useI18n()
  const [status, setStatus] = useState<DeliveryStatus>(d.status as DeliveryStatus)
  const [driver, setDriver] = useState(d.driver_name ?? '')
  const [scheduled, setScheduled] = useState(d.scheduled_at ? d.scheduled_at.slice(0, 10) : '')
  const [busy, setBusy] = useState(false)
  const dirty = status !== d.status || driver !== (d.driver_name ?? '') || scheduled !== (d.scheduled_at ? d.scheduled_at.slice(0, 10) : '')

  async function save() {
    setBusy(true)
    const patch: Record<string, unknown> = {
      status, driver_name: driver.trim() || null,
      scheduled_at: scheduled ? new Date(scheduled).toISOString() : null,
    }
    if (status === 'delivered' && !d.delivered_at) patch.delivered_at = new Date().toISOString()
    const { error } = await supabase.from('deliveries').update(patch).eq('id', d.id)
    setBusy(false)
    if (error) onError(error.message)
    else onSaved()
  }

  return (
    <tr>
      <td className="num">{d.orders?.code ?? '—'}</td>
      <td>{d.orders?.customers?.full_name ?? '—'}</td>
      <td>{d.area ?? '—'}</td>
      <td><input className="input" style={{ minWidth: 120 }} value={driver} onChange={(e) => setDriver(e.target.value)} /></td>
      <td><input className="input num" dir="ltr" type="date" value={scheduled} onChange={(e) => setScheduled(e.target.value)} /></td>
      <td>
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value as DeliveryStatus)}>
          {STATUS.map((s) => <option key={s.value} value={s.value}>{t(s.ar, s.en)}</option>)}
        </select>
        <span className={`badge ${badge(d.status)}`} style={{ marginInlineStart: 6 }}>{label(d.status)}</span>
      </td>
      <td><button className="btn btn--sm btn--primary" disabled={!dirty || busy} onClick={() => void save()}>{busy ? <span className="spinner" /> : t('حفظ', 'Save')}</button></td>
    </tr>
  )
}

function CreateDelivery({ onDone }: { onDone: () => void }) {
  const { t } = useI18n()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null); setMsg(null)
    const c = code.trim().toUpperCase()
    if (!c) return setError(t('أدخل رقم الفاتورة', 'Enter an invoice code'))
    setBusy(true)
    const { data: ord, error: oErr } = await supabase
      .from('orders')
      .select('id, customers(address, area)')
      .eq('code', c)
      .maybeSingle()
    if (oErr || !ord) { setBusy(false); return setError(oErr?.message || t('لم يُعثر على الفاتورة', 'Invoice not found')) }
    type Cust = { address: string | null; area: string | null }
    const row = ord as unknown as { id: string; customers: Cust | Cust[] | null }
    const cust = Array.isArray(row.customers) ? row.customers[0] ?? null : row.customers
    const { error } = await supabase.from('deliveries').insert({
      order_id: row.id, status: 'pending',
      address: cust?.address ?? null, area: cust?.area ?? null,
    })
    setBusy(false)
    if (error) return setError(error.message)
    setCode(''); setMsg(t('تم إنشاء التوصيل', 'Delivery created'))
    onDone()
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="card__body row" style={{ alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 1 }}>
          <label>{t('إنشاء توصيل لفاتورة', 'Create a delivery for an invoice')}</label>
          <input className="input num" dir="ltr" placeholder="S-000123" value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <button className="btn btn--primary" disabled={busy}>{busy ? <span className="spinner" /> : t('إنشاء', 'Create')}</button>
        {error && <div className="alert alert--danger" style={{ flexBasis: '100%' }}>{error}</div>}
        {msg && <div className="alert alert--ok" style={{ flexBasis: '100%' }}>{msg}</div>}
      </div>
    </form>
  )
}
