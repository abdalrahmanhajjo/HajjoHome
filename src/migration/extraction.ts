import { supabase } from '../lib/supabase'
import type { FieldStatus } from './types'

// نتيجة استخراج OCR — اقتراحات فقط (كل حقل uncertain حتى المراجعة البشرية).
export interface ExtractedField {
  fieldName: string
  rawValue: string | null
  normalizedValue: string | null
  status: FieldStatus
}
// سجل زبون واحد من الصفحة
export interface ExtractedRecord {
  fields: ExtractedField[]
}
export interface ExtractionResult {
  rawText: string
  records: ExtractedRecord[]
  provider: string
}

// يستدعي Edge Function (extract-document) — المفاتيح تبقى على الخادم.
export async function extractDocument(
  documentId: string
): Promise<{ data: ExtractionResult | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('extract-document', {
    body: { documentId },
  })
  if (error) {
    // أظهِر رسالة الخطأ الحقيقية من جسم رد الدالة بدل الرسالة العامة
    let detail = error.message
    try {
      const ctx = (error as { context?: Response }).context
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.json()
        if (body?.error) detail = body.error
      }
    } catch { /* تجاهل — نبقي الرسالة العامة */ }
    return { data: null, error: detail }
  }
  const payload = data as { error?: string } & ExtractionResult
  if (payload?.error) return { data: null, error: payload.error }
  return { data: { rawText: payload.rawText, records: payload.records ?? [], provider: payload.provider }, error: null }
}

// خريطة أسماء حقول الاستخراج → مفاتيح نموذج الإدخال
export const OCR_TO_FORM: Record<string, string> = {
  full_name_ar: 'full_name_ar',
  full_name_en: 'full_name_en',
  phone: 'phone_raw',
  phone2: 'phone2_raw',
  national_id: 'national_id',
  area: 'area',
  city: 'city',
  address: 'raw_address',
  guarantor_name: 'guarantor_name',
  guarantor_phone: 'guarantor_phone_raw',
  old_customer_ref: 'old_customer_ref',
  account_status: 'account_status',
  opening_balance: 'opening_balance',
  total_purchases: 'hist_total_purchases',
  total_paid: 'hist_total_paid',
}
