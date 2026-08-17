import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { useI18n } from '../../i18n/i18n'
import PageHeader from '../../components/PageHeader'
import { FIELD_STATUS_META, type FieldStatus, type MigDocument, type Verification } from '../../migration/types'
import { extractDocument, OCR_TO_FORM, type ExtractedRecord } from '../../migration/extraction'
import { arabicToWestern } from '../../migration/normalize'
import LegacyAccount from './LegacyAccount'

const BUCKET = 'legacy-docs'
const STATUS_CYCLE: FieldStatus[] = ['clear', 'uncertain', 'unreadable', 'missing']

interface FieldDef { name: string; ar: string; en: string; ltr?: boolean; numeric?: boolean }
const FIELDS: FieldDef[] = [
  { name: 'full_name_ar', ar: 'الاسم بالعربية', en: 'Name (Arabic)' },
  { name: 'full_name_en', ar: 'الاسم بالإنجليزية', en: 'Name (English)', ltr: true },
  { name: 'phone_raw', ar: 'الهاتف', en: 'Phone', ltr: true },
  { name: 'phone2_raw', ar: 'هاتف إضافي', en: 'Phone 2', ltr: true },
  { name: 'national_id', ar: 'رقم الهوية', en: 'National ID', ltr: true },
  { name: 'area', ar: 'المنطقة', en: 'Area' },
  { name: 'city', ar: 'المدينة', en: 'City' },
  { name: 'raw_address', ar: 'العنوان', en: 'Address' },
  { name: 'guarantor_name', ar: 'اسم الكفيل', en: 'Guarantor name' },
  { name: 'guarantor_phone_raw', ar: 'هاتف الكفيل', en: 'Guarantor phone', ltr: true },
  { name: 'old_customer_ref', ar: 'رقم الزبون القديم', en: 'Old customer ref', ltr: true },
  { name: 'account_status', ar: 'حالة الحساب', en: 'Account status' },
  { name: 'opening_balance', ar: 'الرصيد الافتتاحي', en: 'Opening balance', ltr: true, numeric: true },
  { name: 'hist_total_purchases', ar: 'إجمالي المشتريات', en: 'Total purchases', ltr: true, numeric: true },
  { name: 'hist_total_paid', ar: 'إجمالي المدفوع', en: 'Total paid', ltr: true, numeric: true },
]

export default function DataEntry() {
  const [params] = useSearchParams()
  const docId = params.get('doc')
  const { t } = useI18n()

  if (!docId) return <EntryQueue />
  return <EntryForm docId={docId} key={docId} t={t} />
}

