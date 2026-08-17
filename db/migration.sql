-- =====================================================================
-- وحدة ترحيل البيانات القديمة (Legacy Data Migration) — المرحلة 1
-- طبقة تخزين مرحلي (staging) إضافية بالكامل — لا تلمس الجداول الحيّة.
-- تُطبَّق بعد db/schema.sql:  SQL Editor → الصق → Run.
--
-- المبادئ (من المواصفات):
--   * لا يُوثَق ناتج OCR/الذكاء تلقائيًا — كل حقل حسّاس يتطلّب تحقّقًا بشريًا.
--   * تُحفَظ الصورة الأصلية والنص الخام دائمًا.
--   * لا دمج زبائن تلقائي، لا اعتماد مالي تلقائي.
--   * كل سجل مستورَد يبقى مرتبطًا بمستنده الأصلي (migration_source_links).
--   * الوحدة تعمل يدويًا بالكامل بدون OCR.
--
-- الأدوار: نُضيف migration_role على profiles (operator/reviewer) بدل تعديل
--          user_role — أكثر أمانًا ولا يكسر RLS القائم. المدير والمحاسب
--          يحتفظان بصلاحياتهما عبر auth_role().
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. أدوار الترحيل ودوال مساعدة
-- ---------------------------------------------------------------------
alter table profiles
  add column if not exists migration_role text
  check (migration_role in ('operator','reviewer'));

create or replace function mig_role()
returns text language sql stable security definer set search_path = public
as $$ select migration_role from profiles where id = auth.uid() and is_active $$;

-- من يملك الوصول لوحدة الترحيل: المدير، المحاسب، ومشغّلو/مراجعو الترحيل
create or replace function is_mig_staff()
returns boolean language sql stable
as $$ select is_owner() or auth_role() = 'accountant' or mig_role() in ('operator','reviewer') $$;

-- تطبيع اسم عربي للبحث وكشف التكرار فقط — لا يستبدل الاسم الأصلي أبدًا.
-- يزيل التشكيل والتطويل، ويوحّد الألف/الياء/التاء المربوطة، ويضغط الفراغات.
create or replace function mig_name_norm(raw text)
returns text language sql immutable
as $$
  select nullif(btrim(regexp_replace(
    translate(coalesce(raw, ''), 'أإآىة' || 'ًٌٍَُِّْـ', 'ااايه'),
    '\s+', ' ', 'g')), '')
$$;

-- ---------------------------------------------------------------------
-- 1. الأنواع (Enums) الخاصة بالترحيل
-- ---------------------------------------------------------------------
create type mig_status as enum (
  'draft','ocr_completed','data_entry','ready_for_review','needs_correction',
  'needs_owner_review','needs_accountant_review','duplicate_review','financial_review',
  'approved_for_import','imported','rejected','archived');

create type mig_field_status   as enum ('clear','uncertain','unreadable','missing');
create type mig_date_precision as enum ('exact','month_year','year_only','unknown');
create type mig_doc_category   as enum (
  'customer_notebook','sales_invoice','payment_receipt','installment_agreement',
  'warranty_document','identity_document','guarantor_document','supplier_invoice',
  'delivery_note','other');
create type mig_doc_status  as enum ('uploaded','preprocessing','processed','ocr_pending','ocr_done','ocr_failed','entered','error');
create type mig_dup_status  as enum ('open','merged','kept_separate','linked','ignored','sent_to_owner');
create type mig_fin_status  as enum ('valid','warning','mismatch','owner_review','accountant_review','approved_exception');
create type mig_batch_status as enum ('draft','previewed','importing','completed','failed','rolled_back');

