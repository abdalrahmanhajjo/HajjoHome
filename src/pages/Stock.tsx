import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../i18n/i18n'
import PageHeader from '../components/PageHeader'
import { formatUsd, formatNumber } from '../lib/format'
import { pickEmoji } from '../lib/emoji'
import type { StockLevel } from '../lib/types'

export default function Stock() {
  const { t } = useI18n()
  const [rows, setRows] = useState<StockLevel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [onlyReorder, setOnlyReorder] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data, error } = await supabase
        .from('v_stock_levels')
        .select('*')
        .order('needs_reorder', { ascending: false })
        .limit(500)
      if (!active) return
      if (error) setError(error.message)
      else setRows((data ?? []) as StockLevel[])
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (onlyReorder && !r.needs_reorder) return false
      if (!q) return true
      return (
        (r.brand ?? '').toLowerCase().includes(q) ||
        (r.model ?? '').toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q)
      )
    })
  }, [rows, query, onlyReorder])

  if (loading) return <span className="spinner" />
  if (error) return <div className="alert alert--danger">{error}</div>

  return (
    <div>
      <PageHeader
        eyebrow={t('المستودع', 'Inventory')}
        title={t('المخزون', 'Stock')}
        subtitle={t(`${rows.length} منتج · ${rows.filter((r) => r.needs_reorder).length} يحتاج إعادة طلب`, `${rows.length} products · ${rows.filter((r) => r.needs_reorder).length} need reorder`)}
      />

      <div className="toolbar">
        <div className="toolbar__search">
          <input
            className="input"
            placeholder={t('ابحث بالماركة أو الموديل أو الرمز…', 'Search by brand, model, or code…')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <label className="field" style={{ maxWidth: 220, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={onlyReorder} onChange={(e) => setOnlyReorder(e.target.checked)} />
          <span>{t('وصلت حد الطلب فقط', 'Reorder only')}</span>
        </label>
      </div>

      <div className="card mt-2">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t('الرمز', 'Code')}</th>
                <th>{t('الماركة', 'Brand')}</th>
                <th>{t('الموديل', 'Model')}</th>
                <th>{t('النوع', 'Type')}</th>
                <th className="num">{t('المتوفّر', 'Available')}</th>
                <th className="num">{t('المحجوز', 'Reserved')}</th>
                <th className="num">{t('حد الطلب', 'Reorder level')}</th>
                <th className="num">{t('سعر البيع', 'Sale price')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.product_id}>
                  <td className="num">{r.code}</td>
                  <td><span className="cell-emoji" aria-hidden>{pickEmoji(r.brand, r.model, r.code)}</span>{r.brand ?? '—'}</td>
                  <td>{r.model ?? '—'}</td>
                  <td>
                    {r.is_serialized ? (
                      <span className="badge badge--info">{t('مسلسل', 'Serialized')}</span>
                    ) : (
                      <span className="badge badge--muted">{t('بالكمية', 'By quantity')}</span>
                    )}
                  </td>
                  <td className="num">{formatNumber(r.available_qty)}</td>
                  <td className="num">{formatNumber(r.reserved_qty)}</td>
                  <td className="num">{formatNumber(r.reorder_level)}</td>
                  <td className="num">{r.sale_price != null ? formatUsd(r.sale_price) : '—'}</td>
                  <td>
                    {r.needs_reorder && <span className="badge badge--danger">{t('أعد الطلب', 'Reorder')}</span>}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9}>
                    <div className="empty">{t('لا منتجات مطابقة.', 'No matching products.')}</div>
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
