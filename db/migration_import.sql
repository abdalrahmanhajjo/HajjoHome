-- =====================================================================
-- وحدة الترحيل — المرحلة 3: الاستيراد إلى النظام الحيّ
-- يُطبَّق بعد db/migration.sql:  SQL Editor → الصق → Run.
--
-- يستورد هذا الملف "زبائن" الترحيل المعتمدين إلى جدول customers الحيّ
-- ضمن معاملة واحدة، مع:
--   * ربط كل سجل حيّ بمستنده الأصلي (migration_source_links).
--   * تحديث حالة سجل الـ staging إلى imported وربط imported_customer_id.
--   * إمكانية التراجع عن الدفعة (حذف الزبائن الذين لا فواتير/دفعات لهم).
--
-- ملاحظة: الرصيد الافتتاحي لا يُستورد بعد — الجدول الحيّ يحسب الرصيد من
--   الفواتير والدفعات ولا يملك آلية رصيد افتتاحي. يبقى محفوظًا في الـ staging
--   ومرتبطًا بمستنده، ويُعالَج في تحسين لاحق (جدول أرصدة افتتاحية حيّ).
-- =====================================================================

-- ---------------------------------------------------------------------
-- معاينة الاستيراد: السجلات المعتمدة + عدد التطابقات مع زبائن أحياء
-- ---------------------------------------------------------------------
create or replace view v_mig_import_ready with (security_invoker = on) as
select
  mc.id,
  mc.code,
  coalesce(mc.full_name_ar, mc.full_name_en) as full_name,
  mc.phone,
  mc.national_id,
  mc.area,
  mc.opening_balance,
  mc.currency,
  mc.source_reference,
  (
    select count(*) from customers c
     where (mc.phone       is not null and c.phone       = mc.phone)
        or (mc.national_id is not null and c.national_id = mc.national_id)
  ) as dup_live_count
from migration_customers mc
where mc.status = 'approved_for_import';

-- ---------------------------------------------------------------------
-- استيراد دفعة (المدير فقط) — معاملة واحدة
--   p_ids = null → كل المعتمدين؛ أو مصفوفة معرّفات محددة.
-- ---------------------------------------------------------------------
create or replace function mig_import_batch(p_name text default null, p_ids uuid[] default null)
returns migration_import_batches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch migration_import_batches%rowtype;
  rec     migration_customers%rowtype;
  new_cid uuid;
  n       int := 0;
begin
  if not is_owner() then
    raise exception 'الاستيراد صلاحية المدير فقط' using errcode = 'insufficient_privilege';
  end if;

  insert into migration_import_batches (name, created_by, status, started_at)
  values (coalesce(nullif(btrim(p_name), ''), 'دفعة استيراد'), auth.uid(), 'importing', now())
  returning * into v_batch;

  for rec in
    select * from migration_customers
     where status = 'approved_for_import'
       and (p_ids is null or id = any(p_ids))
     order by seq
  loop
    insert into customers
      (full_name, phone_raw, phone2_raw, area, address, national_id,
       guarantor_name, guarantor_phone, is_legacy, legacy_ref, notes, created_by)
    values
      (coalesce(nullif(btrim(rec.full_name_ar), ''), nullif(btrim(rec.full_name_en), ''), 'غير معروف'),
       rec.phone_raw, rec.phone2_raw, rec.area, rec.raw_address, rec.national_id,
       rec.guarantor_name, rec.guarantor_phone, true,
       coalesce(rec.source_reference, rec.old_customer_ref), rec.account_notes, auth.uid())
    returning id into new_cid;

    update migration_customers
       set status = 'imported', imported_customer_id = new_cid, import_batch_id = v_batch.id
     where id = rec.id;

    insert into migration_source_links
      (live_entity_type, live_entity_id, document_id, source_reference, staging_entity_type, staging_id, batch_id)
    values
      ('customer', new_cid, rec.document_id, rec.source_reference, 'customer', rec.id, v_batch.id);

    insert into migration_import_batch_items
      (batch_id, entity_type, staging_id, action, result, imported_id)
    values
      (v_batch.id, 'customer', rec.id, 'create', 'ok', new_cid);

    n := n + 1;
  end loop;

  update migration_import_batches
     set status = 'completed', ended_at = now(), customers_count = n, accepted_count = n
   where id = v_batch.id
  returning * into v_batch;

  return v_batch;
end;
$$;

-- ---------------------------------------------------------------------
-- التراجع عن دفعة (المدير فقط) — يمنعه وجود فواتير/دفعات مرتبطة
-- ---------------------------------------------------------------------
create or replace function mig_rollback_batch(p_batch_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
begin
  if not is_owner() then
    raise exception 'التراجع صلاحية المدير فقط' using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'سبب التراجع مطلوب' using errcode = 'check_violation';
  end if;

  -- امنع التراجع إذا ارتبط أي زبون بفواتير أو دفعات حيّة
  if exists (
    select 1 from migration_source_links sl
     where sl.batch_id = p_batch_id and sl.live_entity_type = 'customer'
       and (exists (select 1 from orders   o where o.customer_id = sl.live_entity_id)
         or exists (select 1 from payments p where p.customer_id = sl.live_entity_id))
  ) then
    raise exception 'لا يمكن التراجع: توجد فواتير أو دفعات مرتبطة بزبائن هذه الدفعة'
      using errcode = 'check_violation';
  end if;

  for rec in
    select sl.live_entity_id, sl.staging_id
      from migration_source_links sl
     where sl.batch_id = p_batch_id and sl.live_entity_type = 'customer'
  loop
    update migration_customers
       set status = 'approved_for_import', imported_customer_id = null, import_batch_id = null
     where id = rec.staging_id;
    delete from customers where id = rec.live_entity_id;   -- security definer يتجاوز منع الحذف
  end loop;

  delete from migration_source_links where batch_id = p_batch_id;
  update migration_import_batches
     set status = 'rolled_back', rolled_back_at = now(), rollback_reason = p_reason
   where id = p_batch_id;
end;
$$;

grant execute on function mig_import_batch(text, uuid[]) to authenticated;
grant execute on function mig_rollback_batch(uuid, text) to authenticated;
