import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../i18n/i18n'
import PageHeader from '../components/PageHeader'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import { useToast } from '../components/Toast'
import { phoneSearchDigits, displayPhone } from '../lib/phone'
import { formatUsd, formatNumber, formatDate, balanceClass } from '../lib/format'
import type { CustomerBalance, Customer } from '../lib/types'

type Filter = 'all' | 'debt' | 'overdue' | 'settled' | 'archived'

const FETCH_BATCH_SIZE = 1000
const PAGE_SIZE = 24

export default function Customers() {
  const { t } = useI18n()
  const { profile } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const canManage = profile != null && ['owner', 'sales', 'accountant'].includes(profile.role)

  const [all, setAll] = useState<CustomerBalance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [page, setPage] = useState(1)

  const [editing, setEditing] = useState<Customer | null>(null)
  const [confirm, setConfirm] = useState<{ c: CustomerBalance; archive: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  async function reload() {
    setLoading(true)
    setError(null)
    const customers: CustomerBalance[] = []
    let from = 0

    while (true) {
      const { data, error } = await supabase
        .from('v_customer_balances')
        .select('*')
        .order('balance_usd', { ascending: false })
        .order('customer_id', { ascending: true })
        .range(from, from + FETCH_BATCH_SIZE - 1)

      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }

      const batch = (data ?? []) as CustomerBalance[]
      customers.push(...batch)
      if (batch.length < FETCH_BATCH_SIZE) break
      from += FETCH_BATCH_SIZE
    }

    setAll(customers)
    setLoading(false)
  }

  useEffect(() => { void reload() }, [])

  const stats = useMemo(() => {
    const active = all.filter((c) => c.status !== 'inactive')
    const outstanding = active.reduce((s, c) => s + Math.max(0, c.balance_usd), 0)
    const inDebt = active.filter((c) => c.balance_usd > 0.005).length
    return {
      total: all.length,
      active: active.length,
      outstanding,
      inDebt,
      overdue: active.filter((c) => c.payment_tracking_status === 'overdue').length,
      settled: active.length - inDebt,
      archived: all.length - active.length,
    }
  }, [all])

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase()
    const digits = phoneSearchDigits(query)
    return all.filter((c) => {
      const archived = c.status === 'inactive'
      if (filter === 'archived') { if (!archived) return false }
      else {
        if (archived) return false
        if (filter === 'debt' && c.balance_usd <= 0.005) return false
        if (filter === 'overdue' && c.payment_tracking_status !== 'overdue') return false
        if (filter === 'settled' && c.balance_usd > 0.005) return false
      }
      if (!term && !digits) return true
      return (
        c.full_name.toLowerCase().includes(term) ||
        c.code.toLowerCase().includes(term) ||
        (!!digits && (c.phone ?? '').includes(digits))
      )
    })
  }, [all, query, filter])

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageRows = useMemo(
    () => rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [rows, currentPage],
  )
  const rangeStart = rows.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, rows.length)

  useEffect(() => { setPage(1) }, [query, filter])
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const initial = (name: string) => name.trim().charAt(0).toUpperCase() || '؟'

  async function openEdit(c: CustomerBalance) {
    const { data } = await supabase.from('customers').select('*').eq('id', c.customer_id).maybeSingle()
    if (data) setEditing(data as Customer)
  }

  async function applyArchive() {
    if (!confirm) return
    setBusy(true)
    const { error } = await supabase
      .from('customers')
      .update({ status: confirm.archive ? 'inactive' : 'active' })
      .eq('id', confirm.c.customer_id)
    setBusy(false)
    if (error) { toast(error.message, 'danger'); return }
    toast(confirm.archive ? t('تمّت أرشفة الزبون', 'Customer archived') : t('تمّت استعادة الزبون', 'Customer restored'))
    setConfirm(null)
    await reload()
  }

  return (
    <div>
      <PageHeader
        eyebrow={t('العلاقات', 'Relationships')}
        title={t('الزبائن', 'Customers')}
        subtitle={t(
          `${stats.total} زبون · ديون مستحقّة ${formatUsd(stats.outstanding)}`,
          `${stats.total} customers · ${formatUsd(stats.outstanding)} outstanding`,
        )}
        actions={<button className="btn btn--primary" onClick={() => navigate('/customers/new')}>{t('+ زبون جديد', '+ New customer')}</button>}
      />

      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-card__label">{t('إجمالي الزبائن', 'Total customers')}</div>
          <div className="stat-card__value num">{formatNumber(stats.total)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">{t('الديون المستحقّة', 'Outstanding')}</div>
          <div className="stat-card__value num money--debt">{formatUsd(stats.outstanding)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">{t('زبائن مدينون', 'Customers in debt')}</div>
          <div className="stat-card__value num">{formatNumber(stats.inDebt)}</div>
        </div>
      </div>

      <div className="toolbar">
        <div className="toolbar__search">
          <input
            className="input"
            placeholder={t('ابحث بالاسم أو رقم الهاتف أو رقم الملف (C-00001)…', 'Search by name, phone, or file number (C-00001)…')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>
        <div className="pills">
          {([
            { k: 'all', label: t('الكل', 'All'), count: stats.active },
            { k: 'debt', label: t('لديهم ديون', 'In debt'), count: stats.inDebt },
            { k: 'overdue', label: t('متأخرون بالدفع', 'Payment overdue'), count: stats.overdue },
            { k: 'settled', label: t('مسدّدون', 'Settled'), count: stats.settled },
            { k: 'archived', label: t('المؤرشفة', 'Archived'), count: stats.archived },
          ] as { k: Filter; label: string; count: number }[]).map((p) => (
            <button key={p.k} type="button" className={`pill ${filter === p.k ? 'is-active' : ''}`} onClick={() => setFilter(p.k)}>
              {p.label}<span className="pill__count">{formatNumber(p.count)}</span>
            </button>
          ))}
        </div>
      </div>

      {error && <div className="alert alert--danger">{error}</div>}

      <div className="panel">
        {loading ? (
          <div style={{ textAlign: 'center', padding: 'var(--sp-6)' }}><span className="spinner" /></div>
        ) : rows.length === 0 ? (
          <div className="empty" style={{ border: 'none' }}>
            {query.trim() || filter !== 'all' ? t('لا نتائج مطابقة.', 'No matches.') : t('لا زبائن بعد.', 'No customers yet.')}
          </div>
        ) : (
          <div className="card-grid">
            {pageRows.map((c) => {
              const totalCharges = c.purchases_usd + c.manual_balance_usd
              const paidPct = totalCharges > 0 ? Math.min(100, Math.round((c.paid_usd / totalCharges) * 100)) : 100
              const archived = c.status === 'inactive'
              return (
                <div key={c.customer_id} className="ent-card">
                  <div className="ent-card__body">
                    <div className="ent-card__top">
                      <div className="ent-avatar">{initial(c.full_name)}</div>
                      <div className="ent-card__ident">
                        <div className="ent-card__name">
                          {c.full_name}
                          {archived && <span className="badge badge--muted" style={{ marginInlineStart: 6 }}>{t('مؤرشف', 'Archived')}</span>}
                        </div>
                        <div className="small num faint">{c.code}{c.area ? ` · ${c.area}` : ''}</div>
                        <div className="small num">{displayPhone(c.phone)}</div>
                      </div>
                    </div>

                    <div className="between" style={{ marginBottom: 'var(--sp-1)' }}>
                      <span className="small faint">{t('الرصيد', 'Balance')}</span>
                      <span className={`num ${balanceClass(c.balance_usd)}`} style={{ fontWeight: 800, fontSize: 'var(--fs-lg)' }}>
                        {formatUsd(c.balance_usd)}
                      </span>
                    </div>
                    {c.next_payment_due_date && c.balance_usd > 0.005 && (
                      <div className="between small" style={{ marginBottom: 'var(--sp-2)' }}>
                        <span className="faint">{t('الدفعة التالية', 'Next payment')}</span>
                        <span className={`num badge ${c.payment_tracking_status === 'overdue' ? 'badge--danger' : c.payment_tracking_status === 'due_today' ? 'badge--warn' : 'badge--muted'}`}>
                          {formatDate(c.next_payment_due_date)}
                          {c.payment_tracking_status === 'overdue' && ` · ${c.payment_days_overdue} ${t('يوم', 'days')}`}
                        </span>
                      </div>
                    )}
                    <div className="bar"><div className="bar__fill" style={{ width: `${paidPct}%` }} /></div>
                    <div className="between small faint" style={{ marginTop: 'var(--sp-1)' }}>
                      <span className="num">{formatUsd(c.paid_usd)} {t('مدفوع', 'paid')}</span>
                      <span className="num">{c.open_orders} {t('فواتير مفتوحة', 'open')}</span>
                    </div>
                  </div>

                  <div className="ent-card__actions">
                    <button type="button" className="ent-card__action" onClick={() => navigate(`/customers/${c.customer_id}`)}>
                      {t('فتح', 'Open')}
                    </button>
                    {canManage && !archived && (
                      <button type="button" className="ent-card__action" onClick={() => void openEdit(c)}>
                        {t('تعديل', 'Edit')}
                      </button>
                    )}
                    {canManage && (
                      archived ? (
                        <button type="button" className="ent-card__action" onClick={() => setConfirm({ c, archive: false })}>
                          {t('استعادة', 'Restore')}
                        </button>
                      ) : (
                        <button type="button" className="ent-card__action ent-card__action--danger" onClick={() => setConfirm({ c, archive: true })}>
                          {t('أرشفة', 'Archive')}
                        </button>
                      )
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {!loading && rows.length > 0 && (
        <CustomerPagination
          page={currentPage}
          totalPages={totalPages}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          totalRows={rows.length}
          onPageChange={setPage}
          t={t}
        />
      )}

      {editing && (
        <Modal open onClose={() => setEditing(null)} title={t('تعديل الزبون', 'Edit customer')}>
          <CustomerEditForm customer={editing} onSaved={() => { setEditing(null); toast(t('تم حفظ التعديلات', 'Changes saved')); void reload() }} />
        </Modal>
      )}

      <ConfirmDialog
        open={!!confirm}
        danger={confirm?.archive}
        busy={busy}
        title={confirm?.archive ? t('أرشفة الزبون', 'Archive customer') : t('استعادة الزبون', 'Restore customer')}
        message={confirm?.archive
          ? t(`سيُخفى «${confirm?.c.full_name}» من القوائم مع الاحتفاظ بكامل سجله. يمكن استعادته لاحقًا.`,
              `“${confirm?.c.full_name}” will be hidden from lists while keeping its full history. You can restore it later.`)
          : t(`إعادة «${confirm?.c.full_name}» إلى القوائم النشطة.`, `Bring “${confirm?.c.full_name}” back to the active lists.`)}
        confirmLabel={confirm?.archive ? t('أرشفة', 'Archive') : t('استعادة', 'Restore')}
        onConfirm={() => void applyArchive()}
        onClose={() => setConfirm(null)}
      />
    </div>
  )
}

function CustomerPagination({
  page,
  totalPages,
  rangeStart,
  rangeEnd,
  totalRows,
  onPageChange,
  t,
}: {
  page: number
  totalPages: number
  rangeStart: number
  rangeEnd: number
  totalRows: number
  onPageChange: (page: number) => void
  t: (ar: string, en: string) => string
}) {
  const firstPage = Math.max(1, Math.min(page - 2, totalPages - 4))
  const pages = Array.from(
    { length: Math.min(5, totalPages) },
    (_, index) => firstPage + index,
  )

  function go(nextPage: number) {
    onPageChange(Math.max(1, Math.min(nextPage, totalPages)))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <nav className="pagination" aria-label={t('صفحات الزبائن', 'Customer pages')}>
      <div className="pagination__summary num">
        {t(
          `عرض ${rangeStart}–${rangeEnd} من ${totalRows}`,
          `Showing ${rangeStart}–${rangeEnd} of ${totalRows}`,
        )}
      </div>
      {totalPages > 1 && (
        <div className="pagination__controls">
          <button className="pagination__button" type="button" onClick={() => go(1)} disabled={page === 1} aria-label={t('الصفحة الأولى', 'First page')}>«</button>
          <button className="pagination__button pagination__button--wide" type="button" onClick={() => go(page - 1)} disabled={page === 1}>{t('السابق', 'Previous')}</button>
          <div className="pagination__pages">
            {pages.map((number) => (
              <button
                className={`pagination__button ${number === page ? 'is-active' : ''}`}
                type="button"
                key={number}
                onClick={() => go(number)}
                aria-current={number === page ? 'page' : undefined}
                aria-label={t(`الصفحة ${number}`, `Page ${number}`)}
              >
                {number}
              </button>
            ))}
          </div>
          <button className="pagination__button pagination__button--wide" type="button" onClick={() => go(page + 1)} disabled={page === totalPages}>{t('التالي', 'Next')}</button>
          <button className="pagination__button" type="button" onClick={() => go(totalPages)} disabled={page === totalPages} aria-label={t('الصفحة الأخيرة', 'Last page')}>»</button>
        </div>
      )}
    </nav>
  )
}

function CustomerEditForm({ customer, onSaved }: { customer: Customer; onSaved: () => void }) {
  const { t } = useI18n()
  const [form, setForm] = useState({
    full_name: customer.full_name,
    phone_raw: customer.phone_raw ?? '',
    phone2_raw: customer.phone2_raw ?? '',
    area: customer.area ?? '',
    address: customer.address ?? '',
    national_id: customer.national_id ?? '',
    guarantor_name: customer.guarantor_name ?? '',
    guarantor_phone: customer.guarantor_phone ?? '',
    manual_balance_usd: String(customer.manual_balance_usd ?? 0),
    manual_last_payment_date: customer.manual_last_payment_date ?? '',
    notes: customer.notes ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!form.full_name.trim()) return setError(t('الاسم مطلوب', 'Name is required'))
    const manualBalance = Number(form.manual_balance_usd || '0')
    if (!Number.isFinite(manualBalance) || manualBalance < 0) {
      return setError(t('أدخل رصيدًا صحيحًا لا يقل عن صفر', 'Enter a valid balance of zero or more'))
    }
    setBusy(true)
    const { error } = await supabase
      .from('customers')
      .update({
        full_name: form.full_name.trim(),
        phone_raw: form.phone_raw.trim() || null,
        phone2_raw: form.phone2_raw.trim() || null,
        area: form.area.trim() || null,
        address: form.address.trim() || null,
        national_id: form.national_id.trim() || null,
        guarantor_name: form.guarantor_name.trim() || null,
        guarantor_phone: form.guarantor_phone.trim() || null,
        manual_balance_usd: manualBalance,
        manual_last_payment_date: form.manual_last_payment_date || null,
        notes: form.notes.trim() || null,
      })
      .eq('id', customer.id)
    setBusy(false)
    if (error) return setError(error.message)
    onSaved()
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="alert alert--danger">{error}</div>}
      <div className="field">
        <label>{t('الاسم الكامل *', 'Full name *')}</label>
        <input className="input" value={form.full_name} onChange={(e) => update('full_name', e.target.value)} required />
      </div>
      <div className="row">
        <div className="field"><label>{t('الهاتف الأساسي', 'Primary phone')}</label><input className="input num" dir="ltr" value={form.phone_raw} onChange={(e) => update('phone_raw', e.target.value)} /></div>
        <div className="field"><label>{t('هاتف إضافي', 'Secondary phone')}</label><input className="input num" dir="ltr" value={form.phone2_raw} onChange={(e) => update('phone2_raw', e.target.value)} /></div>
      </div>
      <div className="row">
        <div className="field"><label>{t('المنطقة', 'Area')}</label><input className="input" value={form.area} onChange={(e) => update('area', e.target.value)} /></div>
        <div className="field"><label>{t('رقم الهوية', 'National ID')}</label><input className="input" value={form.national_id} onChange={(e) => update('national_id', e.target.value)} /></div>
      </div>
      <div className="field"><label>{t('العنوان', 'Address')}</label><input className="input" value={form.address} onChange={(e) => update('address', e.target.value)} /></div>
      <div className="row">
        <div className="field"><label>{t('اسم الكفيل', 'Guarantor name')}</label><input className="input" value={form.guarantor_name} onChange={(e) => update('guarantor_name', e.target.value)} /></div>
        <div className="field"><label>{t('هاتف الكفيل', 'Guarantor phone')}</label><input className="input num" dir="ltr" value={form.guarantor_phone} onChange={(e) => update('guarantor_phone', e.target.value)} /></div>
      </div>
      <div className="field">
        <label>{t('الرصيد اليدوي (دولار)', 'Manual balance (USD)')}</label>
        <input
          className="input num"
          dir="ltr"
          inputMode="decimal"
          type="number"
          min="0"
          step="0.01"
          value={form.manual_balance_usd}
          onChange={(e) => update('manual_balance_usd', e.target.value)}
        />
        <div className="faint small mt-1">
          {t('يمكن تعديله بدون إضافة منتجات أو فاتورة.', 'Can be edited without adding products or an invoice.')}
        </div>
      </div>
      <div className="field">
        <label>{t('تاريخ آخر دفعة', 'Last payment date')}</label>
        <input
          className="input num"
          dir="ltr"
          type="date"
          value={form.manual_last_payment_date}
          onChange={(e) => update('manual_last_payment_date', e.target.value)}
        />
        <div className="faint small mt-1">
          {t('موعد الدفعة التالية يُحسب تلقائيًا بعد شهر.', 'The next payment is automatically due one month later.')}
        </div>
      </div>
      <div className="field"><label>{t('ملاحظات', 'Notes')}</label><textarea className="textarea" rows={2} value={form.notes} onChange={(e) => update('notes', e.target.value)} /></div>
      <button className="btn btn--primary btn--block" type="submit" disabled={busy}>{busy ? <span className="spinner" /> : t('حفظ التغييرات', 'Save changes')}</button>
    </form>
  )
}
