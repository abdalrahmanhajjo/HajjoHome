import type { ReactNode } from 'react'

/** ترويسة صفحة على نمط StoreFlow: سطر علوي صغير + عنوان كبير + سطر فرعي + أزرار. */
export default function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <div className="eyebrow page-header__eyebrow">{eyebrow}</div>}
        <h1 className="display page-header__title">{title}</h1>
        {subtitle != null && <p className="page-header__sub">{subtitle}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </div>
  )
}
