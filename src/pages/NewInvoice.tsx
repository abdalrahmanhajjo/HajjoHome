import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../i18n/i18n'
import PageHeader from '../components/PageHeader'
import CustomerPicker, { type PickedCustomer } from '../components/CustomerPicker'
import { formatUsd } from '../lib/format'
import { pickEmoji } from '../lib/emoji'
import type { CurrencyCode, PaymentPlan, SaleItemInput } from '../lib/types'

interface ProductHit {
  id: string
  code: string
  brand: string | null
  model: string | null
  is_serialized: boolean
  sale_price: number | null
  min_price: number | null
}
interface UnitHit {
  id: string
  serial_number: string
  location: string | null
}
interface LineItem {
  key: string
  product_id: string
  product_label: string
  is_serialized: boolean
  product_unit_id: string | null
  serial: string | null
  quantity: number
  unit_price: number
  discount: number
  min_price: number | null
}

export default function NewInvoice() {
  const { profile } = useAuth()
  const { t } = useI18n()
  const isOwner = profile?.role === 'owner'
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const preCustomer = params.get('customer')

  const [customer, setCustomer] = useState<PickedCustomer | null>(null)

  // إعدادات الفاتورة
  const [currency, setCurrency] = useState<CurrencyCode>('USD')
  const [fx, setFx] = useState('1')
  const [discount, setDiscount] = useState('0')
  const [discountReason, setDiscountReason] = useState('')
  const [deliveryFee, setDeliveryFee] = useState('0')
  const [plan, setPlan] = useState<PaymentPlan>('cash')
  const [downPayment, setDownPayment] = useState('0')
  const [instCount, setInstCount] = useState('0')
  const [firstDue, setFirstDue] = useState('')
  const [interval, setInterval] = useState('1')
  const [notes, setNotes] = useState('')

  const [items, setItems] = useState<LineItem[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fxNum = currency === 'USD' ? 1 : Number(fx) || 1

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

  function belowFloor(it: LineItem): boolean {
    if (it.min_price == null) return false
    const netUsd = (it.unit_price - it.discount) / fxNum
    return netUsd < it.min_price - 0.005
  }
  const blockedByFloor = items.some((it) => belowFloor(it) && !isOwner)

  const estSubtotal = useMemo(
    () => items.reduce((s, it) => s + (it.quantity * it.unit_price - it.discount), 0),
    [items]
  )

  function removeItem(key: string) {
    setItems((xs) => xs.filter((x) => x.key !== key))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!customer) return setError(t('اختر الزبون', 'Select a customer'))
    if (items.length === 0) return setError(t('أضف بندًا واحدًا على الأقل', 'Add at least one line'))
    if (Number(discount) > 0 && !discountReason.trim())
      return setError(t('سبب الخصم مطلوب', 'Discount reason is required'))
    if (blockedByFloor)
      return setError(t('يوجد بند تحت أقل سعر مسموح — يلزم موافقة المدير', 'A line is below the minimum price — owner approval required'))
    if (plan !== 'cash' && Number(instCount) > 0 && !firstDue)
      return setError(t('حدّد تاريخ استحقاق أول قسط', 'Set the first installment due date'))

    const payloadItems: SaleItemInput[] = items.map((it) => ({
      product_id: it.product_id,
      product_unit_id: it.product_unit_id,
      quantity: it.quantity,
      unit_price: it.unit_price,
      discount: it.discount,
      price_override_by: belowFloor(it) && isOwner ? profile?.id ?? null : null,
    }))

    setSaving(true)
    const { data, error } = await supabase.rpc('create_sale', {
      p_customer_id: customer.customer_id,
      p_items: payloadItems,
      p_currency: currency,
      p_fx: fxNum,
      p_discount: Number(discount) || 0,
      p_discount_reason: discountReason.trim() || null,
      p_delivery_fee: Number(deliveryFee) || 0,
      p_plan: plan,
      p_down_payment: Number(downPayment) || 0,
      p_installment_count: plan === 'cash' ? 0 : Number(instCount) || 0,
      p_first_due: firstDue || null,
      p_interval_months: Number(interval) || 1,
      p_notes: notes.trim() || null,
    })
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    const row = (Array.isArray(data) ? data[0] : data) as { id: string }
    navigate(`/invoices/${row.id}`)
  }

  return (
    <div>
      <PageHeader
        eyebrow={t('المبيعات', 'Sales')}
        title={t('فاتورة جديدة', 'New invoice')}
        subtitle={t('أنشئ فاتورة بيع نقدًا أو تقسيطًا', 'Create a cash or installment sale')}
        actions={<Link to="/" className="btn btn--ghost">{t('رجوع', 'Back')}</Link>}
      />

      {error && <div className="alert alert--danger">{error}</div>}

      <form onSubmit={onSubmit} className="stack">
        <div className="card">
          <div className="card__header">{t('الزبون', 'Customer')}</div>
          <div className="card__body">
            <CustomerPicker value={customer} onSelect={setCustomer} onClear={() => setCustomer(null)} />
          </div>
        </div>

        <div className="card">
          <div className="card__header">{t('البنود', 'Line items')}</div>
          <div className="card__body">
            <ItemAdder
              fxNum={fxNum}
              onAdd={(li) => setItems((xs) => [...xs, li])}
            />

            <div className="table-wrap mt-4">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('المنتج', 'Product')}</th>
                    <th>{t('الرقم التسلسلي', 'Serial number')}</th>
                    <th className="num">{t('الكمية', 'Qty')}</th>
                    <th className="num">{t('السعر', 'Price')}</th>
                    <th className="num">{t('خصم', 'Discount')}</th>
                    <th className="num">{t('الإجمالي', 'Total')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.key}>
                      <td>{it.product_label}</td>
                      <td className="num">{it.serial ?? '—'}</td>
                      <td className="num">{it.quantity}</td>
                      <td className="num">{formatUsd(it.unit_price)}</td>
                      <td className="num">{formatUsd(it.discount)}</td>
                      <td className="num">
                        {formatUsd(it.quantity * it.unit_price - it.discount)}
                        {belowFloor(it) && (
                          <span className={`badge ${isOwner ? 'badge--warn' : 'badge--danger'}`} style={{ marginRight: 6 }}>
                            {isOwner ? t('تحت الحد (موافقة المدير)', 'Below floor (owner approval)') : t('تحت الحد — ممنوع', 'Below floor — blocked')}
                          </span>
                        )}
                      </td>
                      <td>
                        <button type="button" className="btn btn--sm btn--ghost" onClick={() => removeItem(it.key)}>
                          {t('حذف', 'Delete')}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr><td colSpan={7}><div className="empty">{t('لا بنود بعد.', 'No lines yet.')}</div></td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="between mt-2">
              <span className="muted small">{t('الأسعار بعملة الفاتورة', 'Prices in the invoice currency')} ({currency === 'USD' ? t('دولار', 'USD') : t('ليرة', 'LBP')})</span>
              <span className="small">
                {t('مجموع تقديري:', 'Estimated subtotal:')}{' '}
                <span className="num">{estSubtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid--2">
          <div className="card">
            <div className="card__header">{t('العملة والخصم والتوصيل', 'Currency, discount & delivery')}</div>
            <div className="card__body">
              <div className="row">
                <div className="field" style={{ maxWidth: 140 }}>
                  <label>{t('العملة', 'Currency')}</label>
                  <select className="select" value={currency} onChange={(e) => {
                    const c = e.target.value as CurrencyCode
                    setCurrency(c); if (c === 'USD') setFx('1')
                  }}>
                    <option value="USD">{t('دولار', 'USD')}</option>
                    <option value="LBP">{t('ليرة', 'LBP')}</option>
                  </select>
                </div>
                {currency === 'LBP' && (
                  <div className="field">
                    <label>{t('سعر الصرف (ل.ل/دولار)', 'Rate (LBP/USD)')}</label>
                    <input className="input num" dir="ltr" inputMode="decimal" value={fx} onChange={(e) => setFx(e.target.value)} />
                  </div>
                )}
              </div>
              <div className="row">
                <div className="field">
                  <label>{t('خصم على الفاتورة', 'Invoice discount')}</label>
                  <input className="input num" dir="ltr" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
                </div>
                <div className="field">
                  <label>{t('رسوم التوصيل', 'Delivery fee')}</label>
                  <input className="input num" dir="ltr" inputMode="decimal" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} />
                </div>
              </div>
              {Number(discount) > 0 && (
                <div className="field">
                  <label>{t('سبب الخصم *', 'Discount reason *')}</label>
                  <input className="input" value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} />
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card__header">{t('طريقة الدفع', 'Payment method')}</div>
            <div className="card__body">
              <div className="field">
                <label>{t('الخطة', 'Plan')}</label>
                <select className="select" value={plan} onChange={(e) => setPlan(e.target.value as PaymentPlan)}>
                  <option value="cash">{t('نقدًا', 'Cash')}</option>
                  <option value="installments">{t('تقسيط', 'Installments')}</option>
                  <option value="mixed">{t('مختلط', 'Mixed')}</option>
                </select>
              </div>
              <div className="field">
                <label>{t('الدفعة الأولى (بعملة الفاتورة)', 'Down payment (invoice currency)')}</label>
                <input className="input num" dir="ltr" inputMode="decimal" value={downPayment} onChange={(e) => setDownPayment(e.target.value)} />
              </div>
              {plan !== 'cash' && (
                <div className="row">
                  <div className="field" style={{ maxWidth: 120 }}>
                    <label>{t('عدد الأقساط', 'Installments')}</label>
                    <input className="input num" dir="ltr" inputMode="numeric" value={instCount} onChange={(e) => setInstCount(e.target.value)} />
                  </div>
                  <div className="field">
                    <label>{t('أول استحقاق', 'First due date')}</label>
                    <input className="input num" dir="ltr" type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} />
                  </div>
                  <div className="field" style={{ maxWidth: 120 }}>
                    <label>{t('كل (شهر)', 'Every (months)')}</label>
                    <input className="input num" dir="ltr" inputMode="numeric" value={interval} onChange={(e) => setInterval(e.target.value)} />
                  </div>
                </div>
              )}
              <p className="faint small">{t('قيمة كل قسط تُحسب في الخادم من المتبقّي بعد الدفعة الأولى.', 'Each installment amount is computed on the server from the balance after the down payment.')}</p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card__body">
            <div className="field">
              <label>{t('ملاحظات', 'Notes')}</label>
              <textarea className="textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <button className="btn btn--primary btn--block" type="submit" disabled={saving || blockedByFloor}>
              {saving ? <span className="spinner" /> : t('إنشاء الفاتورة', 'Create invoice')}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

// ------- إضافة بند: بحث منتج ثم اختيار قطعة مسلسلة إن لزم -------
function ItemAdder({ fxNum, onAdd }: { fxNum: number; onAdd: (li: LineItem) => void }) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ProductHit[]>([])
  const [picked, setPicked] = useState<ProductHit | null>(null)
  const [units, setUnits] = useState<UnitHit[]>([])
  const [unitId, setUnitId] = useState('')
  const [qty, setQty] = useState('1')
  const [price, setPrice] = useState('')
  const [disc, setDisc] = useState('0')

  useEffect(() => {
    if (picked) return
    const handle = setTimeout(async () => {
      const q = query.trim()
      if (!q) { setHits([]); return }
      const safe = q.replace(/[%,()*]/g, ' ')
      const { data } = await supabase
        .from('products')
        .select('id, code, brand, model, is_serialized, sale_price, min_price')
        .eq('is_active', true)
        .or(`brand.ilike.*${safe}*,model.ilike.*${safe}*,code.ilike.*${safe}*`)
        .limit(8)
      setHits((data ?? []) as ProductHit[])
    }, 250)
    return () => clearTimeout(handle)
  }, [query, picked])

  async function pick(p: ProductHit) {
    setPicked(p)
    setPrice(p.sale_price != null ? String(p.sale_price) : '')
    if (p.is_serialized) {
      const { data } = await supabase
        .from('product_units')
        .select('id, serial_number, location')
        .eq('product_id', p.id)
        .eq('status', 'in_stock')
        .order('serial_number')
        .limit(50)
      const list = (data ?? []) as UnitHit[]
      setUnits(list)
      setUnitId(list[0]?.id ?? '')
    } else {
      setUnits([])
      setUnitId('')
    }
  }

  function reset() {
    setPicked(null); setUnits([]); setUnitId(''); setQty('1'); setPrice(''); setDisc('0'); setQuery(''); setHits([])
  }

  function add() {
    if (!picked) return
    const priceNum = Number(price) || 0
    const discNum = Number(disc) || 0
    const qtyNum = picked.is_serialized ? 1 : Number(qty) || 1
    const unit = units.find((u) => u.id === unitId)
    onAdd({
      key: crypto.randomUUID(),
      product_id: picked.id,
      product_label: `${picked.brand ?? ''} ${picked.model ?? ''}`.trim() || picked.code,
      is_serialized: picked.is_serialized,
      product_unit_id: picked.is_serialized ? unitId || null : null,
      serial: unit?.serial_number ?? null,
      quantity: qtyNum,
      unit_price: priceNum,
      discount: discNum,
      min_price: picked.min_price,
    })
    reset()
  }

  const netUsd = ((Number(price) || 0) - (Number(disc) || 0)) / fxNum
  const under = picked?.min_price != null && netUsd < picked.min_price - 0.005

  if (!picked) {
    return (
      <div>
        <input className="input" placeholder={t('ابحث عن منتج (ماركة/موديل/رمز)…', 'Search for a product (brand / model / code)…')} value={query} onChange={(e) => setQuery(e.target.value)} />
        {hits.length > 0 && (
          <div className="card mt-2">
            <div className="table-wrap">
              <table className="data">
                <tbody>
                  {hits.map((h) => (
                    <tr key={h.id} style={{ cursor: 'pointer' }} onClick={() => void pick(h)}>
                      <td className="num">{h.code}</td>
                      <td><span className="cell-emoji" aria-hidden>{pickEmoji(h.brand, h.model, h.code)}</span>{`${h.brand ?? ''} ${h.model ?? ''}`.trim()}</td>
                      <td>{h.is_serialized ? <span className="badge badge--info">{t('مسلسل', 'Serialized')}</span> : <span className="badge badge--muted">{t('بالكمية', 'By quantity')}</span>}</td>
                      <td className="num">{h.sale_price != null ? formatUsd(h.sale_price) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="card" style={{ background: 'var(--c-surface-2)' }}>
      <div className="card__body">
        <div className="between">
          <strong><span className="cell-emoji" aria-hidden>{pickEmoji(picked.brand, picked.model, picked.code)}</span>{`${picked.brand ?? ''} ${picked.model ?? ''}`.trim() || picked.code}</strong>
          <button type="button" className="btn btn--sm btn--ghost" onClick={reset}>{t('إلغاء', 'Cancel')}</button>
        </div>
        <div className="row mt-2">
          {picked.is_serialized ? (
            <div className="field">
              <label>{t('القطعة (رقم تسلسلي)', 'Unit (serial number)')}</label>
              {units.length === 0 ? (
                <div className="muted small">{t('لا قطع متوفّرة في المخزون.', 'No units available in stock.')}</div>
              ) : (
                <select className="select" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>{u.serial_number}{u.location ? ` — ${u.location}` : ''}</option>
                  ))}
                </select>
              )}
            </div>
          ) : (
            <div className="field" style={{ maxWidth: 120 }}>
              <label>{t('الكمية', 'Quantity')}</label>
              <input className="input num" dir="ltr" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
          )}
          <div className="field" style={{ maxWidth: 160 }}>
            <label>{t('السعر', 'Price')}</label>
            <input className="input num" dir="ltr" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div className="field" style={{ maxWidth: 140 }}>
            <label>{t('خصم', 'Discount')}</label>
            <input className="input num" dir="ltr" inputMode="decimal" value={disc} onChange={(e) => setDisc(e.target.value)} />
          </div>
        </div>
        {under && (
          <div className="alert alert--warn">
            {t(`السعر بعد الخصم (${netUsd.toFixed(2)}$) أقل من الحد المسموح (${picked.min_price?.toFixed(2)}$) — يلزم موافقة المدير.`,
               `The net price (${netUsd.toFixed(2)}$) is below the minimum allowed (${picked.min_price?.toFixed(2)}$) — owner approval required.`)}
          </div>
        )}
        <button
          type="button"
          className="btn btn--primary mt-2"
          onClick={add}
          disabled={picked.is_serialized && !unitId}
        >
          {t('إضافة البند', 'Add line')}
        </button>
      </div>
    </div>
  )
}
