import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../i18n/i18n'
import PageHeader from '../components/PageHeader'
import { formatUsd, formatNumber, formatDate } from '../lib/format'
import type { DashboardToday } from '../lib/types'

interface AlertDef {
  key: string
  emoji: string
  label: string
  value: string
  to: string
  tone: 'warn' | 'danger' | ''
}

export default function Dashboard() {
  const { t } = useI18n()
  const { profile } = useAuth()
  const [data, setData] = useState<DashboardToday | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data, error } = await supabase.from('v_dashboard_today').select('*').single()
      if (!active) return
      if (error) setError(error.message)
      else setData(data as DashboardToday)
      setLoading(false)
    })()
    return () => { active = false }
  }, [])

  if (loading) return <span className="spinner" />
  if (error) return <div className="alert alert--danger">{t('تعذّر تحميل اللوحة', 'Failed to load dashboard')}: {error}</div>
  if (!data) return <div className="empty">{t('لا توجد بيانات.', 'No data.')}</div>

  const count = t('عدد', 'count')
  const firstName = (profile?.full_name ?? '').split(' ')[0]

  // التنبيهات القابلة للتنفيذ — تظهر فقط عند وجود ما يستحق الانتباه
  const alerts: AlertDef[] = [
    data.installments_overdue > 0 && {
      key: 'overdue', emoji: '⏰', tone: 'danger' as const,
      label: t('أقساط متأخرة', 'Overdue installments'),
      value: formatNumber(data.installments_overdue), to: '/reports',
    },
    data.installments_due_today > 0 && {
      key: 'due', emoji: '📅', tone: 'warn' as const,
      label: t('أقساط تستحق اليوم', 'Installments due today'),
      value: formatNumber(data.installments_due_today), to: '/reports',
    },
    data.cheques_due_week_usd > 0 && {
      key: 'cheques', emoji: '🧾', tone: 'warn' as const,
      label: t('شيكات تستحق هذا الأسبوع', 'Cheques due this week'),
      value: formatUsd(data.cheques_due_week_usd), to: '/reports',
    },
    data.products_low_stock > 0 && {
      key: 'stock', emoji: '📦', tone: 'warn' as const,
      label: t('منتجات وصلت حد الطلب', 'Products to reorder'),
      value: formatNumber(data.products_low_stock), to: '/stock',
    },
    data.deliveries_pending > 0 && {
      key: 'deliveries', emoji: '🚚', tone: '' as const,
      label: t('توصيلات قيد الانتظار', 'Pending deliveries'),
      value: formatNumber(data.deliveries_pending), to: '/deliveries',
    },
  ].filter(Boolean) as AlertDef[]

  return (
    <div>
      <PageHeader
        eyebrow={t('نظرة اليوم', 'Today')}
        title={firstName ? t(`أهلاً، ${firstName}`, `Welcome, ${firstName}`) : t('لوحة التحكم', 'Dashboard')}
        subtitle={formatDate(new Date().toISOString())}
        actions={
          <>
            <Link to="/invoices/new" className="btn btn--primary">{t('+ فاتورة', '+ Invoice')}</Link>
            <Link to="/payments/new" className="btn">{t('+ دفعة', '+ Payment')}</Link>
          </>
        }
      />

      {alerts.length > 0 && (
        <>
          <div className="eyebrow" style={{ marginBottom: 'var(--sp-2)' }}>{t('يحتاج انتباهك', 'Needs your attention')}</div>
          <section className="action-grid">
            {alerts.map((a) => (
              <Link key={a.key} to={a.to} className={`action-card ${a.tone ? `action-card--${a.tone}` : ''}`}>
                <span className="action-card__emoji" aria-hidden>{a.emoji}</span>
                <span className="action-card__body">
                  <span className="action-card__value num">{a.value}</span>
                  <span className="action-card__label" style={{ display: 'block' }}>{a.label}</span>
                </span>
                <span className="action-card__chev" aria-hidden>{t('‹', '›')}</span>
              </Link>
            ))}
          </section>
        </>
      )}

      <div className="eyebrow" style={{ marginBottom: 'var(--sp-2)' }}>{t('أرقام اليوم', "Today's numbers")}</div>
      <section className="grid grid--kpi">
        <Kpi label={t('مبيعات اليوم', 'Sales today')} value={formatUsd(data.sales_today_usd)} />
        <Kpi label={t('المقبوض اليوم', 'Collected today')} value={formatUsd(data.collected_today_usd)} />
        <Kpi label={t('فواتير اليوم', 'Invoices today')} value={formatNumber(data.orders_today)} hint={count} />
        <Kpi label={t('زبائن جدد اليوم', 'New customers today')} value={formatNumber(data.new_customers_today)} hint={count} />
        <Kpi label={t('أقساط مستحقة اليوم', 'Installments due today')} value={formatNumber(data.installments_due_today)} hint={count} />
        <Kpi label={t('أقساط متأخرة', 'Overdue installments')} value={formatNumber(data.installments_overdue)} hint={count} alert={data.installments_overdue > 0} />
        <Kpi label={t('منتجات وصلت حد الطلب', 'Low-stock products')} value={formatNumber(data.products_low_stock)} hint={count} alert={data.products_low_stock > 0} />
        <Kpi label={t('توصيلات قيد الانتظار', 'Pending deliveries')} value={formatNumber(data.deliveries_pending)} hint={count} />
        <Kpi label={t('شيكات تستحق هذا الأسبوع', 'Cheques due this week')} value={formatUsd(data.cheques_due_week_usd)} />
      </section>

      <div className="eyebrow" style={{ margin: 'var(--sp-5) 0 var(--sp-2)' }}>{t('إجراءات سريعة', 'Quick actions')}</div>
      <div className="row">
        <Link to="/invoices/new" className="btn">{t('+ فاتورة', '+ Invoice')}</Link>
        <Link to="/payments/new" className="btn">{t('+ دفعة', '+ Payment')}</Link>
        <Link to="/customers/new" className="btn">{t('+ زبون', '+ Customer')}</Link>
        <Link to="/products" className="btn">{t('المنتجات', 'Products')}</Link>
        <Link to="/reports" className="btn">{t('التقارير', 'Reports')}</Link>
      </div>
    </div>
  )
}

function Kpi({ label, value, hint, alert }: { label: string; value: string; hint?: string; alert?: boolean }) {
  return (
    <div className={`card kpi ${alert ? 'kpi--alert' : ''}`}>
      <div className="kpi__label">{label}</div>
      <div className="kpi__value num">{value}</div>
      {hint && <div className="kpi__hint">{hint}</div>}
    </div>
  )
}
