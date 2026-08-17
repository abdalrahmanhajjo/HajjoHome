import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useI18n } from '../../i18n/i18n'
import PageHeader from '../../components/PageHeader'
import { formatNumber } from '../../lib/format'

/* eslint-disable @typescript-eslint/no-explicit-any */
async function countOf(table: string, filter?: (q: any) => any): Promise<number> {
  let q: any = supabase.from(table).select('*', { count: 'exact', head: true })
  if (filter) q = filter(q)
  const { count, error } = await q
  if (error) return 0
  return count ?? 0
}

interface Counts {
  documents: number
  customers: number
  dataEntry: number
  readyReview: number
  ownerReview: number
  accountantReview: number
  duplicates: number
  financial: number
  approved: number
  imported: number
  rejected: number
}

export default function MigrationDashboard() {
  const { t } = useI18n()
  const [c, setC] = useState<Counts | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const [
          documents, customers, dataEntry, readyReview, ownerReview,
          accountantReview, duplicates, financial, approved, imported, rejected,
        ] = await Promise.all([
          countOf('migration_documents'),
          countOf('migration_customers'),
          countOf('migration_customers', (q) => q.in('status', ['draft', 'data_entry'])),
          countOf('migration_customers', (q) => q.eq('status', 'ready_for_review')),
          countOf('migration_customers', (q) => q.eq('status', 'needs_owner_review')),
          countOf('migration_customers', (q) => q.eq('status', 'needs_accountant_review')),
          countOf('migration_duplicate_candidates', (q) => q.eq('status', 'open')),
          countOf('migration_financial_checks', (q) => q.in('status', ['mismatch', 'owner_review', 'accountant_review'])),
          countOf('migration_customers', (q) => q.eq('status', 'approved_for_import')),
          countOf('migration_customers', (q) => q.eq('status', 'imported')),
          countOf('migration_customers', (q) => q.eq('status', 'rejected')),
        ])
        if (!active) return
        setC({ documents, customers, dataEntry, readyReview, ownerReview, accountantReview, duplicates, financial, approved, imported, rejected })
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [])

  if (loading) return <span className="spinner" />
  if (error) return <div className="alert alert--danger">{t('تعذّر تحميل اللوحة', 'Failed to load')}: {error}</div>
  if (!c) return null

  const total = c.customers
  const done = c.imported
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div>
      <PageHeader
        eyebrow={t('الترحيل', 'Migration')}
        title={t('لوحة الترحيل', 'Migration Dashboard')}
        subtitle={t('تحويل الدفاتر الورقية إلى بيانات رقمية', 'Convert paper ledgers into digital data')}
        actions={
          <>
            <Link to="/migration/upload" className="btn btn--primary">{t('رفع مستندات', 'Upload')}</Link>
            <Link to="/migration/entry" className="btn">{t('قائمة الإدخال', 'Data Entry')}</Link>
          </>
        }
      />

      <div className="card" style={{ marginBottom: 'var(--sp-4)' }}>
        <div className="card__body">
          <div className="between">
            <strong>{t('نسبة اكتمال الترحيل', 'Migration completion')}</strong>
            <span className="num">{pct}%</span>
          </div>
          <div className="progress mt-2"><div className="progress__bar" style={{ width: `${pct}%` }} /></div>
          <div className="faint small mt-2">{t('مستورَد', 'Imported')} {formatNumber(done)} / {formatNumber(total)}</div>
        </div>
      </div>

      <div className="grid grid--kpi">
        <Kpi label={t('المستندات', 'Documents')} value={c.documents} to="/migration/documents" />
        <Kpi label={t('سجلات الزبائن', 'Customer records')} value={c.customers} />
        <Kpi label={t('قيد الإدخال', 'In data entry')} value={c.dataEntry} to="/migration/entry" />
        <Kpi label={t('بانتظار المراجعة', 'Awaiting review')} value={c.readyReview} to="/migration/review" alert={c.readyReview > 0} />
        <Kpi label={t('مراجعة صاحب المحل', 'Owner review')} value={c.ownerReview} to="/migration/owner-review" alert={c.ownerReview > 0} />
        <Kpi label={t('مراجعة المحاسب', 'Accountant review')} value={c.accountantReview} alert={c.accountantReview > 0} />
        <Kpi label={t('اشتباه تكرار', 'Duplicate candidates')} value={c.duplicates} alert={c.duplicates > 0} />
        <Kpi label={t('اختلافات مالية', 'Financial mismatches')} value={c.financial} alert={c.financial > 0} />
        <Kpi label={t('معتمد للاستيراد', 'Approved')} value={c.approved} />
        <Kpi label={t('تم الاستيراد', 'Imported')} value={c.imported} />
        <Kpi label={t('مرفوض', 'Rejected')} value={c.rejected} />
      </div>
    </div>
  )
}

function Kpi({ label, value, to, alert }: { label: string; value: number; to?: string; alert?: boolean }) {
  const body = (
    <div className={`card kpi ${alert ? 'kpi--alert' : ''}`}>
      <div className="kpi__label">{label}</div>
      <div className="kpi__value num">{formatNumber(value)}</div>
    </div>
  )
  return to ? <Link to={to} style={{ textDecoration: 'none', color: 'inherit' }}>{body}</Link> : body
}
