import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../i18n/i18n'
import PageHeader from '../components/PageHeader'
import CustomerPicker, { type PickedCustomer } from '../components/CustomerPicker'
import { formatUsd, formatDate } from '../lib/format'
import type { OrderTotal, PaymentMethod, CurrencyCode, Payment } from '../lib/types'

export default function RecordPayment() {
  const { t } = useI18n()
  const [params] = useSearchParams()
  const preCustomer = params.get('customer')

  const [customer, setCustomer] = useState<PickedCustomer | null>(null)
  const [orders, setOrders] = useState<OrderTotal[]>([])
  const [orderId, setOrderId] = useState('')

  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<CurrencyCode>('USD')
  const [fx, setFx] = useState('1')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [reference, setReference] = useState('')
  const [chequeDue, setChequeDue] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<Payment | null>(null)

  const METHODS: { value: PaymentMethod; label: string }[] = [
    { value: 'cash', label: t('نقدًا', 'Cash') },
    { value: 'transfer', label: t('حوالة', 'Transfer') },
    { value: 'card', label: t('بطاقة', 'Card') },
    { value: 'cheque', label: t('شيك', 'Cheque') },
    { value: 'other', label: t('أخرى', 'Other') },
  ]

  useEffect(() => {
    if (!preCustomer) return
    ;(async () => {
      const { data } = await supabase
        .from('v_customer_balances')
        .select('customer_id, code, full_name, phone, balance_usd')
        .eq('customer_id', preCustomer)
        .maybeSingle()
      if (data) setCustomer(data as PickedCustomer)
    })()
  }, [preCustomer])

  useEffect(() => {
    if (!customer) { setOrders([]); setOrderId(''); return }
    ;(async () => {
      const { data } = await supabase
        .from('v_order_totals').select('*')
        .eq('customer_id', customer.customer_id)
        .not('status', 'in', '(draft,cancelled)')
        .order('order_date', { ascending: true })
      const open = ((data ?? []) as OrderTotal[]).filter((o) => o.remaining_usd > 0.005)
      setOrders(open)
      setOrderId(open[0]?.order_id ?? '')
    })()
  }, [customer, receipt])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null); setReceipt(null)
    if (!customer) return setError(t('اختر الزبون', 'Select a customer'))
    if (!orderId) return setError(t('اختر الفاتورة', 'Select an invoice'))
    const amt = Number(amount)
    if (!(amt > 0)) return setError(t('أدخل مبلغًا صحيحًا', 'Enter a valid amount'))
    const fxNum = currency === 'USD' ? 1 : Number(fx)
    if (!(fxNum > 0)) return setError(t('سعر الصرف غير صحيح', 'Invalid exchange rate'))
    if (method === 'cheque' && !reference.trim()) return setError(t('رقم الشيك مطلوب', 'Cheque number required'))

    setSaving(true)
    const { data, error } = await supabase.rpc('record_customer_payment', {
      p_customer_id: customer.customer_id, p_order_id: orderId, p_amount: amt,
      p_currency: currency, p_fx: fxNum, p_method: method,
      p_reference: reference.trim() || null,
      p_cheque_due: method === 'cheque' && chequeDue ? chequeDue : null, p_notes: null,
    })
    setSaving(false)
    if (error) return setError(error.message)
    setReceipt((Array.isArray(data) ? data[0] : data) as Payment)
    setAmount(''); setReference(''); setChequeDue('')
  }

  const selectedOrder = orders.find((o) => o.order_id === orderId)

  return (
    <div>
      <PageHeader
        eyebrow={t('المقبوضات', 'Collections')}
        title={t('تسجيل دفعة', 'Record Payment')}
        subtitle={t('اقبض دفعة ووزّعها على الأقساط', 'Collect a payment and allocate it to installments')}
        actions={<Link to="/" className="btn btn--ghost">{t('رجوع', 'Back')}</Link>}
      />

      {receipt && (
        <div className="alert alert--ok mt-2 between">
          <span>
            {t('تم تسجيل الدفعة — إيصال رقم', 'Payment recorded — receipt')} <strong className="num">{receipt.receipt_no}</strong>{' '}
            {t('بقيمة', 'for')} <strong className="num">{formatUsd(receipt.amount_usd)}</strong>.
          </span>
          <Link to={`/receipts/${receipt.id}`} className="btn btn--sm">{t('طباعة الإيصال', 'Print receipt')}</Link>
        </div>
      )}

      <div className="grid grid--2 mt-2">
        <form className="card" onSubmit={onSubmit}>
          <div className="card__header">{t('تفاصيل الدفعة', 'Payment details')}</div>
          <div className="card__body">
            {error && <div className="alert alert--danger">{error}</div>}

            <div className="field">
              <label>{t('الزبون', 'Customer')}</label>
              <CustomerPicker value={customer} onSelect={setCustomer} onClear={() => setCustomer(null)} />
            </div>

            {customer && (
              <>
                <div className="field">
                  <label>{t('الفاتورة', 'Invoice')}</label>
                  {orders.length === 0 ? (
                    <div className="muted small">{t('لا فواتير مفتوحة على هذا الزبون.', 'No open invoices for this customer.')}</div>
                  ) : (
                    <select className="select" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                      {orders.map((o) => (
                        <option key={o.order_id} value={o.order_id}>
                          {o.code} — {t('متبقٍّ', 'remaining')} {formatUsd(o.remaining_usd)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="row">
                  <div className="field">
                    <label>{t('المبلغ', 'Amount')}</label>
                    <input className="input num" dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  </div>
                  <div className="field" style={{ maxWidth: 120 }}>
                    <label>{t('العملة', 'Currency')}</label>
                    <select className="select" value={currency} onChange={(e) => { const c = e.target.value as CurrencyCode; setCurrency(c); if (c === 'USD') setFx('1') }}>
                      <option value="USD">{t('دولار', 'USD')}</option>
                      <option value="LBP">{t('ليرة', 'LBP')}</option>
                    </select>
                  </div>
                  {currency === 'LBP' && (
                    <div className="field" style={{ maxWidth: 160 }}>
                      <label>{t('سعر الصرف (ل.ل/دولار)', 'Rate (LBP/USD)')}</label>
                      <input className="input num" dir="ltr" inputMode="decimal" value={fx} onChange={(e) => setFx(e.target.value)} />
                    </div>
                  )}
                </div>

                <div className="row">
                  <div className="field">
                    <label>{t('طريقة الدفع', 'Payment method')}</label>
                    <select className="select" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                      {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </div>
                  {(method === 'cheque' || method === 'transfer') && (
                    <div className="field">
                      <label>{method === 'cheque' ? t('رقم الشيك', 'Cheque number') : t('رقم الحوالة', 'Transfer reference')}</label>
                      <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
                    </div>
                  )}
                </div>

                {method === 'cheque' && (
                  <div className="field" style={{ maxWidth: 200 }}>
                    <label>{t('تاريخ استحقاق الشيك', 'Cheque due date')}</label>
                    <input className="input num" dir="ltr" type="date" value={chequeDue} onChange={(e) => setChequeDue(e.target.value)} />
                  </div>
                )}

                <button className="btn btn--primary btn--block mt-2" type="submit" disabled={saving || orders.length === 0}>
                  {saving ? <span className="spinner" /> : t('تسجيل الدفعة', 'Record payment')}
                </button>
                <p className="faint small mt-2">{t('يُوزّع المبلغ تلقائيًا على أقدم الأقساط المستحقّة أولًا.', 'The amount is auto-allocated to the oldest due installments first.')}</p>
              </>
            )}
          </div>
        </form>

        <div className="card" style={{ alignSelf: 'start' }}>
          <div className="card__header">{t('ملخّص الفاتورة', 'Invoice summary')}</div>
          <div className="card__body">
            {selectedOrder ? (
              <table className="data">
                <tbody>
                  <tr><td>{t('رقم الفاتورة', 'Invoice code')}</td><td className="num">{selectedOrder.code}</td></tr>
                  <tr><td>{t('التاريخ', 'Date')}</td><td className="num">{formatDate(selectedOrder.order_date)}</td></tr>
                  <tr><td>{t('الإجمالي', 'Total')}</td><td className="num">{formatUsd(selectedOrder.total_usd)}</td></tr>
                  <tr><td>{t('المدفوع', 'Paid')}</td><td className="num">{formatUsd(selectedOrder.paid_usd)}</td></tr>
                  <tr><td>{t('المتبقّي', 'Remaining')}</td><td className="num money money--debt">{formatUsd(selectedOrder.remaining_usd)}</td></tr>
                </tbody>
              </table>
            ) : (
              <p className="muted small">{t('اختر زبونًا وفاتورة لعرض الملخّص.', 'Select a customer and invoice to see the summary.')}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
