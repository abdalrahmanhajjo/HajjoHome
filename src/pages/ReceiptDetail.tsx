import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../i18n/i18n'
import PageHeader from '../components/PageHeader'
import { formatUsd, formatDateTime, formatNumber, methodLabel } from '../lib/format'
import { displayPhone } from '../lib/phone'

interface PaymentRow {
  id: string
  receipt_no: string
  customer_id: string | null
  amount: number
  currency: string
  fx_rate: number
  amount_usd: number
  method: string
  reference_no: string | null
  payment_date: string
  notes: string | null
  voided_at: string | null
}
interface AllocRow {
  amount_usd: number
  orders: { code: string } | null
  installments: { number: number } | null
}
interface Cust { id: string; code: string; full_name: string; phone: string | null }

export default function ReceiptDetail() {
  const { id } = useParams<{ id: string }>()
  const { t } = useI18n()
  const [p, setP] = useState<PaymentRow | null>(null)
  const [cust, setCust] = useState<Cust | null>(null)
  const [allocs, setAllocs] = useState<AllocRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let active = true
    ;(async () => {
      setLoading(true)
      const pay = await supabase
        .from('payments')
        .select('id, receipt_no, customer_id, amount, currency, fx_rate, amount_usd, method, reference_no, payment_date, notes, voided_at')
        .eq('id', id)
        .maybeSingle()
      if (!active) return
      const row = pay.data as PaymentRow | null
      setP(row)
      if (pay.error) setError(pay.error.message)
      if (row) {
        const [c, a] = await Promise.all([
          row.customer_id
            ? supabase.from('customers').select('id, code, full_name, phone').eq('id', row.customer_id).maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          supabase
            .from('payment_allocations')
            .select('amount_usd, orders(code), installments(number)')
            .eq('payment_id', id),
        ])
        if (!active) return
        setCust(c.data as Cust | null)
        setAllocs((a.data ?? []) as unknown as AllocRow[])
      }
      setLoading(false)
    })()
    return () => { active = false }
  }, [id])

  if (loading) return <span className="spinner" />
  if (error) return <div className="alert alert--danger">{error}</div>
  if (!p) return <div className="empty">{t('لم يُعثر على الإيصال.', 'Receipt not found.')}</div>

  const cur = p.currency === 'USD' ? '$' : t('ل.ل', 'LBP')

  return (
    <div>
      <div className="no-print">
        <PageHeader
          eyebrow={t('المقبوضات', 'Collections')}
          title={`${t('إيصال', 'Receipt')} ${p.receipt_no}`}
          subtitle={p.voided_at ? t('ملغى', 'Voided') : t('سند قبض', 'Payment receipt')}
          actions={
            <>
              <button className="btn btn--primary" onClick={() => window.print()}>{t('طباعة', 'Print')}</button>
              {cust && <Link to={`/customers/${cust.id}`} className="btn">{t('ملف الزبون', 'Customer file')}</Link>}
            </>
          }
        />
      </div>

      <div className="invoice-sheet card" style={{ maxWidth: 560 }}>
        <div className="card__body">
          {p.voided_at && <div className="alert alert--danger">{t('هذا الإيصال ملغى', 'This receipt is voided')}</div>}

          <div className="invoice-head">
            <div>
              <div className="invoice-shop">{t('محل الحاجّو', 'Hajjo Store')}</div>
              <div className="faint small">{t('سند قبض', 'Payment receipt')}</div>
            </div>
            <div className="invoice-meta">
              <div><span className="muted">{t('إيصال:', 'Receipt:')}</span> <strong className="num">{p.receipt_no}</strong></div>
              <div><span className="muted">{t('التاريخ:', 'Date:')}</span> <span className="num">{formatDateTime(p.payment_date)}</span></div>
            </div>
          </div>

          {cust && (
            <div className="invoice-party">
              <div><span className="muted">{t('استلمنا من:', 'Received from:')}</span> <strong>{cust.full_name}</strong> <span className="faint num">({cust.code})</span></div>
              <div className="num">{displayPhone(cust.phone)}</div>
            </div>
          )}

          <div className="invoice-totals" style={{ maxWidth: '100%' }}>
            <div className="invoice-total-row is-strong">
              <span>{t('المبلغ المقبوض', 'Amount received')}</span>
              <span className="num money money--credit">{formatUsd(p.amount_usd)}</span>
            </div>
            {p.currency !== 'USD' && (
              <div className="invoice-total-row">
                <span>{t('بالعملة المحلية', 'In local currency')}</span>
                <span className="num">{formatNumber(p.amount, 2)} {cur} ({t('صرف', 'rate')} {formatNumber(p.fx_rate, 0)})</span>
              </div>
            )}
            <div className="invoice-total-row">
              <span>{t('طريقة الدفع', 'Payment method')}</span>
              <span>{methodLabel(p.method)}{p.reference_no ? ` — ${p.reference_no}` : ''}</span>
            </div>
          </div>

          {allocs.length > 0 && (
            <div className="mt-4">
              <h3 className="small muted">{t('توزيع الدفعة', 'Payment allocation')}</h3>
              <table className="data">
                <thead><tr><th>{t('الفاتورة', 'Invoice')}</th><th>{t('القسط', 'Installment')}</th><th className="num">{t('المبلغ', 'Amount')}</th></tr></thead>
                <tbody>
                  {allocs.map((a, i) => (
                    <tr key={i}>
                      <td className="num">{a.orders?.code ?? '—'}</td>
                      <td className="num">{a.installments?.number ?? t('على الحساب', 'On account')}</td>
                      <td className="num">{formatUsd(a.amount_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="invoice-foot">
            <div className="faint small">{t('هذا السند إثبات قبض للمبلغ المذكور.', 'This receipt confirms payment of the stated amount.')}</div>
            <div className="invoice-sign">{t('التوقيع: ____________', 'Signature: ____________')}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
