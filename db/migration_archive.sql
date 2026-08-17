-- ---------------------------------------------------------------------
-- حذف/أرشفة مستندات الترحيل (حذف ناعم قابل للاستعادة)
-- شغّله مرّة واحدة:  Supabase → SQL Editor → الصق → Run
-- سبب الحاجة: enum حالة المستند (mig_doc_status) لا يحوي قيمة 'archived'،
-- لذا نستخدم عمودًا زمنيًا مستقلًّا للأرشفة يحفظ الحالة الأصلية ويسمح بالاستعادة.
-- الصلاحية: تحديث هذا العمود محكوم مسبقًا بسياسة *_upd على migration_documents
-- (is_mig_staff())، فلا حاجة لسياسة جديدة.
-- ---------------------------------------------------------------------

alter table migration_documents
  add column if not exists archived_at timestamptz;

-- فهرس لتسريع استبعاد/عرض المؤرشفة
create index if not exists mig_documents_archived_idx
  on migration_documents(archived_at);