-- ---------------------------------------------------------------------
-- 2. ملفات الكتّاب (Writer profiles)
-- ---------------------------------------------------------------------
create table migration_writer_profiles (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  active_years text,
  notebooks   text,
  notes       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. المستندات والصفحات والاستخراج
-- ---------------------------------------------------------------------
create sequence mig_document_seq;
create table migration_documents (
  id               uuid primary key default gen_random_uuid(),
  seq              bigint not null default nextval('mig_document_seq'),
  source_reference text not null,                 -- مرجع فريد يحدّده المستخدم: BOOK-001-PAGE-001
  original_filename text,
  storage_path     text,                          -- مسار في bucket خاص
  file_type        text,
  file_size        bigint,
  page_count       int not null default 1 check (page_count >= 1),
  doc_year         int,
  notebook_no      text,
  page_no          text,
  category         mig_doc_category not null default 'other',
  status           mig_doc_status not null default 'uploaded',
  ocr_status       text not null default 'none',  -- none/pending/done/failed
  writer_profile_id uuid references migration_writer_profiles(id) on delete set null,
  image_quality    text,
  notes            text,
  uploaded_by      uuid references profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index mig_documents_srcref_uq on migration_documents(lower(btrim(source_reference)));
create index mig_documents_status_idx on migration_documents(status);
create index mig_documents_notebook_idx on migration_documents(notebook_no, page_no);
create trigger trg_mig_documents_updated before update on migration_documents
  for each row execute function set_updated_at();

create table migration_document_pages (
  id             uuid primary key default gen_random_uuid(),
  document_id    uuid not null references migration_documents(id) on delete cascade,
  page_number    int not null check (page_number >= 1),
  original_path  text,
  processed_path text,
  processing_settings jsonb,
  processing_version text,
  ocr_status     text not null default 'none',
  created_at     timestamptz not null default now(),
  unique (document_id, page_number)
);

-- عملية استخراج واحدة (OCR أو يدوي) — النص الخام يُحفَظ للأبد للتدقيق
create table migration_extraction_runs (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references migration_documents(id) on delete cascade,
  page_id       uuid references migration_document_pages(id) on delete cascade,
  provider      text not null default 'manual',   -- manual/google/aws/azure/openai/anthropic/tesseract/custom
  model_version text,
  raw_text      text,
  detected_language text,
  confidence    numeric(5,2),
  warnings      jsonb,
  status        text not null default 'completed',
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now()
);
create index mig_extract_doc_idx on migration_extraction_runs(document_id);

create table migration_extracted_fields (
  id                uuid primary key default gen_random_uuid(),
  extraction_run_id uuid not null references migration_extraction_runs(id) on delete cascade,
  field_name        text not null,
  raw_value         text,
  normalized_value  text,
  confidence        numeric(5,2),
  status            mig_field_status not null default 'missing',
  bounding_box      jsonb,
  created_at        timestamptz not null default now()
);
create index mig_fields_run_idx on migration_extracted_fields(extraction_run_id);

-- ---------------------------------------------------------------------
-- 4. القاموس والاختصارات (قابلة للتعلّم — يدويًا، باعتماد بشري)
-- ---------------------------------------------------------------------
create table migration_vocabulary (
  id          uuid primary key default gen_random_uuid(),
  category    text not null,        -- name/family/city/area/brand/model/phrase/...
  term        text not null,
  normalized  text,
  weight      int not null default 1,
  writer_profile_id uuid references migration_writer_profiles(id) on delete set null,
  is_active   boolean not null default true,
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now()
);
create index mig_vocab_cat_idx  on migration_vocabulary(category);
create index mig_vocab_trgm_idx on migration_vocabulary using gin (normalized gin_trgm_ops);

create table migration_abbreviations (
  id            uuid primary key default gen_random_uuid(),
  abbreviation  text not null,
  meaning       text not null,
  context       text,
  writer_profile_id uuid references migration_writer_profiles(id) on delete set null,
  confidence    numeric(5,2),
  example_document_id uuid references migration_documents(id) on delete set null,
  approved_by   uuid references profiles(id),
  is_active     boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5. زبائن الترحيل (staging) — عنوان وكفيل مدمجان كما في الجدول الحيّ
-- ---------------------------------------------------------------------
create sequence mig_customer_seq;
create table migration_customers (
  id            uuid primary key default gen_random_uuid(),
  seq           bigint not null default nextval('mig_customer_seq'),
  code          text generated always as ('MC-' || lpad(seq::text, 6, '0')) stored,

  document_id   uuid references migration_documents(id) on delete set null,
  source_reference text,
  notebook_no   text,
  page_no       text,

  old_customer_ref text,
  full_name_ar  text,
  full_name_en  text,
  name_search   text generated always as (mig_name_norm(full_name_ar)) stored,
  first_name    text,
  father_name   text,
  family_name   text,

  phone_raw     text,
  phone         text generated always as (normalize_phone(phone_raw)) stored,
  phone2_raw    text,
  phone2        text generated always as (normalize_phone(phone2_raw)) stored,
  national_id   text,
  occupation    text,

  -- العنوان (مدمج)
  governorate   text, city text, area text, street text, building text, landmark text,
  raw_address   text,

  -- الكفيل (مدمج)
  guarantor_name text, guarantor_phone_raw text,
  guarantor_phone text generated always as (normalize_phone(guarantor_phone_raw)) stored,
  guarantor_national_id text, guarantor_relationship text, guarantor_notes text,

  -- حساب قديم
  first_purchase_date date, last_purchase_date date,
  account_status text,
  hist_total_purchases numeric(14,2),
  hist_total_paid      numeric(14,2),
  opening_balance      numeric(14,2),
  currency      text default 'USD',
  account_notes text,

  status        mig_status not null default 'draft',
  data_quality_score int,
  duplicate_status text,
  verification  jsonb,                 -- حالة/ثقة كل حقل
  notes         text,

  imported_customer_id uuid references customers(id) on delete set null,
  import_batch_id uuid,                -- FK يُضاف بعد جدول الدفعات
  entered_by    uuid references profiles(id), entered_at  timestamptz default now(),
  reviewed_by   uuid references profiles(id), reviewed_at timestamptz,
  approved_by   uuid references profiles(id), approved_at timestamptz,
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index mig_cust_status_idx on migration_customers(status);
create index mig_cust_phone_idx  on migration_customers(phone);
create index mig_cust_nid_idx    on migration_customers(national_id);
create index mig_cust_name_trgm  on migration_customers using gin (name_search gin_trgm_ops);
create index mig_cust_srcref_idx on migration_customers(source_reference);
create trigger trg_mig_cust_updated before update on migration_customers
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 6. الطلبات/الدفعات/الأقساط/الأرصدة الافتتاحية (staging)
-- ---------------------------------------------------------------------
create sequence mig_order_seq;
create table migration_orders (
  id            uuid primary key default gen_random_uuid(),
  seq           bigint not null default nextval('mig_order_seq'),
  code          text generated always as ('MO-' || lpad(seq::text, 6, '0')) stored,
  migration_customer_id uuid references migration_customers(id) on delete cascade,
  document_id   uuid references migration_documents(id) on delete set null,
  source_reference text,
  order_date    date,
  date_precision mig_date_precision not null default 'unknown',
  product_description text, category text, brand text, model text, serial_number text,
  quantity      numeric(12,3), unit_price numeric(14,2), discount numeric(14,2), delivery_fee numeric(14,2),
  total_amount  numeric(14,2), paid_amount numeric(14,2), remaining_amount numeric(14,2),
  currency      text default 'USD',
  payment_type  text, order_status text, delivery_status text, warranty_status text,
  notes         text,
  status        mig_status not null default 'draft',
  verification  jsonb,
  imported_order_id uuid references orders(id) on delete set null,
  import_batch_id uuid,
  entered_by uuid references profiles(id), reviewed_by uuid references profiles(id), approved_by uuid references profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index mig_orders_cust_idx on migration_orders(migration_customer_id);
create trigger trg_mig_orders_updated before update on migration_orders
  for each row execute function set_updated_at();

create table migration_payments (
  id            uuid primary key default gen_random_uuid(),
  migration_customer_id uuid references migration_customers(id) on delete cascade,
  migration_order_id    uuid references migration_orders(id) on delete set null,
  document_id   uuid references migration_documents(id) on delete set null,
  source_reference text,
  payment_date  date, date_precision mig_date_precision not null default 'unknown',
  amount        numeric(14,2), currency text default 'USD',
  payment_method text,                 -- cash/transfer/card/check/installment/other/unknown
  receipt_number text, notes text,
  status        mig_status not null default 'draft',
  verification  jsonb,
  imported_payment_id uuid references payments(id) on delete set null,
  import_batch_id uuid,
  entered_by uuid references profiles(id), reviewed_by uuid references profiles(id),
  created_at    timestamptz not null default now()
);
create index mig_pay_cust_idx on migration_payments(migration_customer_id);

create table migration_installments (
  id            uuid primary key default gen_random_uuid(),
  migration_customer_id uuid references migration_customers(id) on delete cascade,
  migration_order_id    uuid references migration_orders(id) on delete cascade,
  number        int, due_date date, due_date_precision mig_date_precision not null default 'unknown',
  amount        numeric(14,2), paid_amount numeric(14,2), remaining_amount numeric(14,2),
  currency      text default 'USD',
  status        text,                  -- not_due/due/paid/partial/late/cancelled/postponed/unknown
  payment_date  date, notes text, source_reference text,
  verification  jsonb,
  import_batch_id uuid,
  created_at    timestamptz not null default now()
);
create index mig_inst_order_idx on migration_installments(migration_order_id);

create table migration_opening_balances (
  id            uuid primary key default gen_random_uuid(),
  migration_customer_id uuid references migration_customers(id) on delete cascade,
  opening_date  date, debit_amount numeric(14,2), credit_amount numeric(14,2),
  net_balance   numeric(14,2), currency text default 'USD',
  source_reference text, reason text, notes text,
  verified_by uuid references profiles(id), approved_by uuid references profiles(id),
  import_batch_id uuid,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 7. كشف التكرار والتحقّق المالي
-- ---------------------------------------------------------------------
create table migration_duplicate_candidates (
  id            uuid primary key default gen_random_uuid(),
  customer_a    uuid not null references migration_customers(id) on delete cascade,
  customer_b    uuid references migration_customers(id) on delete cascade,
  live_customer_id uuid references customers(id) on delete cascade,   -- تطابق مع زبون حيّ
  score         int check (score between 0 and 100),
  band          text,               -- low/possible/likely/very_likely
  indicators    jsonb,
  status        mig_dup_status not null default 'open',
  resolved_by   uuid references profiles(id), resolved_at timestamptz,
  resolution    jsonb, notes text,
  created_at    timestamptz not null default now(),
  check (customer_b is not null or live_customer_id is not null)
);
create index mig_dup_status_idx on migration_duplicate_candidates(status);

create table migration_financial_checks (
  id            uuid primary key default gen_random_uuid(),
  migration_customer_id uuid references migration_customers(id) on delete cascade,
  migration_order_id    uuid references migration_orders(id) on delete cascade,
  check_type    text not null,
  expected      numeric(14,2), actual numeric(14,2), difference numeric(14,2),
  currency      text,
  status        mig_fin_status not null default 'warning',
  explanation   text,
  approved_by   uuid references profiles(id), approved_at timestamptz,
  created_at    timestamptz not null default now()
);
create index mig_fin_status_idx on migration_financial_checks(status);

-- ---------------------------------------------------------------------
-- 8. ذاكرة التصحيح والتعلّم (يدوي، باعتماد صريح)
-- ---------------------------------------------------------------------
create table migration_recognition_corrections (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid references migration_documents(id) on delete set null,
  page_id       uuid references migration_document_pages(id) on delete set null,
  field_type    text not null,
  bounding_box  jsonb,
  crop_path     text,
  writer_profile_id uuid references migration_writer_profiles(id) on delete set null,
  detected_text text, corrected_text text, normalized_text text,
  detected_confidence numeric(5,2),
  reviewed_by   uuid references profiles(id), reviewed_at timestamptz default now(),
  correction_status text not null default 'verified',   -- verified/rejected/uncertain
  approved_for_learning boolean not null default false,
  model_provider text, model_version text,
  created_at    timestamptz not null default now()
);
create index mig_corr_field_idx on migration_recognition_corrections(field_type);

create table migration_learning_examples (
  id            uuid primary key default gen_random_uuid(),
  correction_id uuid references migration_recognition_corrections(id) on delete cascade,
  image_path    text, text text, field_type text,
  writer_profile_id uuid references migration_writer_profiles(id) on delete set null,
  language      text default 'ar',
  verified      boolean not null default false,
  approved_by   uuid references profiles(id),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 9. دفعات الاستيراد والربط بالمصدر والتدقيق
-- ---------------------------------------------------------------------
create sequence mig_batch_seq;
create table migration_import_batches (
  id            uuid primary key default gen_random_uuid(),
  seq           bigint not null default nextval('mig_batch_seq'),
  code          text generated always as ('MIG-' || lpad(seq::text, 5, '0')) stored,
  name          text,
  created_by    uuid references profiles(id),
  customers_count int not null default 0, orders_count int not null default 0,
  payments_count int not null default 0, installments_count int not null default 0,
  opening_balances_count int not null default 0,
  accepted_count int not null default 0, rejected_count int not null default 0, skipped_count int not null default 0,
  status        mig_batch_status not null default 'draft',
  started_at    timestamptz, ended_at timestamptz,
  error_report  jsonb,
  rolled_back_at timestamptz, rollback_reason text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_mig_batch_updated before update on migration_import_batches
  for each row execute function set_updated_at();

-- ربط import_batch_id في جداول الـ staging (أُجّل حتى إنشاء الدفعات)
alter table migration_customers        add constraint mig_cust_batch_fk foreign key (import_batch_id) references migration_import_batches(id) on delete set null;
alter table migration_orders           add constraint mig_ord_batch_fk  foreign key (import_batch_id) references migration_import_batches(id) on delete set null;
alter table migration_payments         add constraint mig_pay_batch_fk  foreign key (import_batch_id) references migration_import_batches(id) on delete set null;
alter table migration_installments     add constraint mig_inst_batch_fk foreign key (import_batch_id) references migration_import_batches(id) on delete set null;
alter table migration_opening_balances add constraint mig_ob_batch_fk   foreign key (import_batch_id) references migration_import_batches(id) on delete set null;

create table migration_import_batch_items (
  id          uuid primary key default gen_random_uuid(),
  batch_id    uuid not null references migration_import_batches(id) on delete cascade,
  entity_type text not null,           -- customer/order/payment/installment/opening_balance
  staging_id  uuid not null,
  action      text not null,           -- create/update/skip
  result      text,                    -- ok/error/skipped
  imported_id uuid,
  error       text,
  created_at  timestamptz not null default now()
);
create index mig_batch_items_idx on migration_import_batch_items(batch_id);

create table migration_import_errors (
  id          uuid primary key default gen_random_uuid(),
  batch_id    uuid references migration_import_batches(id) on delete cascade,
  entity_type text, staging_id uuid, message text, details jsonb,
  created_at  timestamptz not null default now()
);

-- الربط الدائم بين السجل الحيّ ومستنده الأصلي
create table migration_source_links (
  id            uuid primary key default gen_random_uuid(),
  live_entity_type text not null,      -- customer/order/payment/installment
  live_entity_id   uuid not null,
  document_id   uuid references migration_documents(id) on delete set null,
  source_reference text,
  staging_entity_type text, staging_id uuid,
  batch_id      uuid references migration_import_batches(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index mig_srclink_live_idx on migration_source_links(live_entity_type, live_entity_id);

-- سجل تدقيق خاص بالترحيل (أحداث غنية: رفع، OCR، مراجعة، استيراد، تراجع)
create table migration_audit_logs (
  id          bigint generated always as identity primary key,
  user_id     uuid, action text not null, entity_type text, entity_id uuid,
  old_value   jsonb, new_value jsonb, reason text, source_reference text,
  model_provider text, model_version text, ip_address text,
  created_at  timestamptz not null default now()
);
create index mig_audit_entity_idx on migration_audit_logs(entity_type, entity_id, created_at desc);

-- تسجيل تغييرات جداول الـ staging في audit_log الحالي (إعادة استخدام البنية)
create trigger trg_audit_mig_customers after insert or update or delete on migration_customers
  for each row execute function audit_trigger();
create trigger trg_audit_mig_orders    after insert or update or delete on migration_orders
  for each row execute function audit_trigger();
create trigger trg_audit_mig_payments  after insert or update or delete on migration_payments
  for each row execute function audit_trigger();
create trigger trg_audit_mig_batches   after insert or update or delete on migration_import_batches
  for each row execute function audit_trigger();


-- =====================================================================
-- 10. RLS والصلاحيات
-- =====================================================================
alter table migration_writer_profiles         enable row level security;
alter table migration_documents               enable row level security;
alter table migration_document_pages          enable row level security;
alter table migration_extraction_runs         enable row level security;
alter table migration_extracted_fields        enable row level security;
alter table migration_vocabulary              enable row level security;
alter table migration_abbreviations           enable row level security;
alter table migration_customers               enable row level security;
alter table migration_orders                  enable row level security;
alter table migration_payments                enable row level security;
alter table migration_installments            enable row level security;
alter table migration_opening_balances        enable row level security;
alter table migration_duplicate_candidates    enable row level security;
alter table migration_financial_checks        enable row level security;
alter table migration_recognition_corrections enable row level security;
alter table migration_learning_examples       enable row level security;
alter table migration_import_batches          enable row level security;
alter table migration_import_batch_items      enable row level security;
alter table migration_import_errors           enable row level security;
alter table migration_source_links            enable row level security;
alter table migration_audit_logs              enable row level security;

-- إعادة تطبيق المنح على الجداول الجديدة + منع الحذف (النظام يعمل بالإلغاء/الأرشفة)
grant select, insert, update on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke delete on all tables in schema public from authenticated;

-- سياسة عامة: طاقم الترحيل يقرأ/يكتب. (الاعتمادات المالية والاستيراد مقيّدة أدناه)
do $$
declare t text;
begin
  foreach t in array array[
    'migration_writer_profiles','migration_documents','migration_document_pages',
    'migration_extraction_runs','migration_extracted_fields','migration_vocabulary',
    'migration_abbreviations','migration_customers','migration_orders','migration_payments',
    'migration_installments','migration_opening_balances','migration_duplicate_candidates',
    'migration_recognition_corrections','migration_learning_examples',
    'migration_import_batch_items','migration_import_errors','migration_source_links'
  ]
  loop
    execute format('create policy %I on %I for select to authenticated using (is_mig_staff())', t||'_sel', t);
    execute format('create policy %I on %I for insert to authenticated with check (is_mig_staff())', t||'_ins', t);
    execute format('create policy %I on %I for update to authenticated using (is_mig_staff()) with check (is_mig_staff())', t||'_upd', t);
  end loop;
end $$;

-- التحقّق المالي: القراءة لطاقم الترحيل، والاعتماد للمدير/المحاسب فقط
create policy mig_fin_sel on migration_financial_checks for select to authenticated using (is_mig_staff());
create policy mig_fin_ins on migration_financial_checks for insert to authenticated with check (is_mig_staff());
create policy mig_fin_upd on migration_financial_checks for update to authenticated
  using (is_owner() or auth_role() = 'accountant') with check (is_owner() or auth_role() = 'accountant');

-- دفعات الاستيراد: القراءة لطاقم الترحيل، الإنشاء/التنفيذ/التراجع للمدير فقط
create policy mig_batch_sel on migration_import_batches for select to authenticated using (is_mig_staff());
create policy mig_batch_ins on migration_import_batches for insert to authenticated with check (is_owner());
create policy mig_batch_upd on migration_import_batches for update to authenticated using (is_owner()) with check (is_owner());

-- سجل تدقيق الترحيل: المدير يقرأ
create policy mig_audit_sel on migration_audit_logs for select to authenticated using (is_owner());
create policy mig_audit_ins on migration_audit_logs for insert to authenticated with check (is_mig_staff());

-- =====================================================================
-- نهاية المرحلة 1 — طبقة قاعدة البيانات
-- =====================================================================
