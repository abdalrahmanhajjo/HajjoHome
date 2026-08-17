import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useI18n } from '../../i18n/i18n'
import PageHeader from '../../components/PageHeader'
import Modal from '../../components/Modal'
import ConfirmDialog from '../../components/ConfirmDialog'
import { useToast } from '../../components/Toast'
import { formatDateTimeSeconds, timeAgo, formatNumber } from '../../lib/format'
import { DOC_CATEGORY_LABELS, type MigDocument, type MigDocCategory } from '../../migration/types'

const BUCKET = 'legacy-docs'

// حالة المستند (enum: mig_doc_status)
const DOC_STATUS_LABELS: Record<string, { ar: string; en: string; badge: string }> = {
  uploaded: { ar: 'مرفوع', en: 'Uploaded', badge: 'badge--muted' },
  preprocessing: { ar: 'تهيئة', en: 'Preprocessing', badge: 'badge--info' },
  processed: { ar: 'مُعالَج', en: 'Processed', badge: 'badge--info' },
  ocr_pending: { ar: 'بانتظار القراءة', en: 'OCR pending', badge: 'badge--muted' },
  ocr_done: { ar: 'تمّت القراءة', en: 'OCR done', badge: 'badge--ok' },
  ocr_failed: { ar: 'فشل القراءة', en: 'OCR failed', badge: 'badge--danger' },
  entered: { ar: 'أُدخِل', en: 'Entered', badge: 'badge--ok' },
  error: { ar: 'خطأ', en: 'Error', badge: 'badge--danger' },
}

// حالة القراءة الآلية (عمود ocr_status النصّي: none/pending/done/failed)
const OCR_LABELS: Record<string, { ar: string; en: string; badge: string }> = {
  none: { ar: 'لم يبدأ', en: 'None', badge: 'badge--muted' },
  pending: { ar: 'قيد المعالجة', en: 'Pending', badge: 'badge--info' },
  done: { ar: 'مكتمل', en: 'Done', badge: 'badge--ok' },
  failed: { ar: 'فشل', en: 'Failed', badge: 'badge--danger' },
}

// إيموجي لكل نوع مستند (يظهر كأيقونة البطاقة)
const DOC_EMOJI: Record<string, string> = {
  customer_notebook: '📒',
  sales_invoice: '🧾',
  payment_receipt: '💵',
  installment_agreement: '📝',
  warranty_document: '🛡️',
  identity_document: '🪪',
  guarantor_document: '🤝',
  supplier_invoice: '🚚',
  delivery_note: '📦',
  other: '📄',
}

function ocrMeta(s: string) {
  return OCR_LABELS[s] ?? { ar: s, en: s, badge: 'badge--muted' }
}
function statusMeta(s: string) {
  return DOC_STATUS_LABELS[s] ?? { ar: s, en: s, badge: 'badge--muted' }
}

