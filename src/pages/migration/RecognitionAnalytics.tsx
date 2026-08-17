import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useI18n } from '../../i18n/i18n'
import PageHeader from '../../components/PageHeader'
import { formatNumber } from '../../lib/format'

/* eslint-disable @typescript-eslint/no-explicit-any */
async function countOf(table: string, filter?: (q: any) => any): Promise<number> {
  let q: any = supabase.from(table).select('*', { count: 'exact', head: true })
  if (filter) q = filter(q)
  const { count, error } = await q
  return error ? 0 : (count ?? 0)
}

export default function RecognitionAnalytics() {
  const { t } = useI18n()
  const [c, setC] = useState<Record<string, number> | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    ;(async () => {
      const [documents, runs, fields, corrections, approved, vocab, abbr, imported] = await Promise.all([
        countOf('migration_documents'),
        countOf('migration_extraction_runs'),
        countOf('migration_extracted_fields'),
        countOf('migration_recognition_corrections'),
        countOf('migration_recognition_corrections', (q) => q.eq('approved_for_learning', true)),
        countOf('migration_vocabulary'),
        countOf('migration_abbreviations'),
        countOf('migration_customers', (q) => q.eq('status', 'imported')),
      ])
      if (!active) return
      setC({ documents, runs, fields, corrections, approved, vocab, abbr, imported })
      setLoading(false)
    })()
    return () => { active = false }
  }, [])

  if (loading) return <span className="spinner" />
  if (!c) return null

  const correctionRate = c.fields > 0 ? Math.round((c.corrections / c.fields) * 100) : 0

  const cards = [
    { label: t('المستندات', 'Documents'), v: c.documents },
    { label: t('عمليات الاستخراج', 'Extraction runs'), v: c.runs },
    { label: t('الحقول المستخرجة', 'Extracted fields'), v: c.fields },
    { label: t('التصحيحات', 'Corrections'), v: c.corrections },
    { label: t('معتمدة للتعلّم', 'Approved for learning'), v: c.approved },
    { label: t('مصطلحات القاموس', 'Vocabulary terms'), v: c.vocab },
    { label: t('الاختصارات', 'Abbreviations'), v: c.abbr },
    { label: t('سجلات مستورَدة', 'Imported records'), v: c.imported },
  ]

  return (
    <div>
      <PageHeader eyebrow={t('الترحيل', 'Migration')} title={t('تحليلات القراءة', 'Recognition Analytics')} subtitle={t('دقّة القراءة الآلية ومعدّلات التصحيح', 'OCR accuracy and correction rates')} />
      <div className="card" style={{ marginBottom: 'var(--sp-4)' }}>
        <div className="card__body between">
          <strong>{t('نسبة التصحيح البشري', 'Human correction rate')}</strong>
          <span className="num">{correctionRate}%</span>
        </div>
      </div>
      <div className="grid grid--kpi">
        {cards.map((k) => (
          <div className="card kpi" key={k.label}>
            <div className="kpi__label">{k.label}</div>
            <div className="kpi__value num">{formatNumber(k.v)}</div>
          </div>
        ))}
      </div>
      <p className="faint small mt-4">
        {t('تُحسب الدقّة فقط مقابل التصحيحات الموثّقة.', 'Accuracy is measured only against verified corrections.')}
      </p>
    </div>
  )
}
