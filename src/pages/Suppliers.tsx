import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../i18n/i18n'
import PageHeader from '../components/PageHeader'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import { useToast } from '../components/Toast'
import { formatUsd, formatNumber } from '../lib/format'
import { pickEmoji } from '../lib/emoji'
import type { CurrencyCode } from '../lib/types'

interface SupplierBalance {
  supplier_id: string
  code: string
  name: string
  purchases_usd: number
  paid_usd: number
  balance_usd: number
}
interface ProductHit {
  id: string
  code: string
  brand: string | null
  model: string | null
}
interface PurchaseLine {
  key: string
  product_id: string
  label: string
  quantity: number
  unit_cost: number
}
interface SupplierOption { id: string; name: string }
interface SupplierRow { id: string; name: string; company: string | null; phone_raw: string | null }

export default function Suppliers() {
  const { profile } = useAuth()
  const { t } = useI18n()
  const { toast } = useToast()
  const canManage = profile?.role === 'owner' || profile?.role === 'stock'

  const [rows, setRows] = useState<SupplierBalance[]>([])
  const [options, setOptions] = useState<SupplierOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<SupplierRow | null>(null)
  const [confirmDel, setConfirmDel] = useState<SupplierBalance | null>(null)
  const [busy, setBusy] = useState(false)

  async function openEdit(id: string) {
    const { data } = await supabase.from('suppliers').select('id, name, company, phone_raw').eq('id', id).maybeSingle()
    if (data) setEditing(data as SupplierRow)
  }

  async function deactivate() {
    if (!confirmDel) return
    setBusy(true)
    const { error } = await supabase.from('suppliers').update({ is_active: false }).eq('id', confirmDel.supplier_id)
    setBusy(false)
    if (error) { toast(error.message, 'danger'); return }
    toast(t('تم حذف المورد', 'Supplier deleted'))
    setConfirmDel(null)
    void reload()
  }

  async function reload() {
    setLoading(true)
    const [b, s] = await Promise.all([
      supabase.from('v_supplier_balances').select('*').order('balance_usd', { ascending: false }),
      supabase.from('suppliers').select('id, name').eq('is_active', true).order('name'),
    ])
    if (b.error || s.error) setError((b.error || s.error)!.message)
    setRows((b.data ?? []) as SupplierBalance[])
    setOptions((s.data ?? []) as SupplierOption[])
    setLoading(false)
  }
  useEffect(() => { void reload() }, [])

  if (loading) return <span className="spinner" />

  return (
    <div>
      <PageHeader
        eyebrow={t('التوريد', 'Supply')}
        title={t('الموردون والمشتريات', 'Suppliers & purchases')}
        subtitle={t(`${rows.length} مورّد`, `${rows.length} suppliers`)}
      />
      {error && <div className="alert alert--danger">{error}</div>}

      <div className="grid grid--2">
        {canManage && (
          <div className="stack">
            <AddSupplier onDone={reload} />
            <RecordPurchase suppliers={options} onDone={reload} />
          </div>
        )}

        <div className="card" style={{ alignSelf: 'start' }}>
          <div className="card__header">{t('أرصدة الموردين', 'Supplier balances')}</div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('الرمز', 'Code')}</th><th>{t('المورد', 'Supplier')}</th>
                  <th className="num">{t('مشتريات', 'Purchases')}</th><th className="num">{t('مدفوع', 'Paid')}</th><th className="num">{t('الرصيد', 'Balance')}</th>
                  {canManage && <th></th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.supplier_id}>
                    <td className="num">{r.code}</td>
                    <td>{r.name}</td>
                    <td className="num">{formatUsd(r.purchases_usd)}</td>
                    <td className="num">{formatUsd(r.paid_usd)}</td>
                    <td className="num"><span className={r.balance_usd > 0.005 ? 'money money--debt' : 'money'}>{formatUsd(r.balance_usd)}</span></td>
                    {canManage && (
                      <td>
                        <div className="row" style={{ gap: 'var(--sp-1)', flexWrap: 'nowrap' }}>
                          <button className="btn btn--sm btn--ghost" onClick={() => void openEdit(r.supplier_id)}>{t('تعديل', 'Edit')}</button>
                          <button className="btn btn--sm btn--ghost" onClick={() => setConfirmDel(r)}>{t('حذف', 'Delete')}</button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={canManage ? 6 : 5}><div className="empty">{t('لا موردين بعد.', 'No suppliers yet.')}</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {editing && (
        <Modal open onClose={() => setEditing(null)} title={t('تعديل المورد', 'Edit supplier')}>
          <SupplierEditForm supplier={editing} onSaved={() => { setEditing(null); toast(t('تم حفظ التعديلات', 'Changes saved')); void reload() }} />
        </Modal>
      )}

      <ConfirmDialog
        open={!!confirmDel}
        danger
        busy={busy}
        title={t('حذف المورد', 'Delete supplier')}
        message={t(
          `سيُزال «${confirmDel?.name}» من قائمة الموردين النشطين. تبقى مشترياته وأرصدته محفوظة.`,
          `“${confirmDel?.name}” will be removed from the active suppliers list. Its purchases and balances are kept.`,
        )}
        confirmLabel={t('حذف', 'Delete')}
        onConfirm={() => void deactivate()}
        onClose={() => setConfirmDel(null)}
      />
    </div>
  )
}

function AddSupplier({ onDone }: { onDone: () => void }) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null); setMsg(null)
    if (!name.trim()) return setError(t('اسم المورد مطلوب', 'Supplier name is required'))
    setBusy(true)
    const { error } = await supabase.from('suppliers').insert({
      name: name.trim(), company: company.trim() || null, phone_raw: phone.trim() || null,
    })
    setBusy(false)
    if (error) return setError(error.message)
    setName(''); setCompany(''); setPhone(''); setMsg(t('تمت إضافة المورد', 'Supplier added'))
    onDone()
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="card__header">{t('مورد جديد', 'New supplier')}</div>
      <div className="card__body">
        {error && <div className="alert alert--danger">{error}</div>}
        {msg && <div className="alert alert--ok">{msg}</div>}
        <div className="field"><label>{t('الاسم', 'Name')}</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="row">
          <div className="field"><label>{t('الشركة', 'Company')}</label><input className="input" value={company} onChange={(e) => setCompany(e.target.value)} /></div>
          <div className="field"><label>{t('الهاتف', 'Phone')}</label><input className="input num" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        </div>
        <button className="btn btn--primary btn--block" disabled={busy}>{busy ? <span className="spinner" /> : t('حفظ', 'Save')}</button>
      </div>
    </form>
  )
}

