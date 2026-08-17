import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../i18n/i18n'
import PageHeader from '../components/PageHeader'
import { formatUsd, formatDate, formatNumber, orderLabel, installmentLabel } from '../lib/format'
import { pickEmoji } from '../lib/emoji'
import { displayPhone } from '../lib/phone'
import type { OrderTotal, InstallmentRow, Customer } from '../lib/types'

interface ItemRow {
  id: string
  quantity: number
  unit_price: number
  discount: number
  line_total: number
  products: { code: string; brand: string | null; model: string | null } | null
  product_units: { serial_number: string } | null
}
interface OrderRow {
  id: string
  code: string
  customer_id: string
  currency: string
  fx_rate: number
  discount_amount: number
  discount_reason: string | null
  delivery_fee: number
  status: string
  notes: string | null
}

const INSTALLMENT_BADGE: Record<string, string> = {
  paid: 'badge--ok', overdue: 'badge--danger', partial: 'badge--warn',
  pending: 'badge--muted', cancelled: 'badge--muted',
}

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuth()
  const { t } = useI18n()
  const [order, setOrder] = useState<OrderRow | null>(null)
  const [totals, setTotals] = useState<OrderTotal | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [items, setItems] = useState<ItemRow[]>([])
  const [installments, setInstallments] = useState<InstallmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    if (!id) return
    let active = true
    ;(async () => {
      setLoading(true)
      const [o, t, it] = await Promise.all([
        supabase.from('orders').select('*').eq('id', id).maybeSingle(),
        supabase.from('v_order_totals').select('*').eq('order_id', id).maybeSingle(),
        supabase
          .from('order_items')
          .select('id, quantity, unit_price, discount, line_total, products(code, brand, model), product_units(serial_number)')
          .eq('order_id', id),
      ])
      if (!active) return
      const ord = o.data as OrderRow | null
      setOrder(ord)
      setTotals(t.data as OrderTotal | null)
      setItems((it.data ?? []) as unknown as ItemRow[])
      if (o.error || t.error || it.error) setError((o.error || t.error || it.error)!.message)

      if (ord) {
        const [c, ins] = await Promise.all([
          supabase.from('customers').select('*').eq('id', ord.customer_id).maybeSingle(),
          supabase.from('v_installment_status').select('*').eq('order_id', id).order('number'),
        ])
        if (!active) return
        setCustomer(c.data as Customer | null)
        setInstallments((ins.data ?? []) as InstallmentRow[])
      }
      setLoading(false)
    })()
    return () => { active = false }
  }, [id, refresh])

  if (loading) return <span className="spinner" />
  if (error) return <div className="alert alert--danger">{error}</div>
  if (!order || !totals) return <div className="empty">{t('لم يُعثر على الفاتورة.', 'Invoice not found.')}</div>

  const cur = order.currency === 'USD' ? '$' : t('ل.ل', 'LBP')

  return (
    <div>
      <div className="no-print">
        <PageHeader
          eyebrow={t('المبيعات', 'Sales')}
          title={`${t('فاتورة', 'Invoice')} ${order.code}`}
          subtitle={<span className="badge badge--info">{orderLabel(order.status)}</span>}
          actions={
            <>
              <button className="btn btn--primary" onClick={() => window.print()}>{t('طباعة', 'Print')}</button>
              {customer && (
                <Link to={`/customers/${customer.id}`} className="btn">{t('ملف الزبون', 'Customer file')}</Link>
              )}
            </>
          }
        />
      </div>

      {order.status !== 'cancelled' && order.status !== 'returned' && (
        <div className="no-print" style={{ marginBottom: 'var(--sp-4)' }}>
          <OrderActions
            orderId={order.id}
            currentNotes={order.notes}
            isOwner={profile?.role === 'owner'}
            userId={profile?.id ?? null}
            onDone={() => setRefresh((r) => r + 1)}
          />
        </div>
      )}

      <div className="invoice-sheet card">
        <div className="card__body">
          {/* ترويسة المحل */}
          <div className="invoice-head">
            <div>
              <div className="invoice-shop">{t('محل الحاجّو', 'Hajjo Store')}</div>
              <div className="faint small">{t('الأدوات والأجهزة الكهربائية', 'Electrical tools & appliances')}</div>
            </div>
            <div className="invoice-meta">
              <div><span className="muted">{t('فاتورة رقم:', 'Invoice no:')}</span> <strong className="num">{order.code}</strong></div>
              <div><span className="muted">{t('التاريخ:', 'Date:')}</span> <span className="num">{formatDate(totals.order_date)}</span></div>
            </div>
          </div>

          {/* الزبون */}
          {customer && (
            <div className="invoice-party">
              <div><span className="muted">{t('الزبون:', 'Customer:')}</span> <strong>{customer.full_name}</strong> <span className="faint num">({customer.code})</span></div>
              <div className="num">{displayPhone(customer.phone)}</div>
              <div>{[customer.area, customer.address].filter(Boolean).join(' — ') || ''}</div>
            </div>
          )}

          {/* البنود */}
          <div className="table-wrap">
            <table className="data invoice-items">
              <thead>
                <tr>
                  <th>{t('المنتج', 'Product')}</th>
                  <th>{t('الرقم التسلسلي', 'Serial number')}</th>
                  <th className="num">{t('الكمية', 'Qty')}</th>
                  <th className="num">{t('السعر', 'Price')} ({cur})</th>
                  <th className="num">{t('خصم', 'Discount')}</th>
                  <th className="num">{t('الإجمالي', 'Total')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td><span className="cell-emoji" aria-hidden>{pickEmoji(it.products?.brand, it.products?.model, it.products?.code)}</span>{`${it.products?.brand ?? ''} ${it.products?.model ?? ''}`.trim() || it.products?.code || '—'}</td>
                    <td className="num">{it.product_units?.serial_number ?? '—'}</td>
                    <td className="num">{formatNumber(it.quantity)}</td>
                    <td className="num">{formatNumber(it.unit_price, 2)}</td>
                    <td className="num">{formatNumber(it.discount, 2)}</td>
                    <td className="num">{formatNumber(it.line_total, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* المجاميع */}
          <div className="invoice-totals">
            <Row label={t('المجموع الفرعي', 'Subtotal')} value={`${formatNumber(totals.subtotal, 2)} ${cur}`} />
            {order.discount_amount > 0 && (
              <Row label={`${t('الخصم', 'Discount')}${order.discount_reason ? ` (${order.discount_reason})` : ''}`} value={`- ${formatNumber(order.discount_amount, 2)} ${cur}`} />
            )}
            {order.delivery_fee > 0 && (
              <Row label={t('رسوم التوصيل', 'Delivery fee')} value={`${formatNumber(order.delivery_fee, 2)} ${cur}`} />
            )}
            <Row label={t('الإجمالي (بالدولار)', 'Total (USD)')} value={formatUsd(totals.total_usd)} strong />
            <Row label={t('المدفوع', 'Paid')} value={formatUsd(totals.paid_usd)} />
            <Row label={t('المتبقّي', 'Remaining')} value={formatUsd(totals.remaining_usd)} debt={totals.remaining_usd > 0.005} strong />
          </div>

          {/* الأقساط */}
          {installments.length > 0 && (
            <div className="mt-4">
              <h3 className="small muted">{t('جدول الأقساط', 'Installment schedule')}</h3>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>#</th><th>{t('الاستحقاق', 'Due date')}</th><th className="num">{t('القيمة', 'Amount')}</th>
                      <th className="num">{t('المدفوع', 'Paid')}</th><th className="num">{t('المتبقّي', 'Remaining')}</th><th>{t('الحالة', 'Status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {installments.map((i) => (
                      <tr key={i.installment_id}>
                        <td className="num">{i.number}</td>
                        <td className="num">{formatDate(i.due_date)}</td>
                        <td className="num">{formatUsd(i.amount_usd)}</td>
                        <td className="num">{formatUsd(i.paid_usd)}</td>
                        <td className="num">{formatUsd(i.remaining_usd)}</td>
                        <td><span className={`badge ${INSTALLMENT_BADGE[i.status] ?? 'badge--muted'}`}>{installmentLabel(i.status)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="invoice-foot">
            <div className="faint small">{t('شكرًا لتعاملكم معنا — البضاعة المباعة لا تُرد إلا حسب شروط الضمان.', 'Thank you for your business — sold goods are only returnable under warranty terms.')}</div>
            <div className="invoice-sign">{t('التوقيع: ____________________', 'Signature: ____________________')}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, strong, debt }: { label: string; value: string; strong?: boolean; debt?: boolean }) {
  return (
    <div className={`invoice-total-row ${strong ? 'is-strong' : ''}`}>
      <span>{label}</span>
      <span className={`num ${debt ? 'money money--debt' : ''}`}>{value}</span>
    </div>
  )
}

function OrderActions({
  orderId, currentNotes, isOwner, userId, onDone,
}: {
  orderId: string
  currentNotes: string | null
  isOwner: boolean
  userId: string | null
  onDone: () => void
}) {
  const { t } = useI18n()
  const [mode, setMode] = useState<'cancel' | 'return' | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function apply() {
    if (!reason.trim()) return setError(t('السبب مطلوب', 'A reason is required'))
    setBusy(true)
    setError(null)
    let res
    if (mode === 'cancel') {
      res = await supabase
        .from('orders')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancel_reason: reason.trim(),
          cancelled_by: userId,
        })
        .eq('id', orderId)
    } else {
      const note = `${currentNotes ? currentNotes + ' | ' : ''}${t('إرجاع:', 'Return:')} ${reason.trim()}`
      res = await supabase.from('orders').update({ status: 'returned', notes: note }).eq('id', orderId)
    }
    setBusy(false)
    if (res.error) {
      setError(res.error.message)
      return
    }
    setMode(null)
    setReason('')
    onDone()
  }

  if (mode) {
    return (
      <div className="card"><div className="card__body">
        {error && <div className="alert alert--danger">{error}</div>}
        <div className="field">
          <label>{mode === 'cancel' ? t('سبب الإلغاء', 'Cancellation reason') : t('سبب الإرجاع', 'Return reason')}</label>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </div>
        <div className="row">
          <button className={`btn ${mode === 'cancel' ? 'btn--danger' : 'btn--primary'}`} onClick={() => void apply()} disabled={busy}>
            {busy ? <span className="spinner" /> : t('تأكيد', 'Confirm')}
          </button>
          <button className="btn btn--ghost" onClick={() => { setMode(null); setError(null) }}>{t('تراجع', 'Back')}</button>
        </div>
        <p className="faint small mt-2">{t('سيُعيد النظام البضاعة إلى المخزون تلقائيًا.', 'The system will return the goods to stock automatically.')}</p>
      </div></div>
    )
  }

  return (
    <div className="row">
      <button className="btn btn--sm" onClick={() => setMode('return')}>{t('إرجاع الفاتورة', 'Return invoice')}</button>
      {isOwner && (
        <button className="btn btn--sm btn--danger" onClick={() => setMode('cancel')}>{t('إلغاء الفاتورة', 'Cancel invoice')}</button>
      )}
    </div>
  )
}
