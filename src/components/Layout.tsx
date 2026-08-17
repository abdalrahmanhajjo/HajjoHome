import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useI18n, LangSwitcher, pick } from '../i18n/i18n'
import { getTheme, setTheme, type Theme } from '../lib/theme'
import { roleLabel } from '../lib/format'
import { Logo } from './Logo'
import GlobalSearch from './GlobalSearch'
import type { UserRole } from '../lib/types'

function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>(getTheme())
  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    setThemeState(next)
  }
  return (
    <button
      className="tb-pill"
      onClick={toggle}
      aria-pressed={theme === 'dark'}
      aria-label={theme === 'dark' ? pick('التبديل إلى الفاتح', 'Switch to light theme') : pick('التبديل إلى الداكن', 'Switch to dark theme')}
    >
      <span
        className="tb-pill__dot"
        aria-hidden
        style={{
          background: theme === 'dark'
            ? 'var(--c-text-muted)'
            : 'linear-gradient(90deg, var(--c-text-muted) 50%, transparent 50%)',
        }}
      />
      {theme === 'dark' ? pick('داكن', 'Dark') : pick('فاتح', 'Light')}
    </button>
  )
}

interface NavItem {
  to: string
  ar: string
  en: string
  roles?: UserRole[] // إن غابت: للجميع
  end?: boolean
  group: string // مفتاح المجموعة
}

// المجموعات على نمط StoreFlow
const GROUPS: { key: string; ar: string; en: string }[] = [
  { key: 'overview', ar: 'نظرة عامة', en: 'Overview' },
  { key: 'sales', ar: 'المبيعات والزبائن', en: 'Sales & customers' },
  { key: 'inventory', ar: 'المخزون', en: 'Inventory' },
  { key: 'admin', ar: 'الإدارة', en: 'Management' },
]

const NAV: NavItem[] = [
  { to: '/', ar: 'لوحة التحكم', en: 'Dashboard', end: true, group: 'overview' },
  { to: '/customers', ar: 'الزبائن', en: 'Customers', group: 'sales' },
  { to: '/invoices/new', ar: 'فاتورة جديدة', en: 'New Invoice', roles: ['owner', 'sales'], group: 'sales' },
  { to: '/payments/new', ar: 'تسجيل دفعة', en: 'Record Payment', roles: ['owner', 'accountant', 'sales'], group: 'sales' },
  { to: '/products', ar: 'المنتجات', en: 'Products', roles: ['owner', 'stock'], group: 'inventory' },
  { to: '/stock', ar: 'المخزون', en: 'Stock', group: 'inventory' },
  { to: '/suppliers', ar: 'الموردون', en: 'Suppliers', roles: ['owner', 'accountant', 'stock'], group: 'inventory' },
  { to: '/deliveries', ar: 'التوصيل', en: 'Deliveries', roles: ['owner', 'sales', 'stock'], group: 'inventory' },
  { to: '/reports', ar: 'التقارير', en: 'Reports', roles: ['owner', 'accountant'], group: 'admin' },
  { to: '/users', ar: 'المستخدمون', en: 'Users', roles: ['owner'], group: 'admin' },
]

