import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { useI18n } from '../../i18n/i18n'
import PageHeader from '../../components/PageHeader'
import { displayPhone } from '../../lib/phone'
import type { MigCustomer, MigStatus } from '../../migration/types'

export default function OwnerReview() {
  const { t } = useI18n()
  const { profile, hasRole } = useAuth()
  const [rows, setRows] = useState<MigCustomer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    setLoading(true)
    const { data, error } = await supabase
      .from('migration_customers')
      .select('*')
      .eq('status', 'needs_owner_review')
      .order('created_at')
      .limit(200)
    if (error) setError(error.message)
    else setRows((data ?? []) as MigCustomer[])
    setLoading(false)
  }
  useEffect(() => { void reload() }, [])

  async function decide(id: string, status: MigStatus) {
    const patch: Record<string, unknown> = { status, reviewed_by: profile?.id ?? null, reviewed_at: new Date().toISOString() }
    if (status === 'approved_for_import') { patch.approved_by = profile?.id ?? null; patch.approved_at = new Date().toISOString() }
    const { error } = await supabase.from('migration_customers').update(patch).eq('id', id)
    if (error) setError(error.message)
    else reload()
  }

  if (!hasRole('owner')) return <div className="alert alert--warn">{t('هذه الصفحة لصاحب المحل فقط.', 'Owner only.')}</div>
  if (loading) return <span className="spinner" />

  return (
    <div>
      <PageHeader eyebrow={t('الترحيل', 'Migration')} title={t('مراجعة صاحب المحل', 'Owner Review')} subtitle={t('اعتماد نهائي قبل الاستيراد إلى النظام الحيّ', 'Final approval before importing to the live system')} />
      {error && <div className="alert alert--danger">{error}</div>}
      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>{t('الرقم', 'Code')}</th><th>{t('الاسم', 'Name')}</th><th>{t('الهاتف', 'Phone')}</th><th>{t('المرجع', 'Reference')}</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="num">{r.code}</td>
                  <td>{r.full_name_ar || r.full_name_en || '—'}</td>
                  <td className="num">{displayPhone(r.phone)}</td>
                  <td className="num">{r.source_reference ?? '—'}</td>
                  <td>
                    <div className="row">
                      <button className="btn btn--primary btn--sm" onClick={() => void decide(r.id, 'approved_for_import')}>{t('اعتماد', 'Approve')}</button>
                      <button className="btn btn--sm" onClick={() => void decide(r.id, 'needs_correction')}>{t('إعادة للتصحيح', 'Send back')}</button>
                      <button className="btn btn--danger btn--sm" onClick={() => void decide(r.id, 'rejected')}>{t('رفض', 'Reject')}</button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5}><div className="empty">{t('لا حالات بانتظار صاحب المحل.', 'Nothing awaiting owner.')}</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
