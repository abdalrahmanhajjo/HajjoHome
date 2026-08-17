import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { useI18n } from '../../i18n/i18n'
import PageHeader from '../../components/PageHeader'
import { DOC_CATEGORY_LABELS, type MigDocCategory } from '../../migration/types'

const BUCKET = 'legacy-docs'

export default function UploadDocuments() {
  const { profile } = useAuth()
  const { t, lang } = useI18n()

  const [file, setFile] = useState<File | null>(null)
  const [sourceRef, setSourceRef] = useState('')
  const [category, setCategory] = useState<MigDocCategory>('customer_notebook')
  const [notebook, setNotebook] = useState('')
  const [page, setPage] = useState('')
  const [year, setYear] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)

  function suggestRef() {
    if (notebook && page) setSourceRef(`BOOK-${notebook.padStart(3, '0')}-PAGE-${page.padStart(3, '0')}`)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null); setOk(null)
    if (!file) return setError(t('اختر ملفًا', 'Choose a file'))
    if (!sourceRef.trim()) return setError(t('المرجع المصدري مطلوب', 'Source reference required'))
    setBusy(true)

    const safe = file.name.replace(/[^\w.\-]+/g, '_')
    const path = `${Date.now()}-${safe}`
    const up = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false })
    if (up.error) {
      setBusy(false)
      const m = up.error.message
      if (/bucket|not found/i.test(m)) {
        return setError(t(
          `تعذّر الرفع: أنشئ bucket خاصًا باسم «${BUCKET}» من Supabase → Storage.`,
          `Upload failed: create a private bucket named "${BUCKET}" in Supabase → Storage.`
        ))
      }
      return setError(`${t('فشل الرفع', 'Upload failed')}: ${m}`)
    }

    const { error: insErr } = await supabase.from('migration_documents').insert({
      source_reference: sourceRef.trim(),
      original_filename: file.name,
      storage_path: up.data.path,
      file_type: file.type || null,
      file_size: file.size,
      category,
      notebook_no: notebook.trim() || null,
      page_no: page.trim() || null,
      doc_year: year ? Number(year) : null,
      status: 'uploaded',
      uploaded_by: profile?.id ?? null,
    })
    setBusy(false)
    if (insErr) {
      // نظّف الملف المرفوع إذا فشل إنشاء السجل حتى لا يتبقّى ملف يتيم
      await supabase.storage.from(BUCKET).remove([up.data.path])
      if (/duplicate|unique/i.test(insErr.message)) {
        return setError(t('المرجع المصدري مستخدم مسبقًا', 'Source reference already used'))
      }
      return setError(insErr.message)
    }

    setOk(t('تم رفع المستند', 'Document uploaded'))
    setFile(null); setSourceRef(''); setNotebook(''); setPage(''); setYear('')
    setResetKey((k) => k + 1)
  }

  return (
    <div>
      <PageHeader
        eyebrow={t('الترحيل', 'Migration')}
        title={t('رفع المستندات', 'Upload Documents')}
        subtitle={t('ارفع صور صفحات الدفاتر لبدء المعالجة', 'Upload ledger page images to begin processing')}
        actions={<Link to="/migration/documents" className="btn btn--ghost">{t('المستندات', 'Documents')}</Link>}
      />

      <form className="card" onSubmit={submit} style={{ maxWidth: 560 }}>
        <div className="card__body">
          {error && <div className="alert alert--danger">{error}</div>}
          {ok && <div className="alert alert--ok">{ok}</div>}

          <div className="field">
            <label>{t('الملف (صورة أو PDF)', 'File (image or PDF)')}</label>
            <input key={resetKey} className="input" type="file" accept="image/*,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>

          <div className="row">
            <div className="field"><label>{t('رقم الدفتر', 'Notebook')}</label>
              <input className="input num" dir="ltr" value={notebook} onChange={(e) => setNotebook(e.target.value)} onBlur={suggestRef} /></div>
            <div className="field"><label>{t('رقم الصفحة', 'Page')}</label>
              <input className="input num" dir="ltr" value={page} onChange={(e) => setPage(e.target.value)} onBlur={suggestRef} /></div>
            <div className="field" style={{ maxWidth: 110 }}><label>{t('السنة', 'Year')}</label>
              <input className="input num" dir="ltr" value={year} onChange={(e) => setYear(e.target.value)} /></div>
          </div>

          <div className="field">
            <label>{t('المرجع المصدري (فريد)', 'Source reference (unique)')}</label>
            <input className="input num" dir="ltr" placeholder="BOOK-001-PAGE-001" value={sourceRef} onChange={(e) => setSourceRef(e.target.value)} />
          </div>

          <div className="field">
            <label>{t('نوع المستند', 'Category')}</label>
            <select className="select" value={category} onChange={(e) => setCategory(e.target.value as MigDocCategory)}>
              {(Object.keys(DOC_CATEGORY_LABELS) as MigDocCategory[]).map((k) => (
                <option key={k} value={k}>{DOC_CATEGORY_LABELS[k][lang]}</option>
              ))}
            </select>
          </div>

          <button className="btn btn--primary btn--block" disabled={busy}>
            {busy ? <span className="spinner" /> : t('رفع', 'Upload')}
          </button>
          <p className="faint small mt-2">
            {t('يُحفَظ الأصل في تخزين خاص. لا تُشارك وثائق الهوية علنًا.',
               'The original is stored privately. Never share identity documents publicly.')}
          </p>
        </div>
      </form>
    </div>
  )
}
