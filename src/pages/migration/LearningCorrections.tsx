import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { useI18n } from '../../i18n/i18n'
import PageHeader from '../../components/PageHeader'
import { formatDate } from '../../lib/format'

interface Corr {
  id: string
  field_type: string
  detected_text: string | null
  corrected_text: string | null
  correction_status: string
  approved_for_learning: boolean
  created_at: string
}

export default function LearningCorrections() {
  const { t } = useI18n()
  const { profile, hasRole } = useAuth()
  const isOwner = hasRole('owner')
  const [rows, setRows] = useState<Corr[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function reload() {
    setLoading(true)
    const { data, error } = await supabase
      .from('migration_recognition_corrections')
      .select('id, field_type, detected_text, corrected_text, correction_status, approved_for_learning, created_at')
      .order('created_at', { ascending: false })
      .limit(500)
    if (error) setError(error.message)
    else setRows((data ?? []) as Corr[])
    setLoading(false)
  }
  useEffect(() => { void reload() }, [])

  async function approve(c: Corr) {
    setBusy(true); setError(null)
    const { error } = await supabase.from('migration_recognition_corrections')
      .update({ approved_for_learning: true }).eq('id', c.id)
    if (!error) {
      await supabase.from('migration_learning_examples').insert({
        correction_id: c.id, text: c.corrected_text, field_type: c.field_type,
        language: 'ar', verified: true, approved_by: profile?.id ?? null,
      })
    }
    setBusy(false)
    if (error) return setError(error.message)
    reload()
  }

  async function exportDataset() {
    setBusy(true); setError(null); setMsg(null)
    const { data, error } = await supabase
      .from('migration_recognition_corrections')
      .select('field_type, corrected_text')
      .eq('approved_for_learning', true)
      .limit(10000)
    setBusy(false)
    if (error) return setError(error.message)
    const lines = (data ?? [])
      .filter((r) => r.corrected_text)
      .map((r) => JSON.stringify({ text: r.corrected_text, fieldType: r.field_type, language: 'ar', verified: true }))
    const blob = new Blob([lines.join('\n')], { type: 'application/x-ndjson' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `labels-${new Date().toISOString().slice(0, 10)}.jsonl`
    a.click()
    URL.revokeObjectURL(url)
    setMsg(t(`تم تصدير ${lines.length} مثالًا`, `Exported ${lines.length} examples`))
  }

  if (loading) return <span className="spinner" />

  return (
    <div>
      <PageHeader
        eyebrow={t('الترحيل', 'Migration')}
        title={t('تصحيحات التعلّم', 'Learning Corrections')}
        subtitle={t('تصحيحات بشرية تحسّن القراءة الآلية', 'Human fixes that improve OCR over time')}
        actions={
          isOwner ? (
            <button className="btn" disabled={busy} onClick={() => void exportDataset()}>
              {t('تصدير مجموعة بيانات (JSONL)', 'Export dataset (JSONL)')}
            </button>
          ) : undefined
        }
      />
      {error && <div className="alert alert--danger">{error}</div>}
      {msg && <div className="alert alert--ok">{msg}</div>}
      <p className="faint small">
        {t('تُلتقط تلقائيًا عندما يصحّح المُدخِل اقتراح OCR. يُعتمد التعلّم يدويًا فقط، والحقول الحسّاسة تحتاج موافقة صريحة.',
           'Captured when an operator corrects an OCR suggestion. Learning is approved manually only; sensitive fields need explicit approval.')}
      </p>

      <div className="card mt-2">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>{t('الحقل', 'Field')}</th><th>{t('المقروء آليًا', 'Detected')}</th><th>{t('المصحّح', 'Corrected')}</th><th>{t('التاريخ', 'Date')}</th><th>{t('التعلّم', 'Learning')}</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="num">{r.field_type}</td>
                  <td className="faint">{r.detected_text ?? '—'}</td>
                  <td><strong>{r.corrected_text ?? '—'}</strong></td>
                  <td className="num">{formatDate(r.created_at)}</td>
                  <td>
                    {r.approved_for_learning ? (
                      <span className="badge badge--ok">{t('معتمد', 'Approved')}</span>
                    ) : isOwner ? (
                      <button className="btn btn--sm btn--primary" disabled={busy} onClick={() => void approve(r)}>{t('اعتماد', 'Approve')}</button>
                    ) : (
                      <span className="badge badge--muted">{t('بانتظار المدير', 'Pending')}</span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5}><div className="empty">{t('لا تصحيحات بعد.', 'No corrections yet.')}</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
