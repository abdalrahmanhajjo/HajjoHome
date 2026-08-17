import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { useI18n } from '../../i18n/i18n'
import PageHeader from '../../components/PageHeader'
import { formatNumber } from '../../lib/format'

interface Row {
  id: string
  check_type: string
  expected: number | null
  actual: number | null
  difference: number | null
  currency: string | null
  status: string
  explanation: string | null
  migration_orders: { code: string } | { code: string }[] | null
  migration_customers: { full_name_ar: string | null; full_name_en: string | null } | { full_name_ar: string | null; full_name_en: string | null }[] | null
}

const TYPE_LABEL: Record<string, { ar: string; en: string }> = {
  paid_exceeds_total: { ar: 'المدفوع يتجاوز الإجمالي', en: 'Paid exceeds total' },
  remaining_mismatch: { ar: 'المتبقّي غير مطابق', en: 'Remaining mismatch' },
  missing_currency: { ar: 'عملة مفقودة', en: 'Missing currency' },
}
function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? v[0] ?? null : v
}

export default function FinancialChecks() {
  const { t, lang } = useI18n()
  const { profile } = useAuth()
  const canApprove = profile?.role === 'owner' || profile?.role === 'accountant'
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  async function reload() {
    setLoading(true)
    const { data, error } = await supabase
      .from('migration_financial_checks')
      .select('id, check_type, expected, actual, difference, currency, status, explanation, migration_orders(code), migration_customers(full_name_ar, full_name_en)')
      .in('status', ['mismatch', 'warning', 'owner_review', 'accountant_review'])
      .limit(300)
    if (error) setError(error.message)
    else setRows((data ?? []) as unknown as Row[])
    setLoading(false)
  }
  useEffect(() => { void reload() }, [])

  async function validate() {
    setBusy(true); setError(null); setMsg(null)
    const { data, error } = await supabase.rpc('mig_validate_financials')
    setBusy(false)
    if (error) return setError(error.message)
    setMsg(t(`اكتمل الفحص — ${data} اختلاف`, `Done — ${data} issues`))
    reload()
  }

  async function approveException(id: string) {
    if (!reason.trim()) return setError(t('التفسير مطلوب', 'Explanation required'))
    setBusy(true); setError(null)
    const { error } = await supabase.from('migration_financial_checks')
      .update({ status: 'approved_exception', explanation: reason.trim(), approved_by: profile?.id ?? null, approved_at: new Date().toISOString() })
      .eq('id', id)
    setBusy(false)
    if (error) return setError(error.message)
    setOpenId(null); setReason(''); reload()
  }

  if (loading) return <span className="spinner" />

  return (
    <div>
      <PageHeader
        eyebrow={t('الترحيل', 'Migration')}
        title={t('الاختلافات المالية', 'Financial Mismatches')}
        subtitle={t('طابِق الأرصدة قبل الاستيراد', 'Reconcile balances before importing')}
        actions={
          <button className="btn btn--primary" disabled={busy} onClick={() => void validate()}>
            {busy ? <span className="spinner" /> : t('تشغيل التحقّق', 'Run validation')}
          </button>
        }
      />
      {error && <div className="alert alert--danger">{error}</div>}
      {msg && <div className="alert alert--ok">{msg}</div>}

      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t('الزبون', 'Customer')}</th><th>{t('الفاتورة', 'Order')}</th><th>{t('النوع', 'Type')}</th>
                <th className="num">{t('متوقّع', 'Expected')}</th><th className="num">{t('فعلي', 'Actual')}</th>
                <th className="num">{t('الفرق', 'Diff')}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const c = one(r.migration_customers)
                const o = one(r.migration_orders)
                return (
                  <Fragment key={r.id}>
                    <tr>
                      <td>{c?.full_name_ar || c?.full_name_en || '—'}</td>
                      <td className="num">{o?.code ?? '—'}</td>
                      <td>
                        <span className={`badge ${r.status === 'warning' ? 'badge--warn' : 'badge--danger'}`}>
                          {(TYPE_LABEL[r.check_type]?.[lang]) ?? r.check_type}
                        </span>
                      </td>
                      <td className="num">{r.expected != null ? formatNumber(r.expected, 2) : '—'}</td>
                      <td className="num">{r.actual != null ? formatNumber(r.actual, 2) : '—'}</td>
                      <td className="num money money--debt">{r.difference != null ? formatNumber(r.difference, 2) : '—'}</td>
                      <td>
                        {canApprove && (
                          <button className="btn btn--sm" onClick={() => { setOpenId(openId === r.id ? null : r.id); setReason('') }}>
                            {t('اعتماد استثناء', 'Approve exception')}
                          </button>
                        )}
                      </td>
                    </tr>
                    {openId === r.id && (
                      <tr>
                        <td colSpan={7}>
                          <div className="review-detail row" style={{ alignItems: 'flex-end' }}>
                            <div className="field" style={{ flex: 1 }}>
                              <label>{t('تفسير الاستثناء', 'Explanation')}</label>
                              <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
                            </div>
                            <button className="btn btn--primary btn--sm" disabled={busy} onClick={() => void approveException(r.id)}>{t('تأكيد', 'Confirm')}</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {rows.length === 0 && <tr><td colSpan={7}><div className="empty">{t('لا اختلافات — اضغط «تشغيل التحقّق».', 'No issues — click "Run validation".')}</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
