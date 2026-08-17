// تطبيع للأرقام والأسماء العربية — للاستخراج والبحث. يحفظ القيمة الأصلية دائمًا.

const AR_INDIC = '٠١٢٣٤٥٦٧٨٩'
const FA_INDIC = '۰۱۲۳۴۵۶۷۸۹'

// أرقام عربية-هندية → غربية (٠٣ → 03، ١٥٠٠ → 1500)
export function arabicToWestern(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (d) => {
    const a = AR_INDIC.indexOf(d)
    if (a >= 0) return String(a)
    const f = FA_INDIC.indexOf(d)
    return f >= 0 ? String(f) : d
  })
}

// تطبيع اسم عربي (نظير mig_name_norm في SQL) — للبحث/كشف التكرار فقط، لا يستبدل الأصل.
export function normalizeArabicName(input: string): string {
  return input
    .replace(/[ً-ْـ]/g, '') // إزالة التشكيل والتطويل
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim()
}
