-- =====================================================================
-- تخزين مستندات الترحيل — bucket خاص + سياسات RLS
-- يُطبَّق بعد db/migration.sql:  SQL Editor → الصق → Run.
-- المستندات خاصة تمامًا (وثائق هوية ومالية) — لا وصول عام إطلاقًا.
-- الوصول عبر روابط موقّعة (signed URLs) لطاقم الترحيل فقط.
-- =====================================================================

-- إنشاء الـ bucket (خاص)
insert into storage.buckets (id, name, public)
values ('legacy-docs', 'legacy-docs', false)
on conflict (id) do nothing;

-- سياسات RLS على الملفات: طاقم الترحيل فقط يرفع/يقرأ/يحذف في هذا الـ bucket
drop policy if exists "legacy_docs_read"   on storage.objects;
drop policy if exists "legacy_docs_insert" on storage.objects;
drop policy if exists "legacy_docs_delete" on storage.objects;

create policy "legacy_docs_read" on storage.objects for select to authenticated
  using (bucket_id = 'legacy-docs' and public.is_mig_staff());

create policy "legacy_docs_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'legacy-docs' and public.is_mig_staff());

create policy "legacy_docs_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'legacy-docs' and public.is_mig_staff());
