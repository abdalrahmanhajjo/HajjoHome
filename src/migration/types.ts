// أنواع وحدة ترحيل البيانات القديمة — تعكس جداول db/migration.sql المستخدمة في الواجهة.

export type MigStatus =
  | 'draft' | 'ocr_completed' | 'data_entry' | 'ready_for_review' | 'needs_correction'
  | 'needs_owner_review' | 'needs_accountant_review' | 'duplicate_review' | 'financial_review'
  | 'approved_for_import' | 'imported' | 'rejected' | 'archived'

export type MigDocCategory =
  | 'customer_notebook' | 'sales_invoice' | 'payment_receipt' | 'installment_agreement'
  | 'warranty_document' | 'identity_document' | 'guarantor_document' | 'supplier_invoice'
  | 'delivery_note' | 'other'

export type FieldStatus = 'clear' | 'uncertain' | 'unreadable' | 'missing'

export interface MigDocument {
  id: string
  source_reference: string
  original_filename: string | null
  storage_path: string | null
  file_type: string | null
  category: MigDocCategory
  status: string
  ocr_status: string
  notebook_no: string | null
  page_no: string | null
  doc_year: number | null
  notes: string | null
  archived_at: string | null
  created_at: string
}

export interface MigCustomer {
  id: string
  code: string
  document_id: string | null
  source_reference: string | null
  notebook_no: string | null
  page_no: string | null
  old_customer_ref: string | null
  full_name_ar: string | null
  full_name_en: string | null
  phone_raw: string | null
  phone: string | null
  phone2_raw: string | null
  national_id: string | null
  area: string | null
  city: string | null
  raw_address: string | null
  guarantor_name: string | null
  guarantor_phone_raw: string | null
  opening_balance: number | null
  hist_total_purchases: number | null
  hist_total_paid: number | null
  currency: string | null
  account_status: string | null
  status: MigStatus
  duplicate_status: string | null
  notes: string | null
  verification: Record<string, FieldStatus> | null
  created_at: string
}

// حالة التحقّق لكل حقل — تُحفظ في العمود verification (jsonb)
export type Verification = Record<string, FieldStatus>

export const DOC_CATEGORY_LABELS: Record<MigDocCategory, { ar: string; en: string }> = {
  customer_notebook: { ar: 'دفتر زبائن', en: 'Customer notebook' },
  sales_invoice: { ar: 'فاتورة بيع', en: 'Sales invoice' },
  payment_receipt: { ar: 'إيصال دفع', en: 'Payment receipt' },
  installment_agreement: { ar: 'عقد تقسيط', en: 'Installment agreement' },
  warranty_document: { ar: 'وثيقة ضمان', en: 'Warranty' },
  identity_document: { ar: 'وثيقة هوية', en: 'Identity' },
  guarantor_document: { ar: 'وثيقة كفيل', en: 'Guarantor' },
  supplier_invoice: { ar: 'فاتورة مورد', en: 'Supplier invoice' },
  delivery_note: { ar: 'سند تسليم', en: 'Delivery note' },
  other: { ar: 'أخرى', en: 'Other' },
}

export const MIG_STATUS_LABELS: Record<MigStatus, { ar: string; en: string; badge: string }> = {
  draft: { ar: 'مسودة', en: 'Draft', badge: 'badge--muted' },
  ocr_completed: { ar: 'اكتمل الاستخراج', en: 'OCR completed', badge: 'badge--info' },
  data_entry: { ar: 'قيد الإدخال', en: 'Data entry', badge: 'badge--info' },
  ready_for_review: { ar: 'جاهز للمراجعة', en: 'Ready for review', badge: 'badge--warn' },
  needs_correction: { ar: 'بحاجة إلى تصحيح', en: 'Needs correction', badge: 'badge--danger' },
  needs_owner_review: { ar: 'مراجعة صاحب المحل', en: 'Owner review', badge: 'badge--warn' },
  needs_accountant_review: { ar: 'مراجعة المحاسب', en: 'Accountant review', badge: 'badge--warn' },
  duplicate_review: { ar: 'مراجعة تكرار', en: 'Duplicate review', badge: 'badge--warn' },
  financial_review: { ar: 'مراجعة مالية', en: 'Financial review', badge: 'badge--warn' },
  approved_for_import: { ar: 'معتمد للاستيراد', en: 'Approved', badge: 'badge--ok' },
  imported: { ar: 'تم الاستيراد', en: 'Imported', badge: 'badge--ok' },
  rejected: { ar: 'مرفوض', en: 'Rejected', badge: 'badge--danger' },
  archived: { ar: 'مؤرشف', en: 'Archived', badge: 'badge--muted' },
}

export const FIELD_STATUS_META: Record<FieldStatus, { ar: string; en: string; cls: string }> = {
  clear: { ar: 'واضح', en: 'Clear', cls: 'fs-clear' },
  uncertain: { ar: 'غير مؤكد', en: 'Uncertain', cls: 'fs-uncertain' },
  unreadable: { ar: 'غير مقروء', en: 'Unreadable', cls: 'fs-unreadable' },
  missing: { ar: 'غير موجود', en: 'Missing', cls: 'fs-missing' },
}