export default function Documents() {
  const { t, lang } = useI18n()
  const { toast } = useToast()
  const [rows, setRows] = useState<MigDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [q, setQ] = useState('')
  const [category, setCategory] = useState<string>('all')
  const [status, setStatus] = useState<string>('all')
  const [ocr, setOcr] = useState<string>('all')
  const [year, setYear] = useState<string>('all')

  const [showArchived, setShowArchived] = useState(false)
  const [replaceFor, setReplaceFor] = useState<MigDocument | null>(null)
  const [confirmDel, setConfirmDel] = useState<MigDocument | null>(null)
  const [busy, setBusy] = useState(false)

  async function reload() {
    const { data, error } = await supabase
      .from('migration_documents')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)
    if (error) setError(error.message)
    else setRows((data ?? []) as MigDocument[])
    setLoading(false)
  }

  useEffect(() => { void reload() }, [])

  async function archiveDoc(archive: boolean, doc: MigDocument) {
    setBusy(true)
    const { error } = await supabase
      .from('migration_documents')
      .update({ archived_at: archive ? new Date().toISOString() : null })
      .eq('id', doc.id)
    setBusy(false)
    if (error) {
      // العمود غير موجود بعد → وجّه المستخدم لتشغيل الترحيل
      if (/archived_at/.test(error.message) && /column|does not exist|schema cache/i.test(error.message)) {
        setError(t(
          'الحذف يحتاج تشغيل تعديل قاعدة البيانات أولًا: أضِف العمود archived_at (انظر الرسالة أدناه).',
          'Delete needs a one-time DB migration first: add the archived_at column (see note below).',
        ))
      } else {
        setError(error.message)
        toast(error.message, 'danger')
      }
      return
    }
    toast(archive ? t('تمّت أرشفة المستند', 'Document archived') : t('تمّت الاستعادة', 'Document restored'))
    setConfirmDel(null)
    await reload()
  }

  // خيارات المرشّحات المشتقّة من البيانات
  const years = useMemo(
    () => [...new Set(rows.map((r) => r.doc_year).filter((y): y is number => y != null))].sort((a, b) => b - a),
    [rows],
  )
  const categoriesInUse = useMemo(
    () => [...new Set(rows.map((r) => r.category))],
    [rows],
  )
  const statusesInUse = useMemo(
    () => [...new Set(rows.map((r) => r.status))],
    [rows],
  )

  const archivedCount = useMemo(() => rows.filter((r) => r.archived_at).length, [rows])

  const stats = useMemo(() => {
    const active = rows.filter((r) => !r.archived_at)
    return {
      total: active.length,
      ocrDone: active.filter((r) => r.ocr_status === 'done').length,
      pending: active.filter((r) => ['none', 'pending'].includes(r.ocr_status)).length,
      entered: active.filter((r) => r.status === 'entered').length,
    }
  }, [rows])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (showArchived !== !!r.archived_at) return false
      if (category !== 'all' && r.category !== category) return false
      if (status !== 'all' && r.status !== status) return false
      if (ocr !== 'all' && r.ocr_status !== ocr) return false
      if (year !== 'all' && String(r.doc_year ?? '') !== year) return false
      if (!s) return true
      return (
        r.source_reference.toLowerCase().includes(s) ||
        (r.original_filename ?? '').toLowerCase().includes(s) ||
        (r.notebook_no ?? '').toLowerCase().includes(s) ||
        (r.page_no ?? '').toLowerCase().includes(s) ||
        (r.notes ?? '').toLowerCase().includes(s)
      )
    })
  }, [rows, q, category, status, ocr, year])

  const activeFilters = [category, status, ocr, year].filter((f) => f !== 'all').length + (q.trim() ? 1 : 0)

  function clearFilters() {
    setQ(''); setCategory('all'); setStatus('all'); setOcr('all'); setYear('all')
  }

  if (loading) return <span className="spinner" />

  return (
    <div>
      <PageHeader
        eyebrow={t('الترحيل', 'Migration')}
        title={t('المستندات', 'Documents')}
        subtitle={t(`${filtered.length} من ${rows.length} مستند`, `${filtered.length} of ${rows.length} documents`)}
        actions={<Link to="/migration/upload" className="btn btn--primary">{t('رفع', 'Upload')}</Link>}
      />
      {error && <div className="alert alert--danger">{error}</div>}

      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-card__label">{t('إجمالي المستندات', 'Total documents')}</div>
          <div className="stat-card__value num">{formatNumber(stats.total)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">{t('اكتمل الاستخراج', 'OCR completed')}</div>
          <div className="stat-card__value num">{formatNumber(stats.ocrDone)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">{t('بانتظار المعالجة', 'Awaiting OCR')}</div>
          <div className="stat-card__value num">{formatNumber(stats.pending)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">{t('أُدخِلت', 'Entered')}</div>
          <div className="stat-card__value num">{formatNumber(stats.entered)}</div>
        </div>
      </div>

      <div className="toolbar">
        <div className="toolbar__search">
          <input className="input" placeholder={t('ابحث بالمرجع أو الملف أو الدفتر أو الملاحظات…', 'Search reference, file, notebook, or notes…')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="select" style={{ maxWidth: 170 }} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">{t('كل الأنواع', 'All categories')}</option>
          {categoriesInUse.map((c) => <option key={c} value={c}>{DOC_CATEGORY_LABELS[c as MigDocCategory]?.[lang] ?? c}</option>)}
        </select>
        <select className="select" style={{ maxWidth: 170 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">{t('كل الحالات', 'All statuses')}</option>
          {statusesInUse.map((s) => <option key={s} value={s}>{statusMeta(s)[lang]}</option>)}
        </select>
        <select className="select" style={{ maxWidth: 150 }} value={ocr} onChange={(e) => setOcr(e.target.value)}>
          <option value="all">{t('كل حالات القراءة', 'All OCR')}</option>
          {Object.keys(OCR_LABELS).map((s) => <option key={s} value={s}>{OCR_LABELS[s][lang]}</option>)}
        </select>
        <select className="select" style={{ maxWidth: 120 }} value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="all">{t('كل السنوات', 'All years')}</option>
          {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
        </select>
        <button type="button" className={`pill ${showArchived ? 'is-active' : ''}`} onClick={() => setShowArchived((v) => !v)}>
          {t('المؤرشفة', 'Archived')}{archivedCount > 0 && <span className="pill__count">{archivedCount}</span>}
        </button>
        {activeFilters > 0 && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={clearFilters}>{t('مسح المرشّحات', 'Clear')} ({activeFilters})</button>
        )}
      </div>

      <div className="panel">
        {filtered.length === 0 ? (
          <div className="empty" style={{ border: 'none' }}>
            {rows.length === 0 ? t('لا مستندات.', 'No documents.') : t('لا نتائج مطابقة للمرشّحات.', 'No documents match the filters.')}
          </div>
        ) : (
          <div className="card-grid">
            {filtered.map((d) => {
              const st = statusMeta(d.status)
              const oc = ocrMeta(d.ocr_status)
              const archived = !!d.archived_at
              return (
                <div key={d.id} className="ent-card">
                  <div className="ent-card__body">
                    <div className="ent-card__top">
                      <div className="ent-avatar">{DOC_EMOJI[d.category] ?? '📄'}</div>
                      <div className="ent-card__ident">
                        <div className="ent-card__name">
                          {d.source_reference}
                          {archived && <span className="badge badge--muted" style={{ marginInlineStart: 6 }}>{t('مؤرشف', 'Archived')}</span>}
                        </div>
                        <div className="small faint">
                          {DOC_CATEGORY_LABELS[d.category]?.[lang] ?? d.category}
                          {[d.notebook_no, d.page_no].filter(Boolean).length > 0 && ` · ${[d.notebook_no, d.page_no].filter(Boolean).join(' / ')}`}
                          {d.doc_year ? ` · ${d.doc_year}` : ''}
                        </div>
                        <div className="small faint" title={d.original_filename ?? ''} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {d.original_filename ?? '—'}{d.file_type ? ` · ${d.file_type.split('/').pop()}` : ''}
                        </div>
                      </div>
                    </div>

                    <div className="row" style={{ gap: 'var(--sp-1)', marginBottom: 'var(--sp-2)' }}>
                      <span className={`badge ${st.badge}`}>{st[lang]}</span>
                      <span className={`badge ${oc.badge}`}>OCR: {oc[lang]}</span>
                    </div>

                    {d.notes && <div className="small faint" style={{ marginBottom: 'var(--sp-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.notes}</div>}

                    <div className="between small faint">
                      <span className="num">{formatDateTimeSeconds(d.created_at)}</span>
                      <span>{timeAgo(d.created_at)}</span>
                    </div>
                  </div>

                  <div className="ent-card__actions">
                    {archived ? (
                      <button type="button" className="ent-card__action" onClick={() => void archiveDoc(false, d)} disabled={busy}>{t('استعادة', 'Restore')}</button>
                    ) : (
                      <>
                        <Link className="ent-card__action" to={`/migration/entry?doc=${d.id}`}>{t('إدخال', 'Enter')}</Link>
                        <button type="button" className="ent-card__action" onClick={() => setReplaceFor(d)}>{t('استبدال', 'Replace')}</button>
                        <button type="button" className="ent-card__action ent-card__action--danger" onClick={() => setConfirmDel(d)}>{t('حذف', 'Delete')}</button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {replaceFor && (
        <Modal open onClose={() => { if (!busy) setReplaceFor(null) }} title={t('استبدال ملف المستند', 'Replace document file')}>
          <ReplaceFileModal
            doc={replaceFor}
            onDone={() => { setReplaceFor(null); toast(t('تم استبدال الملف', 'File replaced')); void reload() }}
          />
        </Modal>
      )}

      <ConfirmDialog
        open={!!confirmDel}
        danger
        busy={busy}
        title={t('حذف المستند', 'Delete document')}
        message={t(
          `سيُؤرشَف «${confirmDel?.source_reference}» ويُخفى من القائمة مع الاحتفاظ بالملف وبيانات الإدخال. يمكن استعادته لاحقًا من زرّ «المؤرشفة».`,
          `“${confirmDel?.source_reference}” will be archived and hidden from the list while keeping the file and entered data. You can restore it later via the “Archived” toggle.`,
        )}
        confirmLabel={t('حذف', 'Delete')}
        onConfirm={() => { if (confirmDel) void archiveDoc(true, confirmDel) }}
        onClose={() => setConfirmDel(null)}
      />
    </div>
  )
}

function ReplaceFileModal({ doc, onDone }: { doc: MigDocument; onDone: () => void }) {
  const { t } = useI18n()
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!file) return setError(t('اختر ملفًا', 'Choose a file'))
    setError(null)
    setBusy(true)

    const safe = file.name.replace(/[^\w.\-]+/g, '_')
    const path = `${Date.now()}-${safe}`
    const up = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false })
    if (up.error) {
      setBusy(false)
      return setError(`${t('فشل الرفع', 'Upload failed')}: ${up.error.message}`)
    }

    const { error: updErr } = await supabase
      .from('migration_documents')
      .update({
        storage_path: up.data.path,
        original_filename: file.name,
        file_type: file.type || null,
        file_size: file.size,
        ocr_status: 'none',
      })
      .eq('id', doc.id)

    if (updErr) {
      // نظّف الملف الجديد إذا فشل التحديث
      await supabase.storage.from(BUCKET).remove([up.data.path])
      setBusy(false)
      return setError(updErr.message)
    }

    // احذف الملف القديم لتفادي الملفات اليتيمة
    if (doc.storage_path) await supabase.storage.from(BUCKET).remove([doc.storage_path])
    setBusy(false)
    onDone()
  }

  return (
    <div>
      {error && <div className="alert alert--danger">{error}</div>}
      <p className="faint small" style={{ marginTop: 0 }}>
        {t('المرجع', 'Reference')}: <span className="num">{doc.source_reference}</span>
      </p>
      <p className="muted small">
        {t('سيحلّ الملف الجديد محلّ القديم وتُعاد حالة القراءة الآلية إلى «لم يبدأ» لإعادة الاستخراج. لا تتأثّر البيانات المُدخَلة يدويًا.',
           'The new file replaces the old one and OCR status resets to “not started” for re-extraction. Manually entered data is not affected.')}
      </p>
      <div className="field">
        <label>{t('الملف الجديد (صورة أو PDF)', 'New file (image or PDF)')}</label>
        <input className="input" type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
      <button className="btn btn--primary btn--block" onClick={() => void submit()} disabled={busy || !file}>
        {busy ? <span className="spinner" /> : t('استبدال', 'Replace')}
      </button>
    </div>
  )
}
