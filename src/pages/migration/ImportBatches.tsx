import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { useI18n } from '../../i18n/i18n'
import PageHeader from '../../components/PageHeader'
import Modal from '../../components/Modal'
import { useToast } from '../../components/Toast'
import { formatDateTimeSeconds, timeAgo, formatNumber } from '../../lib/format'
import { displayPhone } from '../../lib/phone'

interface ReadyRow {
  id: string
  code: string
  full_name: string | null
  phone: string | null
  national_id: string | null
  area: string | null
  opening_balance: number | null
  currency: string | null
  source_reference: string | null
  dup_live_count: number
}
interface Batch {
  id: string
  code: string
  name: string | null
  status: string
  customers_count: number
  created_at: string
  rolled_back_at: string | null
}

const BATCH_BADGE: Record<string, string> = {
  completed: 'badge--ok', importing: 'badge--info', draft: 'badge--muted',
  failed: 'badge--danger', rolled_back: 'badge--muted', previewed: 'badge--warn',
}
const BATCH_LABEL: Record<string, { ar: string; en: string }> = {
  completed: { ar: 'مكتملة', en: 'Completed' }, importing: { ar: 'قيد الاستيراد', en: 'Importing' },
  draft: { ar: 'مسودة', en: 'Draft' }, failed: { ar: 'فشلت', en: 'Failed' },
  rolled_back: { ar: 'متراجَع عنها', en: 'Rolled back' }, previewed: { ar: 'معاينة', en: 'Previewed' },
}