function SupplierEditForm({ supplier, onSaved }: { supplier: SupplierRow; onSaved: () => void }) {
  const { t } = useI18n()
  const [name, setName] = useState(supplier.name)
  const [company, setCompany] = useState(supplier.company ?? '')
  const [phone, setPhone] = useState(supplier.phone_raw ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) return setError(t('اسم المورد مطلوب', 'Supplier name is required'))
    setBusy(true)
    const { error } = await supabase
      .from('suppliers')
      .update({ name: name.trim(), company: company.trim() || null, phone_raw: phone.trim() || null })
      .eq('id', supplier.id)
    setBusy(false)
    if (error) return setError(error.message)
    onSaved()
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="alert alert--danger">{error}</div>}
      <div className="field"><label>{t('الاسم', 'Name')}</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="row">
        <div className="field"><label>{t('الشركة', 'Company')}</label><input className="input" value={company} onChange={(e) => setCompany(e.target.value)} /></div>
        <div className="field"><label>{t('الهاتف', 'Phone')}</label><input className="input num" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
      </div>
      <button className="btn btn--primary btn--block" type="submit" disabled={busy}>{busy ? <span className="spinner" /> : t('حفظ التغييرات', 'Save changes')}</button>
    </form>
  )
}

function RecordPurchase({ suppliers, onDone }: { suppliers: SupplierOption[]; onDone: () => void }) {
  const { profile } = useAuth()
  const { t } = useI18n()
  const [supplierId, setSupplierId] = useState('')
  const [currency, setCurrency] = useState<CurrencyCode>('USD')
  const [fx, setFx] = useState('1')
  const [invoiceRef, setInvoiceRef] = useState('')
  const [items, setItems] = useState<PurchaseLine[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { if (!supplierId && suppliers.length) setSupplierId(suppliers[0].id) }, [suppliers, supplierId])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null); setMsg(null)
    if (!supplierId) return setError(t('اختر المورد', 'Select a supplier'))
    if (items.length === 0) return setError(t('أضف بندًا واحدًا على الأقل', 'Add at least one line'))
    setBusy(true)
    const { data, error } = await supabase
      .from('purchases')
      .insert({
        supplier_id: supplierId, currency, fx_rate: currency === 'USD' ? 1 : Number(fx) || 1,
        invoice_ref: invoiceRef.trim() || null, created_by: profile?.id ?? null,
      })
      .select('id')
      .single()
    if (error) { setBusy(false); return setError(error.message) }
    const pid = (data as { id: string }).id
    const lines = items.map((it) => ({ purchase_id: pid, product_id: it.product_id, quantity: it.quantity, unit_cost: it.unit_cost }))
    const { error: itErr } = await supabase.from('purchase_items').insert(lines)
    setBusy(false)
    if (itErr) return setError(t(`أُنشئت الفاتورة لكن تعذّر إضافة البنود: ${itErr.message}`, `Invoice created but adding the lines failed: ${itErr.message}`))
    setItems([]); setInvoiceRef(''); setMsg(t('تم تسجيل فاتورة الشراء ورفع المخزون', 'Purchase invoice recorded and stock increased'))
    onDone()
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="card__header">{t('تسجيل فاتورة شراء', 'Record a purchase invoice')}</div>
      <div className="card__body">
        {error && <div className="alert alert--danger">{error}</div>}
        {msg && <div className="alert alert--ok">{msg}</div>}
        <div className="row">
          <div className="field"><label>{t('المورد', 'Supplier')}</label>
            <select className="select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ maxWidth: 120 }}><label>{t('العملة', 'Currency')}</label>
            <select className="select" value={currency} onChange={(e) => { const c = e.target.value as CurrencyCode; setCurrency(c); if (c === 'USD') setFx('1') }}>
              <option value="USD">{t('دولار', 'USD')}</option><option value="LBP">{t('ليرة', 'LBP')}</option>
            </select>
          </div>
          {currency === 'LBP' && (
            <div className="field" style={{ maxWidth: 150 }}><label>{t('سعر الصرف', 'Exchange rate')}</label>
              <input className="input num" dir="ltr" value={fx} onChange={(e) => setFx(e.target.value)} /></div>
          )}
        </div>
        <div className="field"><label>{t('رقم فاتورة المورد', 'Supplier invoice number')}</label><input className="input" value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} /></div>

        <PurchaseItemAdder onAdd={(li) => setItems((xs) => [...xs, li])} />

        {items.length > 0 && (
          <table className="data mt-2">
            <thead><tr><th>{t('المنتج', 'Product')}</th><th className="num">{t('كمية', 'Qty')}</th><th className="num">{t('كلفة', 'Cost')}</th><th></th></tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.key}>
                  <td>{it.label}</td><td className="num">{formatNumber(it.quantity)}</td><td className="num">{formatNumber(it.unit_cost, 2)}</td>
                  <td><button type="button" className="btn btn--sm btn--ghost" onClick={() => setItems((xs) => xs.filter((x) => x.key !== it.key))}>{t('حذف', 'Delete')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <button className="btn btn--primary btn--block mt-2" disabled={busy}>{busy ? <span className="spinner" /> : t('تسجيل الشراء', 'Record purchase')}</button>
        <p className="faint small mt-2">{t('للمنتجات بالكمية يرتفع الرصيد تلقائيًا. القطع المسلسلة تُضاف بأرقامها من شاشة «المنتجات».', 'For by-quantity products stock rises automatically. Serialized units are added with their serial numbers from the Products screen.')}</p>
      </div>
    </form>
  )
}

