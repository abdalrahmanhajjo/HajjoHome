import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../i18n/i18n'
import PageHeader from '../components/PageHeader'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import EmojiThumb from '../components/EmojiThumb'
import { useToast } from '../components/Toast'
import { formatUsd, formatNumber } from '../lib/format'
import { productEmoji, categoryEmoji } from '../lib/emoji'
import type { Category, Product, ProductUnit, StockLevel } from '../lib/types'

type StockFilter = 'any' | 'in' | 'low' | 'out'

export default function Products() {
  const { profile } = useAuth()
  const { t } = useI18n()
  const { toast } = useToast()
  const canManage = profile?.role === 'owner' || profile?.role === 'stock'
  const canSetCost = profile?.role === 'owner'

  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [stock, setStock] = useState<Record<string, StockLevel>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [stockFilter, setStockFilter] = useState<StockFilter>('any')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [unitsFor, setUnitsFor] = useState<Product | null>(null)
  const [confirmDel, setConfirmDel] = useState<Product | null>(null)
  const [delBusy, setDelBusy] = useState(false)

  async function deactivate() {
    if (!confirmDel) return
    setDelBusy(true)
    const { error } = await supabase.from('products').update({ is_active: false }).eq('id', confirmDel.id)
    setDelBusy(false)
    if (error) { toast(error.message, 'danger'); return }
    toast(t('تم حذف المنتج', 'Product deleted'))
    setConfirmDel(null)
    void reload()
  }

  async function reload() {
    setLoading(true)
    const [cat, prod, lv] = await Promise.all([
      supabase.from('categories').select('*').order('sort_order'),
      supabase.from('products').select('*').eq('is_active', true).order('code'),
      supabase.from('v_stock_levels').select('*'),
    ])
    const firstErr = cat.error || prod.error || lv.error
    if (firstErr) setError(firstErr.message)
    setCategories((cat.data ?? []) as Category[])
    setProducts((prod.data ?? []) as Product[])
    const map: Record<string, StockLevel> = {}
    for (const r of (lv.data ?? []) as StockLevel[]) map[r.product_id] = r
    setStock(map)
    setLoading(false)
  }

  useEffect(() => { void reload() }, [])

  const catName = (p: Product) => categories.find((c) => c.id === p.category_id)?.name ?? '—'

  const stockStatus = (p: Product): StockFilter => {
    const lv = stock[p.id]
    const avail = lv?.available_qty ?? 0
    if (avail <= 0) return 'out'
    if (lv?.needs_reorder) return 'low'
    return 'in'
  }

  const catCounts = useMemo(() => {
    const counts: Record<string, number> = { all: products.length }
    for (const p of products) counts[p.category_id] = (counts[p.category_id] ?? 0) + 1
    return counts
  }, [products])

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase()
    return products.filter((p) => {
      if (category !== 'all' && p.category_id !== category) return false
      if (stockFilter !== 'any' && stockStatus(p) !== stockFilter) return false
      if (!term) return true
      return (
        (p.brand ?? '').toLowerCase().includes(term) ||
        (p.model ?? '').toLowerCase().includes(term) ||
        p.code.toLowerCase().includes(term)
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, query, category, stockFilter, stock])

  const lowCount = useMemo(() => products.filter((p) => stockStatus(p) !== 'in').length, [products, stock])

  const stockOpts: { value: StockFilter; label: string }[] = [
    { value: 'any', label: t('كل المخزون', 'All stock') },
    { value: 'in', label: t('متوفّر', 'In stock') },
    { value: 'low', label: t('منخفض', 'Low stock') },
    { value: 'out', label: t('نافد', 'Out of stock') },
  ]

  return (
    <div>
      <PageHeader
        eyebrow={t('الكتالوج', 'Catalog')}
        title={t('المنتجات', 'Products')}
        subtitle={t(
          `${products.length} منتج في ${categories.length} فئة`,
          `${products.length} products across ${categories.length} categories`,
        )}
        actions={canManage ? <button className="btn btn--primary" onClick={() => { setEditing(null); setFormOpen(true) }}>{t('+ منتج جديد', '+ Add product')}</button> : undefined}
      />

      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-card__label">{t('إجمالي المنتجات', 'Total products')}</div>
          <div className="stat-card__value num">{formatNumber(products.length)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">{t('الفئات', 'Categories')}</div>
          <div className="stat-card__value num">{formatNumber(categories.length)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">{t('يحتاج إعادة طلب', 'Needs reorder')}</div>
          <div className="stat-card__value num" style={{ color: lowCount > 0 ? 'var(--c-danger)' : undefined }}>{formatNumber(lowCount)}</div>
        </div>
      </div>

      {error && <div className="alert alert--danger">{error}</div>}

      <div className="toolbar">
        <div className="toolbar__search">
          <input className="input" placeholder={t('ابحث بالماركة أو الموديل أو الرمز…', 'Search by brand, model, or code…')} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className="select" style={{ maxWidth: 170 }} value={stockFilter} onChange={(e) => setStockFilter(e.target.value as StockFilter)}>
          {stockOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div className="pills" style={{ marginBottom: 'var(--sp-4)' }}>
        <button type="button" className={`pill ${category === 'all' ? 'is-active' : ''}`} onClick={() => setCategory('all')}>
          {t('الكل', 'All')}<span className="pill__count">{catCounts.all ?? 0}</span>
        </button>
        {categories.map((c) => (
          <button key={c.id} type="button" className={`pill ${category === c.id ? 'is-active' : ''}`} onClick={() => setCategory(c.id)}>
            <span className="pill__emoji" aria-hidden>{categoryEmoji(c.name)}</span>{c.name}<span className="pill__count">{catCounts[c.id] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="panel">
        {loading ? (
          <div style={{ textAlign: 'center', padding: 'var(--sp-6)' }}><span className="spinner" /></div>
        ) : rows.length === 0 ? (
          <div className="empty" style={{ border: 'none' }}>
            {query.trim() || category !== 'all' || stockFilter !== 'any' ? t('لا منتجات مطابقة.', 'No matching products.') : t('لا منتجات بعد.', 'No products yet.')}
          </div>
        ) : (
          <div className="card-grid card-grid--tight">
            {rows.map((p) => {
              const lv = stock[p.id]
              const st = stockStatus(p)
              const badge = st === 'in' ? 'badge--ok' : st === 'low' ? 'badge--warn' : 'badge--danger'
              const label = st === 'in' ? t('متوفّر', 'In stock') : st === 'low' ? t('منخفض', 'Low') : t('نافد', 'Out')
              return (
                <div key={p.id} className="prod-card">
                  <div className="prod-card__media">
                    <span aria-hidden>{productEmoji(p, catName(p))}</span>
                    <span className="prod-card__badge"><span className={`badge ${badge}`}>{label}</span></span>
                  </div>
                  <div className="prod-card__info">
                    <div className="prod-card__name">{`${p.brand ?? ''} ${p.model ?? ''}`.trim() || p.code}</div>
                    <div className="small faint num" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.code} · {catName(p)}
                    </div>
                    <div className="prod-card__price num">{p.sale_price != null ? formatUsd(p.sale_price) : '—'}</div>
                    <div className="small faint num" style={{ marginTop: 'var(--sp-1)' }}>
                      {t('المتوفّر', 'Available')}: {formatNumber(lv?.available_qty ?? 0)}
                    </div>
                  </div>
                  {canManage && (
                    <div className="ent-card__actions" style={{ opacity: 1 }}>
                      <button type="button" className="ent-card__action" onClick={() => { setEditing(p); setFormOpen(true) }}>{t('تعديل', 'Edit')}</button>
                      {p.is_serialized && (
                        <button type="button" className="ent-card__action" onClick={() => setUnitsFor(p)}>{t('القطع', 'Units')}</button>
                      )}
                      <button type="button" className="ent-card__action ent-card__action--danger" onClick={() => setConfirmDel(p)}>{t('حذف', 'Delete')}</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {canManage && (
        <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? t('تعديل المنتج', 'Edit product') : t('منتج جديد', 'New product')}>
          <ProductForm
            key={editing?.id ?? 'new'}
            editing={editing}
            categories={categories}
            canSetCost={canSetCost}
            onSaved={() => { setFormOpen(false); toast(editing ? t('تم حفظ التغييرات', 'Changes saved') : t('تم إنشاء المنتج', 'Product created')); void reload() }}
            onAddCategory={reload}
          />
        </Modal>
      )}

      <ConfirmDialog
        open={!!confirmDel}
        danger
        busy={delBusy}
        title={t('حذف المنتج', 'Delete product')}
        message={t(
          `سيُزال «${`${confirmDel?.brand ?? ''} ${confirmDel?.model ?? ''}`.trim() || confirmDel?.code}» من الكتالوج. لن تتأثّر الفواتير السابقة.`,
          `“${`${confirmDel?.brand ?? ''} ${confirmDel?.model ?? ''}`.trim() || confirmDel?.code}” will be removed from the catalog. Past invoices are unaffected.`,
        )}
        confirmLabel={t('حذف', 'Delete')}
        onConfirm={() => void deactivate()}
        onClose={() => setConfirmDel(null)}
      />

      {unitsFor && (
        <Modal open onClose={() => setUnitsFor(null)} title={`${t('قطع', 'Units of')} ${`${unitsFor.brand ?? ''} ${unitsFor.model ?? ''}`.trim() || unitsFor.code}`}>
          <UnitsPanel product={unitsFor} canSetCost={canSetCost} onChanged={reload} />
        </Modal>
      )}
    </div>
  )
}

// ---------------- منتج جديد ----------------
function ProductForm({
  editing,
  categories,
  canSetCost,
  onSaved,
  onAddCategory,
}: {
  editing: Product | null
  categories: Category[]
  canSetCost: boolean
  onSaved: () => void
  onAddCategory: () => void
}) {
  const { t } = useI18n()
  const reorderOf = (editing as unknown as { reorder_level?: number } | null)?.reorder_level ?? 0
  const [categoryId, setCategoryId] = useState(editing?.category_id ?? '')
  const [brand, setBrand] = useState(editing?.brand ?? '')
  const [model, setModel] = useState(editing?.model ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [isSerialized, setIsSerialized] = useState(editing?.is_serialized ?? true)
  const [salePrice, setSalePrice] = useState(editing?.sale_price != null ? String(editing.sale_price) : '')
  const [minPrice, setMinPrice] = useState(editing?.min_price != null ? String(editing.min_price) : '')
  const [warranty, setWarranty] = useState(String(editing?.warranty_months ?? 0))
  const [reorder, setReorder] = useState(String(reorderOf))
  const [cost, setCost] = useState('')
  const [newCat, setNewCat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!categoryId && categories.length > 0) setCategoryId(categories[0].id)
  }, [categories, categoryId])

  async function addCategory() {
    const name = newCat.trim()
    if (!name) return
    const { error } = await supabase.from('categories').insert({ name })
    if (error) { setError(error.message); return }
    setNewCat('')
    onAddCategory()
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!categoryId) return setError(t('اختر الفئة', 'Select a category'))
    if (!brand.trim() && !model.trim()) return setError(t('أدخل الماركة أو الموديل', 'Enter a brand or model'))

    setBusy(true)
    const payload = {
      category_id: categoryId,
      brand: brand.trim() || null,
      model: model.trim() || null,
      description: description.trim() || null,
      is_serialized: isSerialized,
      sale_price: salePrice ? Number(salePrice) : null,
      min_price: minPrice ? Number(minPrice) : null,
      warranty_months: Number(warranty) || 0,
      reorder_level: Number(reorder) || 0,
    }

    let productId: string
    if (editing) {
      const { error } = await supabase.from('products').update(payload).eq('id', editing.id)
      if (error) { setBusy(false); setError(error.message); return }
      productId = editing.id
    } else {
      const { data, error } = await supabase.from('products').insert(payload).select('id, code').single()
      if (error) { setBusy(false); setError(error.message); return }
      productId = (data as Pick<Product, 'id' | 'code'>).id
    }

    if (canSetCost && cost) {
      const { error: costErr } = await supabase
        .from('product_costs')
        .insert({ product_id: productId, purchase_price_usd: Number(cost) })
      if (costErr) {
        setBusy(false)
        setError(t(`حُفظ المنتج لكن تعذّر حفظ الكلفة: ${costErr.message}`, `Product saved but saving the cost failed: ${costErr.message}`))
        onSaved()
        return
      }
    }

    setBusy(false)
    onSaved()
  }

  const previewCatName = categories.find((c) => c.id === categoryId)?.name
  const previewEmoji = productEmoji({ brand, model, description }, previewCatName)

  return (
    <form onSubmit={onSubmit}>
      {error && <div className="alert alert--danger">{error}</div>}

      <div className="row" style={{ alignItems: 'center', gap: 'var(--sp-3)', marginBottom: 'var(--sp-3)' }}>
        <EmojiThumb emoji={previewEmoji} size={52} />
        <div className="small faint">{t('يُختار الإيموجي تلقائيًا حسب الفئة والاسم', 'The emoji is picked automatically from the category and name')}</div>
      </div>

      <div className="field">
        <label>{t('الفئة', 'Category')}</label>
        <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="row">
        <div className="field">
          <input className="input" placeholder={t('فئة جديدة…', 'New category…')} value={newCat} onChange={(e) => setNewCat(e.target.value)} />
        </div>
        <button type="button" className="btn" onClick={() => void addCategory()} disabled={!newCat.trim()}>{t('إضافة فئة', 'Add category')}</button>
      </div>

      <div className="row mt-2">
        <div className="field"><label>{t('الماركة', 'Brand')}</label><input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} /></div>
        <div className="field"><label>{t('الموديل', 'Model')}</label><input className="input" value={model} onChange={(e) => setModel(e.target.value)} /></div>
      </div>

      <div className="field"><label>{t('الوصف', 'Description')}</label><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></div>

      <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={isSerialized} onChange={(e) => setIsSerialized(e.target.checked)} />
        <span>{t('منتج مسلسل (كل قطعة برقم تسلسلي)', 'Serialized product (each unit has a serial number)')}</span>
      </label>

      <div className="row">
        <div className="field"><label>{t('سعر البيع (دولار)', 'Sale price (USD)')}</label><input className="input num" dir="ltr" inputMode="decimal" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} /></div>
        <div className="field"><label>{t('أقل سعر مسموح (دولار)', 'Minimum price (USD)')}</label><input className="input num" dir="ltr" inputMode="decimal" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} /></div>
      </div>

      <div className="row">
        <div className="field"><label>{t('الضمان (شهر)', 'Warranty (months)')}</label><input className="input num" dir="ltr" inputMode="numeric" value={warranty} onChange={(e) => setWarranty(e.target.value)} /></div>
        <div className="field"><label>{t('حد إعادة الطلب', 'Reorder level')}</label><input className="input num" dir="ltr" inputMode="decimal" value={reorder} onChange={(e) => setReorder(e.target.value)} /></div>
      </div>

      {canSetCost && (
        <div className="field"><label>{editing ? t('سعر شراء جديد (اختياري)', 'New purchase cost (optional)') : t('سعر الشراء (دولار) — للمدير فقط', 'Purchase cost (USD) — owner only')}</label><input className="input num" dir="ltr" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
      )}

      <button className="btn btn--primary btn--block" type="submit" disabled={busy}>{busy ? <span className="spinner" /> : (editing ? t('حفظ التغييرات', 'Save changes') : t('حفظ المنتج', 'Save product'))}</button>
    </form>
  )
}

// ---------------- قطع منتج مسلسل ----------------
function UnitsPanel({
  product,
  canSetCost,
  onChanged,
}: {
  product: Product
  canSetCost: boolean
  onChanged: () => void
}) {
  const { t } = useI18n()
  const [units, setUnits] = useState<ProductUnit[]>([])
  const [serial, setSerial] = useState('')
  const [location, setLocation] = useState('')
  const [cost, setCost] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const { data, error } = await supabase
      .from('product_units')
      .select('id, product_id, serial_number, condition, status, location')
      .eq('product_id', product.id)
      .order('serial_number')
    if (error) setError(error.message)
    else setUnits((data ?? []) as ProductUnit[])
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id])

  async function addUnit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!serial.trim()) return setError(t('الرقم التسلسلي مطلوب', 'Serial number is required'))
    setBusy(true)
    const { data, error } = await supabase
      .from('product_units')
      .insert({
        product_id: product.id,
        serial_number: serial.trim(),
        location: location.trim() || null,
        received_at: new Date().toISOString().slice(0, 10),
      })
      .select('id')
      .single()
    if (error) { setBusy(false); setError(error.message); return }
    if (canSetCost && cost) {
      await supabase.from('unit_costs').insert({ product_unit_id: (data as { id: string }).id, cost_usd: Number(cost) })
    }
    setBusy(false)
    setSerial(''); setLocation(''); setCost('')
    await load()
    onChanged()
  }

  const inStock = useMemo(() => units.filter((u) => u.status === 'in_stock').length, [units])

  return (
    <div>
      {error && <div className="alert alert--danger">{error}</div>}
      <p className="faint small">{t('المتوفّر في المخزون', 'In stock')}: <span className="num">{inStock}</span></p>

      <form className="row" onSubmit={addUnit}>
        <div className="field"><label>{t('الرقم التسلسلي', 'Serial number')}</label><input className="input num" dir="ltr" value={serial} onChange={(e) => setSerial(e.target.value)} /></div>
        <div className="field"><label>{t('الموقع', 'Location')}</label><input className="input" value={location} onChange={(e) => setLocation(e.target.value)} /></div>
        {canSetCost && (
          <div className="field" style={{ maxWidth: 160 }}><label>{t('الكلفة (دولار)', 'Cost (USD)')}</label><input className="input num" dir="ltr" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
        )}
        <div className="field" style={{ maxWidth: 140, justifyContent: 'flex-end' }}>
          <button className="btn btn--primary" type="submit" disabled={busy}>{busy ? <span className="spinner" /> : t('إضافة قطعة', 'Add unit')}</button>
        </div>
      </form>

      <div className="table-wrap mt-2">
        <table className="data">
          <thead>
            <tr><th>{t('الرقم التسلسلي', 'Serial number')}</th><th>{t('الحالة', 'Status')}</th><th>{t('الموقع', 'Location')}</th></tr>
          </thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.id}><td className="num">{u.serial_number}</td><td>{u.status}</td><td>{u.location ?? '—'}</td></tr>
            ))}
            {units.length === 0 && <tr><td colSpan={3}><div className="empty" style={{ border: 'none' }}>{t('لا قطع بعد.', 'No units yet.')}</div></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