export default function ImportBatches() {
  const { t } = useI18n()
  const { hasRole } = useAuth()
  const { toast } = useToast()
  const isOwner = hasRole('owner')

  const [ready, setReady] = useState<ReadyRow[]>([])
  const [batches, setBatches] = useState<Batch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [rollbackFor, setRollbackFor] = useState<Batch | null>(null)
  const [reason, setReason] = useState('')

  async function reload() {
    const [r, b] = await Promise.all([
      supabase.from('v_mig_import_ready').select('*').order('code'),
      supabase.from('migration_import_batches').select('id, code, name, status, customers_count, created_at, rolled_back_at').order('created_at', { ascending: false }),
    ])
    if (r.error || b.error) setError((r.error || b.error)!.message)
    setReady((r.data ?? []) as ReadyRow[])
    setBatches((b.data ?? []) as Batch[])
    setLoading(false)
  }
  useEffect(() => { void reload() }, [])

  const stats = useMemo(() => ({
    ready: ready.length,
    total: batches.length,
    completed: batches.filter((b) => b.status === 'completed').length,
    rolledBack: batches.filter((b) => b.status === 'rolled_back').length,
  }), [ready, batches])

  async function runImport() {
    setError(null); setBusy(true)
    const { data, error } = await supabase.rpc('mig_import_batch', { p_name: name.trim() || null, p_ids: null })
    setBusy(false)
    if (error) { toast(error.message, 'danger'); return }
    const batch = (Array.isArray(data) ? data[0] : data) as Batch
    toast(t(`تم استيراد ${batch.customers_count} سجلًا — دفعة ${batch.code}`, `Imported ${batch.customers_count} records — batch ${batch.code}`))
    setName('')
    await reload()
  }

  async function runRollback() {
    if (!rollbackFor) return
    if (!reason.trim()) { toast(t('سبب التراجع مطلوب', 'Rollback reason required'), 'danger'); return }
    setBusy(true)
    const { error } = await supabase.rpc('mig_rollback_batch', { p_batch_id: rollbackFor.id, p_reason: reason.trim() })
    setBusy(false)
    if (error) { toast(error.message, 'danger'); return }
    toast(t('تم التراجع عن الدفعة', 'Batch rolled back'))
    setRollbackFor(null); setReason('')
    await reload()
  }

  const batchLabel = (s: string) => (BATCH_LABEL[s] ? t(BATCH_LABEL[s].ar, BATCH_LABEL[s].en) : s)

  if (loading) return <span className="spinner" />

  return (
    <div>
      <PageHeader eyebrow={t('الترحيل', 'Migration')} title={t('دفعات الاستيراد', 'Import Batches')} subtitle={t('سجل عمليات الاستيراد وإمكانية التراجع', 'Import runs and rollback history')} />
      {error && <div className="alert alert--danger">{error}</div>}

      <div className="stat-cards">
        <div className="stat-card"><div className="stat-card__label">{t('جاهز للاستيراد', 'Ready to import')}</div><div className="stat-card__value num">{formatNumber(stats.ready)}</div></div>
        <div className="stat-card"><div className="stat-card__label">{t('إجمالي الدفعات', 'Total batches')}</div><div className="stat-card__value num">{formatNumber(stats.total)}</div></div>
        <div className="stat-card"><div className="stat-card__label">{t('مكتملة', 'Completed')}</div><div className="stat-card__value num">{formatNumber(stats.completed)}</div></div>
        <div className="stat-card"><div className="stat-card__label">{t('متراجَع عنها', 'Rolled back')}</div><div className="stat-card__value num">{formatNumber(stats.rolledBack)}</div></div>
      </div>

      {/* معاينة الاستيراد — جدول (بيانات صفّية) داخل لوح */}
      <div className="card">
        <div className="card__header between">
          <span>{t('جاهز للاستيراد', 'Ready to import')} ({ready.length})</span>
          {isOwner && ready.length > 0 && (
            <div className="row" style={{ alignItems: 'center' }}>
              <input className="input" style={{ maxWidth: 200 }} placeholder={t('اسم الدفعة (اختياري)', 'Batch name (optional)')} value={name} onChange={(e) => setName(e.target.value)} />
              <button className="btn btn--primary btn--sm" disabled={busy} onClick={() => void runImport()}>
                {busy ? <span className="spinner" /> : t('استيراد الكل', 'Import all')}
              </button>
            </div>
          )}
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t('الرقم', 'Code')}</th><th>{t('الاسم', 'Name')}</th><th>{t('الهاتف', 'Phone')}</th>
                <th>{t('الهوية', 'National ID')}</th><th>{t('المرجع', 'Reference')}</th><th>{t('تحذير', 'Warning')}</th>
              </tr>
            </thead>
            <tbody>
              {ready.map((r) => (
                <tr key={r.id}>
                  <td className="num">{r.code}</td>
                  <td>{r.full_name || '—'}</td>
                  <td className="num">{displayPhone(r.phone)}</td>
                  <td className="num">{r.national_id ?? '—'}</td>
                  <td className="num">{r.source_reference ?? '—'}</td>
                  <td>{r.dup_live_count > 0 && <span className="badge badge--warn">{t('تطابق محتمل', 'Possible dup')}: {r.dup_live_count}</span>}</td>
                </tr>
              ))}
              {ready.length === 0 && <tr><td colSpan={6}><div className="empty">{t('لا سجلات معتمدة للاستيراد.', 'No approved records.')}</div></td></tr>}
            </tbody>
          </table>
        </div>
        <div className="card__body faint small">
          {t('يُستورَد اسم الزبون وهاتفه وعنوانه وكفيله ورقم هويته، ويبقى كل سجل مرتبطًا بمستنده. الرصيد الافتتاحي محفوظ ولا يُستورَد بعد.',
             'Name, phone, address, guarantor and ID are imported; each record stays linked to its document. Opening balance is preserved but not yet imported.')}
        </div>
      </div>

      {/* سجل الدفعات — شبكة بطاقات */}
      <div className="eyebrow" style={{ margin: 'var(--sp-5) 0 var(--sp-2)' }}>{t('سجل الدفعات', 'Batch history')}</div>
      <div className="panel">
        {batches.length === 0 ? (
          <div className="empty" style={{ border: 'none' }}>{t('لا دفعات بعد.', 'No batches yet.')}</div>
        ) : (
          <div className="card-grid">
            {batches.map((b) => (
              <div key={b.id} className="ent-card">
                <div className="ent-card__body">
                  <div className="ent-card__top">
                    <div className="ent-avatar">📥</div>
                    <div className="ent-card__ident">
                      <div className="ent-card__name">{b.code}</div>
                      <div className="small faint">{b.name ?? '—'}</div>
                      <div style={{ marginTop: 4 }}><span className={`badge ${BATCH_BADGE[b.status] ?? 'badge--muted'}`}>{batchLabel(b.status)}</span></div>
                    </div>
                  </div>
                  <div className="between small faint" style={{ marginBottom: 'var(--sp-1)' }}>
                    <span>{t('سجلات', 'Records')}</span>
                    <span className="num" style={{ fontWeight: 800, color: 'var(--c-text)' }}>{formatNumber(b.customers_count)}</span>
                  </div>
                  <div className="between small faint">
                    <span className="num">{formatDateTimeSeconds(b.created_at)}</span>
                    <span>{timeAgo(b.created_at)}</span>
                  </div>
                </div>
                {isOwner && b.status === 'completed' && (
                  <div className="ent-card__actions">
                    <button type="button" className="ent-card__action ent-card__action--danger" onClick={() => { setRollbackFor(b); setReason('') }}>{t('تراجع', 'Roll back')}</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {rollbackFor && (
        <Modal open onClose={() => { if (!busy) { setRollbackFor(null); setReason('') } }} title={`${t('التراجع عن الدفعة', 'Roll back batch')} ${rollbackFor.code}`}>
          <p className="muted small" style={{ marginTop: 0 }}>
            {t('سيُلغى استيراد سجلات هذه الدفعة من النظام الحيّ. هذا الإجراء مسجّل في سجل التدقيق.',
               'This removes the imported records of this batch from the live system. The action is recorded in the audit log.')}
          </p>
          <div className="field">
            <label>{t('سبب التراجع', 'Rollback reason')}</label>
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn--ghost" disabled={busy} onClick={() => { setRollbackFor(null); setReason('') }}>{t('إلغاء', 'Cancel')}</button>
            <button className="btn btn--danger" disabled={busy || !reason.trim()} onClick={() => void runRollback()}>{busy ? <span className="spinner" /> : t('تأكيد التراجع', 'Confirm rollback')}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
