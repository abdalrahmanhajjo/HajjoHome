import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../i18n/i18n'
import PageHeader from '../components/PageHeader'
import { formatUsd, formatDate } from '../lib/format'
import { displayPhone } from '../lib/phone'
import type { OverdueInstallment } from '../lib/types'

interface DebtAgingRow {
  customer_id: string
  full_name: string
  phone: string | null
  bucket_0_30: number
  bucket_31_60: number
  bucket_61_90: number
  bucket_90_plus: number
  total_overdue: number
}
interface ProfitRow {
  order_id: string
  code: string
  order_date: string
  total_usd: number
  cost_usd: number
  gross_profit_usd: number
}

type Tab = 'overdue' | 'aging' | 'profit'

export default function Reports() {
  const { profile } = useAuth()
  const { t } = useI18n()
  const canSeeProfit = profile?.role === 'owner' || profile?.role === 'accountant'
  const [tab, setTab] = useState<Tab>('overdue')

  const [overdue, setOverdue] = useState<OverdueInstallment[]>([])
  const [aging, setAging] = useState<DebtAgingRow[]>([])
  const [profit, setProfit] = useState<ProfitRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      const [o, a, p] = await Promise.all([
        supabase.from('v_overdue_installments').select('*').limit(500),
        supabase.from('v_debt_aging').select('*').order('total_overdue', { ascending: false }).limit(500),
        canSeeProfit
          ? supabase.from('v_profit_by_order').select('*').order('order_date', { ascending: false }).limit(500)
          : Promise.resolve({ data: [], error: null }),
      ])
      if (!active) return
      const err = o.error || a.error || (p as { error: { message: string } | null }).error
      if (err) setError(err.message)
      setOverdue((o.data ?? []) as OverdueInstallment[])
      setAging((a.data ?? []) as DebtAgingRow[])
      setProfit((p.data ?? []) as ProfitRow[])
      setLoading(false)
    })()
    return () => { active = false }
  }, [canSeeProfit])

  const profitTotal = profit.reduce((s, r) => s + Number(r.gross_profit_usd), 0)

  return (
    <div>
      <PageHeader
        eyebrow={t('التحليلات', 'Analytics')}
        title={t('التقارير', 'Reports')}
        subtitle={t('الديون المتأخرة وأعمارها والأرباح', 'Overdue debts, aging, and profit')}
      />

      <div className="tabs">
        <button className={`tab ${tab === 'overdue' ? 'is-active' : ''}`} onClick={() => setTab('overdue')}>{t('الأقساط المتأخرة', 'Overdue installments')}</button>
        <button className={`tab ${tab === 'aging' ? 'is-active' : ''}`} onClick={() => setTab('aging')}>{t('أعمار الديون', 'Debt aging')}</button>
        {canSeeProfit && (
          <button className={`tab ${tab === 'profit' ? 'is-active' : ''}`} onClick={() => setTab('profit')}>{t('الأرباح', 'Profit')}</button>
        )}
      </div>

      {error && <div className="alert alert--danger mt-2">{error}</div>}
      {loading ? (
        <span className="spinner" />
      ) : (
        <div className="card mt-2">
          {tab === 'overdue' && (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('الزبون', 'Customer')}</th><th>{t('الهاتف', 'Phone')}</th><th>{t('الفاتورة', 'Invoice')}</th><th>{t('القسط', 'Installment')}</th>
                    <th className="num">{t('الاستحقاق', 'Due date')}</th><th className="num">{t('المتبقّي', 'Remaining')}</th><th className="num">{t('تأخّر (يوم)', 'Days late')}</th>
                  </tr>
                </thead>
                <tbody>
                  {overdue.map((r) => (
                    <tr key={r.installment_id}>
                      <td><Link to={`/customers/${r.customer_id}`}>{r.full_name}</Link></td>
                      <td className="num">{displayPhone(r.phone)}</td>
                      <td className="num">{r.order_code}</td>
                      <td className="num">{r.number}</td>
                      <td className="num">{formatDate(r.due_date)}</td>
                      <td className="num money money--debt">{formatUsd(r.remaining_usd)}</td>
                      <td className="num">{r.days_late}</td>
                    </tr>
                  ))}
                  {overdue.length === 0 && <tr><td colSpan={7}><div className="empty">{t('لا أقساط متأخرة 🎉', 'No overdue installments 🎉')}</div></td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'aging' && (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('الزبون', 'Customer')}</th><th>{t('الهاتف', 'Phone')}</th>
                    <th className="num">0–30</th><th className="num">31–60</th>
                    <th className="num">61–90</th><th className="num">+90</th><th className="num">{t('الإجمالي', 'Total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {aging.map((r) => (
                    <tr key={r.customer_id}>
                      <td><Link to={`/customers/${r.customer_id}`}>{r.full_name}</Link></td>
                      <td className="num">{displayPhone(r.phone)}</td>
                      <td className="num">{formatUsd(r.bucket_0_30)}</td>
                      <td className="num">{formatUsd(r.bucket_31_60)}</td>
                      <td className="num">{formatUsd(r.bucket_61_90)}</td>
                      <td className="num money money--debt">{formatUsd(r.bucket_90_plus)}</td>
                      <td className="num money money--debt">{formatUsd(r.total_overdue)}</td>
                    </tr>
                  ))}
                  {aging.length === 0 && <tr><td colSpan={7}><div className="empty">{t('لا ديون متأخرة.', 'No overdue debts.')}</div></td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'profit' && canSeeProfit && (
            <div>
              <div className="card__header between">
                <span>{t('الربح الإجمالي التقريبي', 'Approximate gross profit')}</span>
                <strong className="num money money--credit">{formatUsd(profitTotal)}</strong>
              </div>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t('الفاتورة', 'Invoice')}</th><th className="num">{t('التاريخ', 'Date')}</th>
                      <th className="num">{t('الإجمالي', 'Total')}</th><th className="num">{t('الكلفة', 'Cost')}</th><th className="num">{t('الربح', 'Profit')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profit.map((r) => (
                      <tr key={r.order_id}>
                        <td className="num"><Link to={`/invoices/${r.order_id}`}>{r.code}</Link></td>
                        <td className="num">{formatDate(r.order_date)}</td>
                        <td className="num">{formatUsd(r.total_usd)}</td>
                        <td className="num">{formatUsd(r.cost_usd)}</td>
                        <td className="num money money--credit">{formatUsd(r.gross_profit_usd)}</td>
                      </tr>
                    ))}
                    {profit.length === 0 && <tr><td colSpan={5}><div className="empty">{t('لا بيانات أرباح.', 'No profit data.')}</div></td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