// قائمة المستندات التي تحتاج إدخالًا
function EntryQueue() {
  const { t } = useI18n()
  const [rows, setRows] = useState<MigDocument[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data } = await supabase
        .from('migration_documents')
        .select('*')
        .in('status', ['uploaded', 'processed', 'ocr_done'])
        .order('created_at', { ascending: true })
        .limit(200)
      if (!active) return
      setRows((data ?? []) as MigDocument[])
      setLoading(false)
    })()
    return () => { active = false }
  }, [])

  if (loading) return <span className="spinner" />
  return (
    <div>
      <PageHeader eyebrow={t('الترحيل', 'Migration')} title={t('قائمة إدخال البيانات', 'Data Entry Queue')} subtitle={t('اختر مستندًا لبدء الإدخال', 'Pick a document to start entry')} />
      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{t('المرجع', 'Reference')}</th><th>{t('الدفتر/الصفحة', 'Notebook/Page')}</th><th></th></tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td className="num">{d.source_reference}</td>
                  <td className="num">{[d.notebook_no, d.page_no].filter(Boolean).join(' / ') || '—'}</td>
                  <td><Link className="btn btn--sm btn--primary" to={`/migration/entry?doc=${d.id}`}>{t('ابدأ', 'Start')}</Link></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={3}><div className="empty">{t('لا مستندات بانتظار الإدخال.', 'Nothing to enter.')}</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function EntryForm({ docId, t }: { docId: string; t: (ar: string, en?: string) => string }) {
  const { profile } = useAuth()
  const [doc, setDoc] = useState<MigDocument | null>(null)
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [verification, setVerification] = useState<Verification>({})
  const [currency, setCurrency] = useState('USD')
  const [notes, setNotes] = useState('')
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [savedCount, setSavedCount] = useState(0)
  const [ocrBusy, setOcrBusy] = useState(false)
  const [ocrMsg, setOcrMsg] = useState<string | null>(null)
  const [ocrDetected, setOcrDetected] = useState<Record<string, string>>({})
  const [ocrRecords, setOcrRecords] = useState<ExtractedRecord[]>([])
  const [ocrRawText, setOcrRawText] = useState('')
  const [showRaw, setShowRaw] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data: d } = await supabase.from('migration_documents').select('*').eq('id', docId).maybeSingle()
      if (!active) return
      setDoc(d as MigDocument | null)
      const path = (d as MigDocument | null)?.storage_path
      if (path) {
        const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
        if (active) setImgUrl(signed?.signedUrl ?? null)
      }
    })()
    return () => { active = false }
  }, [docId])

  const isImage = useMemo(() => (doc?.file_type ?? '').startsWith('image/'), [doc])

  function setField(name: string, value: string) {
    setForm((f) => ({ ...f, [name]: value }))
    setVerification((v) => (v[name] && v[name] !== 'missing' ? v : { ...v, [name]: value ? 'clear' : 'missing' }))
  }
  function cycleStatus(name: string) {
    setVerification((v) => {
      const cur = v[name] ?? 'missing'
      const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(cur) + 1) % STATUS_CYCLE.length]
      return { ...v, [name]: next }
    })
  }

  // تعبئة سجل واحد في النموذج كاقتراحات (كلها "غير مؤكد"). تحويل الأرقام العربية آمن على كل القيم.
  function fillRecord(rec: ExtractedRecord) {
    const detected: Record<string, string> = {}
    for (const fld of rec.fields) {
      const key = OCR_TO_FORM[fld.fieldName]
      if (!key || !fld.rawValue) continue
      detected[key] = arabicToWestern(fld.rawValue)
    }
    setOcrDetected(detected)
    setForm((f) => ({ ...f, ...detected }))
    setVerification((v) => {
      const nv = { ...v }
      for (const key of Object.keys(detected)) nv[key] = 'uncertain'
      return nv
    })
  }
  function recordLabel(rec: ExtractedRecord, i: number): string {
    const nm = rec.fields.find((f) => f.fieldName === 'full_name_ar' || f.fieldName === 'full_name_en')?.rawValue
    return `${i + 1}. ${nm ?? '—'}`
  }

  // قراءة تلقائية للصفحة كاملة — تستخرج كل الزبائن، وتعبّئ الأول.
  async function runOcr() {
    setError(null); setOcrMsg(null); setOcrBusy(true)
    const { data, error } = await extractDocument(docId)
    setOcrBusy(false)
    if (error) { setError(error); return }
    if (!data) return
    setOcrRecords(data.records)
    setOcrRawText(data.rawText)
    if (data.records.length > 0) fillRecord(data.records[0])
    setOcrMsg(t(`قُرئ ${data.records.length} سجل — عبّأتُ الأول`, `Read ${data.records.length} records — filled the first`))
  }

  function buildPayload(status: string) {
    const numeric = (k: string) => (form[k] ? Number(form[k]) : null)
    return {
      document_id: docId,
      source_reference: doc?.source_reference ?? null,
      notebook_no: doc?.notebook_no ?? null,
      page_no: doc?.page_no ?? null,
      full_name_ar: form.full_name_ar?.trim() || null,
      full_name_en: form.full_name_en?.trim() || null,
      phone_raw: form.phone_raw?.trim() || null,
      phone2_raw: form.phone2_raw?.trim() || null,
      national_id: form.national_id?.trim() || null,
      area: form.area?.trim() || null,
      city: form.city?.trim() || null,
      raw_address: form.raw_address?.trim() || null,
      guarantor_name: form.guarantor_name?.trim() || null,
      guarantor_phone_raw: form.guarantor_phone_raw?.trim() || null,
      old_customer_ref: form.old_customer_ref?.trim() || null,
      account_status: form.account_status?.trim() || null,
      opening_balance: numeric('opening_balance'),
      hist_total_purchases: numeric('hist_total_purchases'),
      hist_total_paid: numeric('hist_total_paid'),
      currency,
      notes: notes.trim() || null,
      verification,
      status,
      entered_by: profile?.id ?? null,
    }
  }

  async function save(status: 'data_entry' | 'ready_for_review', thenNew = false) {
    setError(null); setOk(null)
    if (!form.full_name_ar?.trim() && !form.full_name_en?.trim()) {
      return setError(t('أدخل اسم الزبون', 'Enter the customer name'))
    }
    setBusy(true)
    const payload = buildPayload(status)
    let res
    if (currentId) res = await supabase.from('migration_customers').update(payload).eq('id', currentId).select('id').single()
    else res = await supabase.from('migration_customers').insert(payload).select('id').single()
    setBusy(false)
    if (res.error) return setError(res.error.message)

    // التقاط تصحيحات OCR (المقروء آليًا مقابل النهائي) كبيانات تعلّم
    const corrections = Object.entries(ocrDetected)
      .filter(([k, dv]) => (form[k] ?? '').trim() && (form[k] ?? '').trim() !== dv.trim())
      .map(([k, dv]) => ({
        document_id: docId, field_type: k, detected_text: dv,
        corrected_text: (form[k] ?? '').trim(), correction_status: 'verified',
        reviewed_by: profile?.id ?? null, approved_for_learning: false,
      }))
    if (corrections.length) {
      await supabase.from('migration_recognition_corrections').insert(corrections)
      setOcrDetected({})
    }

    setSavedCount((n) => n + (currentId ? 0 : 1))
    if (status === 'ready_for_review') {
      setOk(t('أُرسل السجل للمراجعة', 'Sent for review'))
    } else {
      setOk(t('حُفظ السجل', 'Saved'))
    }
    if (thenNew || status === 'ready_for_review') {
      setForm({}); setVerification({}); setNotes(''); setCurrentId(null)
    } else {
      setCurrentId((res.data as { id: string }).id)
    }
  }

  if (!doc) return <span className="spinner" />

  return (
    <div>
      <div className="no-print">
        <PageHeader
          eyebrow={t('الترحيل', 'Migration')}
          title={t('إدخال البيانات', 'Data Entry')}
          subtitle={
            <>
              <span className="num">{doc.source_reference}</span>
              {savedCount > 0 && <span className="badge badge--ok" style={{ marginInlineStart: 8 }}>{t('سجلات محفوظة', 'saved')}: {savedCount}</span>}
            </>
          }
          actions={<Link to="/migration/entry" className="btn btn--ghost">{t('القائمة', 'Queue')}</Link>}
        />
      </div>

      <div className="entry-grid">
        {/* المستند */}
        <div className="card doc-pane">
          <div className="card__body">
            <div className="between no-print" style={{ marginBottom: 'var(--sp-2)' }}>
              <button className="btn btn--sm" disabled={ocrBusy} onClick={() => void runOcr()}>
                {ocrBusy ? <span className="spinner" /> : t('قراءة تلقائية (OCR)', 'Run OCR')}
              </button>
              {ocrMsg && <span className="badge badge--info">{ocrMsg}</span>}
            </div>

            {ocrRecords.length > 1 && (
              <div className="no-print" style={{ marginBottom: 'var(--sp-2)' }}>
                <div className="faint small" style={{ marginBottom: 4 }}>
                  {t('السجلات المقروءة من الصفحة — اضغط لتعبئة أحدها ثم «حفظ وسجل جديد»', 'Records read from the page — click to fill one, then "Save & new"')}
                </div>
                <div className="row" style={{ gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                  {ocrRecords.map((r, i) => (
                    <button key={i} type="button" className="btn btn--sm btn--ghost" onClick={() => fillRecord(r)}>
                      {recordLabel(r, i)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {ocrRawText && (
              <div className="no-print" style={{ marginBottom: 'var(--sp-2)' }}>
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => setShowRaw((s) => !s)}>
                  {showRaw ? t('إخفاء النص الكامل', 'Hide full text') : t('عرض النص الكامل المقروء', 'Show full transcription')}
                </button>
                {showRaw && <pre className="ocr-raw">{ocrRawText}</pre>}
              </div>
            )}

            {imgUrl ? (
              isImage ? (
                <img src={imgUrl} alt={doc.source_reference} className="doc-img" />
              ) : (
                <div className="empty">
                  <p>{t('ملف PDF', 'PDF file')}</p>
                  <a className="btn btn--sm" href={imgUrl} target="_blank" rel="noreferrer">{t('فتح المستند', 'Open document')}</a>
                </div>
              )
            ) : (
              <div className="empty">{t('لا معاينة متاحة', 'No preview')}</div>
            )}
          </div>
        </div>

        {/* النموذج */}
        <div className="card">
          <div className="card__body">
            {error && <div className="alert alert--danger">{error}</div>}
            {ok && <div className="alert alert--ok">{ok}</div>}

            {FIELDS.map((f) => (
              <FieldRow
                key={f.name}
                def={f}
                t={t}
                value={form[f.name] ?? ''}
                status={verification[f.name] ?? 'missing'}
                onChange={(v) => setField(f.name, v)}
                onCycle={() => cycleStatus(f.name)}
              />
            ))}

            <div className="row">
              <div className="field" style={{ maxWidth: 140 }}>
                <label>{t('العملة', 'Currency')}</label>
                <select className="select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  <option value="USD">USD</option>
                  <option value="LBP">LBP</option>
                  <option value="OTHER">{t('أخرى', 'Other')}</option>
                </select>
              </div>
            </div>

            <div className="field">
              <label>{t('ملاحظات', 'Notes')}</label>
              <textarea className="textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            <div className="row">
              <button className="btn btn--primary" disabled={busy} onClick={() => void save('data_entry')}>
                {busy ? <span className="spinner" /> : t('حفظ', 'Save')}
              </button>
              <button className="btn" disabled={busy} onClick={() => void save('data_entry', true)}>
                {t('حفظ وسجل جديد', 'Save & new')}
              </button>
              <button className="btn btn--ghost" disabled={busy} onClick={() => void save('ready_for_review')}>
                {t('إرسال للمراجعة', 'Submit for review')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {currentId && <LegacyAccount migrationCustomerId={currentId} />}
    </div>
  )
}

function FieldRow({ def, value, status, onChange, onCycle, t }: {
  def: FieldDef
  value: string
  status: FieldStatus
  onChange: (v: string) => void
  onCycle: () => void
  t: (ar: string, en?: string) => string
}) {
  const meta = FIELD_STATUS_META[status]
  return (
    <div className="fieldrow">
      <label className="fieldrow__label">{t(def.ar, def.en)}</label>
      <div className="fieldrow__control">
        <input
          className={`input ${def.ltr ? 'num' : ''}`}
          dir={def.ltr ? 'ltr' : undefined}
          inputMode={def.numeric ? 'decimal' : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" className={`fstatus ${meta.cls}`} onClick={onCycle} title={t('حالة الحقل', 'Field status')}>
          {t(meta.ar, meta.en)}
        </button>
      </div>
    </div>
  )
}
