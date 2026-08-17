// تنسيق موحّد. الأرقام دائمًا لاتينية (en-US) وبخانتين للمال.
// التسميات ثنائية اللغة عبر pick() (تقرأ اللغة الحالية من i18n).
import { pick } from '../i18n/i18n'

export function formatUsd(value: number | null | undefined): string {
  const n = Number(value ?? 0)
  const s = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `$${s}`
}

export function formatNumber(value: number | null | undefined, digits = 0): string {
  const n = Number(value ?? 0)
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

// DD/MM/YYYY بأرقام لاتينية
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB')
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.toLocaleDateString('en-GB')} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}

/** التاريخ مع الوقت حتى الثواني (ساعة:دقيقة:ثانية). */
export function formatDateTimeSeconds(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.toLocaleDateString('en-GB')} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
}

/** الوقت المنقضي منذ تاريخ، بالدقائق والثواني للأحداث الحديثة. */
export function timeAgo(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const secs = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000))
  if (secs < 60) return pick(`منذ ${secs} ثانية`, `${secs}s ago`)
  const mins = Math.floor(secs / 60)
  if (mins < 60) return pick(`منذ ${mins} د ${secs % 60} ث`, `${mins}m ${secs % 60}s ago`)
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return pick(`منذ ${hrs} س ${mins % 60} د`, `${hrs}h ${mins % 60}m ago`)
  const days = Math.floor(hrs / 24)
  return pick(`منذ ${days} يوم`, `${days}d ago`)
}

// موجب = دين على الزبون (أحمر)، سالب = رصيد دائن (أخضر)
export function balanceClass(balanceUsd: number): string {
  if (balanceUsd > 0.005) return 'money money--debt'
  if (balanceUsd < -0.005) return 'money money--credit'
  return 'money'
}

const INSTALLMENT_LABELS: Record<string, { ar: string; en: string }> = {
  pending: { ar: 'غير مستحق', en: 'Not due' },
  partial: { ar: 'مدفوع جزئيًا', en: 'Partial' },
  paid: { ar: 'مدفوع', en: 'Paid' },
  overdue: { ar: 'متأخر', en: 'Overdue' },
  cancelled: { ar: 'ملغى', en: 'Cancelled' },
}
export function installmentLabel(status: string): string {
  const m = INSTALLMENT_LABELS[status]
  return m ? pick(m.ar, m.en) : status
}

const ORDER_LABELS: Record<string, { ar: string; en: string }> = {
  draft: { ar: 'مسودة', en: 'Draft' },
  confirmed: { ar: 'مؤكد', en: 'Confirmed' },
  reserved: { ar: 'محجوز', en: 'Reserved' },
  ready: { ar: 'جاهز للتسليم', en: 'Ready' },
  delivered: { ar: 'تم التسليم', en: 'Delivered' },
  completed: { ar: 'مكتمل', en: 'Completed' },
  cancelled: { ar: 'ملغى', en: 'Cancelled' },
  returned: { ar: 'مرتجع', en: 'Returned' },
}
export function orderLabel(status: string): string {
  const m = ORDER_LABELS[status]
  return m ? pick(m.ar, m.en) : status
}

const ROLE_LABELS: Record<string, { ar: string; en: string }> = {
  owner: { ar: 'المدير', en: 'Owner' },
  sales: { ar: 'مبيعات', en: 'Sales' },
  accountant: { ar: 'محاسب', en: 'Accountant' },
  stock: { ar: 'مخزون', en: 'Stock' },
}
export function roleLabel(role: string): string {
  const m = ROLE_LABELS[role]
  return m ? pick(m.ar, m.en) : role
}

const METHOD_LABELS: Record<string, { ar: string; en: string }> = {
  cash: { ar: 'نقدًا', en: 'Cash' },
  transfer: { ar: 'حوالة', en: 'Transfer' },
  card: { ar: 'بطاقة', en: 'Card' },
  cheque: { ar: 'شيك', en: 'Cheque' },
  other: { ar: 'أخرى', en: 'Other' },
}
export function methodLabel(method: string): string {
  const m = METHOD_LABELS[method]
  return m ? pick(m.ar, m.en) : method
}