function PurchaseItemAdder({ onAdd }: { onAdd: (li: PurchaseLine) => void }) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ProductHit[]>([])
  const [picked, setPicked] = useState<ProductHit | null>(null)
  const [qty, setQty] = useState('1')
  const [cost, setCost] = useState('')

  useEffect(() => {
    if (picked) return
    const h = setTimeout(async () => {
      const q = query.trim()
      if (!q) { setHits([]); return }
      const safe = q.replace(/[%,()*]/g, ' ')
      const { data } = await supabase.from('products').select('id, code, brand, model').eq('is_active', true)
        .or(`brand.ilike.*${safe}*,model.ilike.*${safe}*,code.ilike.*${safe}*`).limit(6)
      setHits((data ?? []) as ProductHit[])
    }, 250)
    return () => clearTimeout(h)
  }, [query, picked])

  if (!picked) {
    return (
      <div className="field">
        <label>{t('إضافة بند', 'Add line')}</label>
        <input className="input" placeholder={t('ابحث عن منتج…', 'Search for a product…')} value={query} onChange={(e) => setQuery(e.target.value)} />
        {hits.length > 0 && (
          <div className="card mt-2"><div className="table-wrap"><table className="data"><tbody>
            {hits.map((h) => (
              <tr key={h.id} style={{ cursor: 'pointer' }} onClick={() => setPicked(h)}>
                <td className="num">{h.code}</td><td><span className="cell-emoji" aria-hidden>{pickEmoji(h.brand, h.model, h.code)}</span>{`${h.brand ?? ''} ${h.model ?? ''}`.trim()}</td>
              </tr>
            ))}
          </tbody></table></div></div>
        )}
      </div>
    )
  }

  return (
    <div className="card" style={{ background: 'var(--c-surface-2)' }}><div className="card__body">
      <div className="between"><strong><span className="cell-emoji" aria-hidden>{pickEmoji(picked.brand, picked.model, picked.code)}</span>{`${picked.brand ?? ''} ${picked.model ?? ''}`.trim() || picked.code}</strong>
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => { setPicked(null); setQuery('') }}>{t('إلغاء', 'Cancel')}</button></div>
      <div className="row mt-2">
        <div className="field" style={{ maxWidth: 120 }}><label>{t('الكمية', 'Quantity')}</label><input className="input num" dir="ltr" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        <div className="field" style={{ maxWidth: 150 }}><label>{t('الكلفة/وحدة', 'Cost / unit')}</label><input className="input num" dir="ltr" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
      </div>
      <button type="button" className="btn btn--primary" onClick={() => {
        onAdd({ key: crypto.randomUUID(), product_id: picked.id, label: `${picked.brand ?? ''} ${picked.model ?? ''}`.trim() || picked.code, quantity: Number(qty) || 1, unit_cost: Number(cost) || 0 })
        setPicked(null); setQuery(''); setQty('1'); setCost('')
      }}>{t('إضافة', 'Add')}</button>
    </div></div>
  )
}
