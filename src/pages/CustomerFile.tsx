import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../i18n/i18n'
import PageHeader from '../components/PageHeader'
import {
  formatUsd,
  formatDate,
  balanceClass,
  installmentLabel,
  orderLabel,
  methodLabel,
} from '../lib/format'
import { displayPhone } from '../lib/phone'
import type {
  Customer,
  CustomerBalance,
  OrderTotal,
  InstallmentRow,
  Payment,
} from '../lib/types'

const INSTALLMENT_BADGE: Record<string, string> = {
  paid: 'badge--ok',
  overdue: 'badge--danger',
  partial: 'badge--warn',
  pending: 'badge--muted',
  cancelled: 'badge--muted',
}

export default function CustomerFile() {
  const { t } = useI18n()
  const { id } = useParams<{ id: string }>()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [balance, setBalance] = useState<CustomerBalance | null>(null)
  const [orders, setOrders] = useState<OrderTotal[]>([])
  const [installments, setInstallments] = useState<InstallmentRow[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let active = true
    ;(async () => {
      setLoading(true)
      const [c, b, o, ins, p] = await Promise.all([
        supabase.from('customers').select('*').eq('id', id).maybeSingle(),
        supabase.from('v_customer_balances').select('*').eq('customer_id', id).maybeSingle(),
        supabase
          .from('v_order_totals')
          .select('*')
          .eq('customer_id', id)
          .order('order_date', { ascending: false }),
        supabase
          .from('v_installment_status')
          .select('*')
          .eq('customer_id', id)
          .order('due_date', { ascending: true }),
        supabase
          .from('payments')
          .select('id, receipt_no, direction, customer_id, amount, currency, fx_rate, amount_usd, method, payment_date, notes')
          .eq('customer_id', id)
          .eq('direction', 'in')
          .order('payment_date', { ascending: false })
          .limit(50),
      ])
      if (!active) return
      const firstErr = c.error || b.error || o.error || ins.error || p.error
      if (firstErr) setError(firstErr.message)
      setCustomer(c.data as Customer | null)
      setBalance(b.data as CustomerBalance | null)
      setOrders((o.data ?? []) as OrderTotal[])
      setInstallments((ins.data ?? []) as InstallmentRow[])
      setPayments((p.data ?? []) as Payment[])
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [id])

  if (loading) return <span className="spinner" />
  if (error) return <div className="alert alert--danger">{error}</div>
  if (!customer) return <div className="empty">{t('لم يُعثر على الزبون.', 'Customer not found.')}</div>

  return (
    <div className="stack">
      <PageHeader
        eyebrow={t('ملف الزبون', 'Customer file')}
        title={customer.full_name}
        subtitle={<span className="num">{customer.code}</span>}
        actions={
          <>
            <Link to={`/invoices/new?customer=${customer.id}`} className="btn btn--primary">
              {t('+ فاتورة', '+ Invoice')}
            </Link>
            <Link to={`/payments/new?customer=${customer.id}`} className="btn">
              {t('+ دفعة', '+ Payment')}
            </Link>
          </>
        }
      />

      {/* الملخّص المالي */}
      <section className="grid grid--kpi">
        <div className="card kpi">
          <div className="kpi__label">{t('الرصيد المتبقّي', 'Outstanding balance')}</div>
          <div className={`kpi__value ${balanceClass(balance?.balance_usd ?? 0)}`}>
            {formatUsd(balance?.balance_usd ?? 0)}
          </div>
        </div>
        <div className="card kpi">
          <div className="kpi__label">{t('إجمالي المشتريات', 'Total purchases')}</div>
          <div className="kpi__value num">{formatUsd(balance?.purchases_usd ?? 0)}</div>
        </div>
        <div className="card kpi">
          <div className="kpi__label">{t('إجمالي المدفوع', 'Total paid')}</div>
          <div className="kpi__value num">{formatUsd(balance?.paid_usd ?? 0)}</div>
        </div>
        <div className="card kpi">
          <div className="kpi__label">{t('فواتير مفتوحة', 'Open invoices')}</div>
          <div className="kpi__value num">{balance?.open_orders ?? 0}</div>
        </div>
      </section>

      {/* بيانات الاتصال */}
      <div className="card">
        <div className="card__body row">
          <InfoField label={t('الهاتف', 'Phone')} value={displayPhone(customer.phone)} num />
          <InfoField label={t('هاتف إضافي', 'Secondary phone')} value={displayPhone(customer.phone2)} num />
          <InfoField label={t('المنطقة', 'Area')} value={customer.area ?? '—'} />
          <InfoField label={t('العنوان', 'Address')} value={customer.address ?? '—'} />
          <InfoField label={t('الكفيل', 'Guarantor')} value={customer.guarantor_name ?? '—'} />
          <InfoField label={t('هاتف الكفيل', 'Guarantor phone')} value={displayPhone(customer.guarantor_phone)} num />
        </div>
      </div>

      {/* الأقساط */}
      <div className="card">
        <div className="card__header">{t('الأقساط', 'Installments')}</div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>{t('الاستحقاق', 'Due date')}</th>
                <th className="num">{t('القيمة', 'Amount')}</th>
                <th className="num">{t('المدفوع', 'Paid')}</th>
                <th className="num">{t('المتبقّي', 'Remaining')}</th>
                <th>{t('الحالة', 'Status')}</th>
                <th className="num">{t('تأخّر (يوم)', 'Days late')}</th>
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
                  <td>
                    <span className={`badge ${INSTALLMENT_BADGE[i.status] ?? 'badge--muted'}`}>
                      {installmentLabel(i.status)}
                    </span>
                  </td>
                  <td className="num">{i.days_late > 0 ? i.days_late : '—'}</td>
                </tr>
              ))}
              {installments.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="empty">{t('لا أقساط على هذا الزبون.', 'No installments for this customer.')}</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* الفواتير */}
      <div className="card">
        <div className="card__header">{t('الفواتير', 'Invoices')}</div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t('الرقم', 'Code')}</th>
                <th>{t('التاريخ', 'Date')}</th>
                <th>{t('الحالة', 'Status')}</th>
                <th className="num">{t('الإجمالي', 'Total')}</th>
                <th className="num">{t('المدفوع', 'Paid')}</th>
                <th className="num">{t('المتبقّي', 'Remaining')}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.order_id}>
                  <td className="num"><Link to={`/invoices/${o.order_id}`}>{o.code}</Link></td>
                  <td className="num">{formatDate(o.order_date)}</td>
                  <td>
                    <span className="badge badge--info">{orderLabel(o.status)}</span>
                  </td>
                  <td className="num">{formatUsd(o.total_usd)}</td>
                  <td className="num">{formatUsd(o.paid_usd)}</td>
                  <td className="num">
                    <span className={balanceClass(o.remaining_usd)}>
                      {formatUsd(o.remaining_usd)}
                    </span>
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className="empty">{t('لا فواتير.', 'No invoices.')}</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* الدفعات */}
      <div className="card">
        <div className="card__header">{t('سجل الدفعات', 'Payment history')}</div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t('الإيصال', 'Receipt')}</th>
                <th>{t('التاريخ', 'Date')}</th>
                <th>{t('الطريقة', 'Method')}</th>
                <th className="num">{t('المبلغ (بالدولار)', 'Amount (USD)')}</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="num"><Link to={`/receipts/${p.id}`}>{p.receipt_no}</Link></td>
                  <td className="num">{formatDate(p.payment_date)}</td>
                  <td>{methodLabel(p.method)}</td>
                  <td className="num">{formatUsd(p.amount_usd)}</td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <div className="empty">{t('لا دفعات مسجّلة.', 'No payments recorded.')}</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function InfoField({ label, value, num }: { label: string; value: string; num?: boolean }) {
  return (
    <div className="field" style={{ marginBottom: 0 }}>
      <label>{label}</label>
      <div className={num ? 'num' : ''}>{value}</div>
    </div>
  )
}
