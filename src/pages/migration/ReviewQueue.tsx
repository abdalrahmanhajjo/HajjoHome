import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { useI18n } from '../../i18n/i18n'
import PageHeader from '../../components/PageHeader'
import Modal from '../../components/Modal'
import { useToast } from '../../components/Toast'
import { displayPhone } from '../../lib/phone'
import { formatUsd, formatDateTimeSeconds, timeAgo, formatNumber } from '../../lib/format'
import type { MigCustomer, MigStatus } from '../../migration/types'

export default function ReviewQueue() {
  const { t } = useI18n()
  const { profile } = useAuth()
  const { toast } = useToast()
  const [rows, setRows] = useState<MigCustomer[]>([])
  const [review, setReview] = useState<MigCustomer | null>(null)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    const { data, error } = await supabase
      .from('migration_customers')
      .select('*')
      .eq('status', 'ready_for_review')
      .order('created_at', { ascending: true })
      .limit(300)
    if (error) setError(error.message)
    else setRows((data ?? []) as MigCustomer[])
    setLoading(false)
  }
  useEffect(() => { void reload() }, [])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return rows
    const digits = s.replace(/\D+/g, '')
    return rows.filter((r) =>
      (r.full_name_ar ?? '').toLowerCase().includes(s) ||
      (r.full_name_en ?? '').toLowerCase().includes(s) ||
      r.code.toLowerCase().includes(s) ||
      (r.source_reference ?? '').toLowerCase().includes(s) ||
      (!!digits && (r.phone ?? '').includes(digits)),
    )
  }, [rows, q])

  async function decide(id: string, status: MigStatus, label: string) {
    setBusy(true)
    setError(null)
    const patch: Record<string, unknown> = { status, reviewed_by: profile?.id ?? null, reviewed_at: new Date().toISOString() }
    if (status === 'approved_for_import') { patch.approved_by = profile?.id ?? null; patch.approved_at = new Date().toISOString() }
    const { error } = await supabase.from('migration_customers').update(patch).eq('id', id)
    setBusy(false)
    if (error) { toast(error.message, 'danger'); return }
    toast(label)
    setReview(null)
    await reload()
  }

  const initial = (r: MigCustomer) => (r.full_name_ar || r.full_name_en || '؟').trim().charAt(0).toUpperCase()

  if (loading) return <span className="spinner" />

  return (
    <div>
      <PageHeader
        eyebrow={t('الترحيل', 'Migration')}
        title={t('قائمة المراجعة', 'Review Queue')}
        subtitle={t(`${filtered.length} سجل بانتظار مراجعة بشرية`, `${filtered.length} records awaiting human review`)}
      />
      {error && <div className="alert alert--danger">{error}</div>}

      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-card__label">{t('بانتظار المراجعة', 'Awaiting review')}</div>
          <div className="stat-card__value num">{formatNumber(rows.length)}</div>
        </div>
      </div>

      <div className="toolbar">
        <div className="toolbar__search">
          <input className="input" placeholder={t('ابحث بالاسم أو الرقم أو الهاتف أو المرجع…', 'Search name, code, phone, or reference…')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <div className="panel">
        {filtered.length === 0 ? (
          <div className="empty" style={{ border: 'none' }}>{rows.length === 0 ? t('لا سجلات للمراجعة.', 'Nothing to review.') : t('لا نتائج مطابقة.', 'No matches.')}</div>
        ) : (
          <div className="card-grid">
            {filtered.map((r) => (
              <div key={r.id} className="ent-card">
                <div className="ent-card__body">
                  <div className="ent-card__top">
                    <div className="ent-avatar">{initial(r)}</div>
                    <div className="ent-card__ident">
                      <div className="ent-card__name">{r.full_name_ar || r.full_name_en || '—'}</div>
                      <div className="small num faint">{r.code}{r.source_reference ? ` · ${r.source_reference}` : ''}</div>
                      <div className="small num">{displayPhone(r.phone)}</div>
                    </div>
                  </div>
                  <div className="between" style={{ marginBottom: 'var(--sp-1)' }}>
                    <span className="small faint">{t('رصيد افتتاحي', 'Opening balance')}</span>
                    <span className="num" style={{ fontWeight: 800 }}>{r.opening_balance != null ? formatUsd(r.opening_balance) : '—'}</span>
                  </div>
                  <div className="between small faint">
                    <span className="num">{formatDateTimeSeconds(r.created_at)}</span>
                    <span>{timeAgo(r.created_at)}</span>
                  </div>
                </div>
                <div className="ent-card__actions">
                  <button type="button" className="ent-card__action" onClick={() => setReview(r)}>{t('مراجعة', 'Review')}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {review && (
        <Modal open onClose={() => { if (!busy) setReview(null) }} title={`${t('مراجعة', 'Review')}: ${review.full_name_ar || review.full_name_en || review.code}`}>
          <div className="review-grid">
            <Detail label={t('الاسم عربي', 'Name (AR)')} value={review.full_name_ar} />
            <Detail label={t('الاسم إنجليزي', 'Name (EN)')} value={review.full_name_en} />
            <Detail label={t('الهاتف', 'Phone')} value={review.phone_raw} />
            <Detail label={t('الهوية', 'National ID')} value={review.national_id} />
            <Detail label={t('المنطقة', 'Area')} value={review.area} />
            <Detail label={t('العنوان', 'Address')} value={review.raw_address} />
            <Detail label={t('الكفيل', 'Guarantor')} value={review.guarantor_name} />
            <Detail label={t('هاتف الكفيل', 'Guarantor phone')} value={review.guarantor_phone_raw} />
            <Detail label={t('رقم قديم', 'Old ref')} value={review.old_customer_ref} />
            <Detail label={t('رصيد افتتاحي', 'Opening balance')} value={review.opening_balance != null ? formatUsd(review.opening_balance) : null} />
            <Detail label={t('ملاحظات', 'Notes')} value={review.notes} />
          </div>
          <div className="row mt-4">
            <button className="btn btn--primary btn--sm" disabled={busy} onClick={() => void decide(review.id, 'approved_for_import', t('تمّ الاعتماد', 'Approved'))}>{t('اعتماد', 'Approve')}</button>
            <button className="btn btn--sm" disabled={busy} onClick={() => void decide(review.id, 'needs_correction', t('أُعيد للتصحيح', 'Sent back'))}>{t('إعادة للتصحيح', 'Send back')}</button>
            <button className="btn btn--sm" disabled={busy} onClick={() => void decide(review.id, 'needs_owner_review', t('أُحيل لصاحب المحل', 'Sent to owner'))}>{t('لصاحب المحل', 'To owner')}</button>
            <button className="btn btn--danger btn--sm" disabled={busy} onClick={() => void decide(review.id, 'rejected', t('تمّ الرفض', 'Rejected'))}>{t('رفض', 'Reject')}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="field" style={{ marginBottom: 0 }}>
      <label>{label}</label>
      <div>{value || '—'}</div>
    </div>
  )
}
