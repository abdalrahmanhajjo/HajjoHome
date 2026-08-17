// نظير normalize_phone() في SQL — للبحث في الواجهة.
// القاعدة في PROJECT_BRIEF: عدّل أحدهما عدّل الآخر.
//
// تُرجع الأرقام الوطنية بعد إزالة +961 / 961 / 00961 والصفر الوطني.
// النتيجة قد تكون جزئية (بحث بمقطع من الرقم) — لا نضيف +961 هنا.
export function phoneSearchDigits(raw: string): string {
  if (!raw) return ''
  let d = raw.replace(/[^0-9]/g, '')
  if (d === '') return ''
  if (d.startsWith('00961')) {
    d = d.slice(5)
  } else if (d.startsWith('961') && d.length >= 10) {
    d = d.slice(3)
  }
  d = d.replace(/^0+/, '')
  return d
}

// الصيغة المخزّنة الكاملة (تطابق normalize_phone) — تُستعمل للمطابقة التامة إن لزم.
export function normalizePhone(raw: string): string | null {
  const d = phoneSearchDigits(raw)
  if (!d) return null
  return `+961${d}`
}

// عرض ودّي للرقم المخزّن +9613XXXXXX → 03 XXX XXX
export function displayPhone(stored: string | null | undefined): string {
  if (!stored) return '—'
  const d = stored.replace(/[^0-9]/g, '').replace(/^961/, '')
  if (!d) return stored
  const local = `0${d}`
  return local
}