export default function Layout({ children }: { children: ReactNode }) {
  const { profile, signOut, isMigStaff } = useAuth()
  const { t } = useI18n()
  const location = useLocation()
  const [open, setOpen] = useState(false)

  // إغلاق الدرج عند تغيير المسار
  useEffect(() => { setOpen(false) }, [location.pathname])

  // إقفال التمرير خلف الدرج على الجوال
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const items = useMemo(
    () => NAV.filter((n) => !n.roles || (profile != null && n.roles.includes(profile.role))),
    [profile],
  )

  const migNav: { to: string; label: string; end?: boolean }[] = [
    { to: '/migration', label: t('لوحة الترحيل', 'Dashboard'), end: true },
    { to: '/migration/upload', label: t('رفع المستندات', 'Upload') },
    { to: '/migration/documents', label: t('المستندات', 'Documents') },
    { to: '/migration/entry', label: t('إدخال البيانات', 'Data Entry') },
    { to: '/migration/review', label: t('المراجعة', 'Review') },
    { to: '/migration/owner-review', label: t('مراجعة المدير', 'Owner Review') },
    { to: '/migration/duplicates', label: t('الزبائن المكررون', 'Duplicates') },
    { to: '/migration/financial', label: t('الاختلافات المالية', 'Financial') },
    { to: '/migration/import', label: t('الاستيراد', 'Import') },
    { to: '/migration/vocabulary', label: t('القاموس', 'Vocabulary') },
    { to: '/migration/abbreviations', label: t('الاختصارات', 'Abbreviations') },
    { to: '/migration/learning', label: t('تصحيحات التعلّم', 'Learning') },
    { to: '/migration/analytics', label: t('التحليلات', 'Analytics') },
  ]

  // عنوان الشريط العلوي مشتقّ من المسار الحالي (نمط StoreFlow)
  const pageTitle = useMemo(() => {
    const exact = NAV.find((n) => n.to === location.pathname)
    const prefixed = NAV.find((n) => n.to !== '/' && location.pathname.startsWith(n.to))
    const active = exact ?? prefixed
    if (active) return t(active.ar, active.en)
    if (location.pathname.startsWith('/migration')) return t('ترحيل البيانات', 'Data Migration')
    return t('نظام إدارة المحل', 'Store Management')
  }, [location.pathname, t])

  return (
    <div className="app-shell">
      {open && <div className="sidebar-overlay" onClick={() => setOpen(false)} />}

      <aside className={`sidebar ${open ? 'is-open' : ''}`}>
        <div className="sidebar__brand">
          <Logo size={34} />
          <div className="sidebar__brand-name">
            {t('محل الحاجّو', 'Hajjo Store')}
            <small>{t('إدارة الأجهزة الكهربائية', 'Appliance management')}</small>
          </div>
        </div>

        <nav className="sidebar__nav">
          {GROUPS.map((g) => {
            const groupItems = items.filter((n) => n.group === g.key)
            if (groupItems.length === 0) return null
            return (
              <div className="nav-group" key={g.key}>
                <div className="nav-group__label">{t(g.ar, g.en)}</div>
                {groupItems.map((n) => (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    end={n.end}
                    className={({ isActive }) => `nav-link ${isActive ? 'is-active' : ''}`}
                  >
                    <span style={{ flex: 1 }}>{t(n.ar, n.en)}</span>
                  </NavLink>
                ))}
              </div>
            )
          })}

          {isMigStaff && (
            <div className="nav-group">
              <div className="nav-group__label">{t('ترحيل البيانات', 'Migration')}</div>
              {migNav.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.end}
                  className={({ isActive }) => `nav-link ${isActive ? 'is-active' : ''}`}
                >
                  <span style={{ flex: 1 }}>{n.label}</span>
                </NavLink>
              ))}
            </div>
          )}
        </nav>

        <div className="sidebar__footer">
          <div className="sidebar__user">
            <span className="sidebar__avatar">
              {(profile?.full_name ?? '')
                .split(' ')
                .map((w) => w[0])
                .join('')
                .slice(0, 2)}
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="sidebar__user-name">{profile?.full_name}</div>
              <div className="sidebar__user-role">{profile ? roleLabel(profile.role) : ''}</div>
            </div>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', minWidth: 0, flex: 1 }}>
            <button
              className={`hamburger ${open ? 'is-open' : ''}`}
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? t('إغلاق القائمة', 'Close menu') : t('فتح القائمة', 'Open menu')}
              aria-expanded={open}
            >
              <span className="hamburger__box" aria-hidden><span /><span /><span /></span>
            </button>
            <div className="topbar__title display" style={{ flex: '0 1 auto' }}>{pageTitle}</div>
            <GlobalSearch />
          </div>
          <div className="topbar__actions">
            <ThemeToggle />
            <LangSwitcher />
            <button className="btn btn--ghost btn--sm" onClick={() => void signOut()}>{t('تسجيل الخروج', 'Sign out')}</button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  )
}
