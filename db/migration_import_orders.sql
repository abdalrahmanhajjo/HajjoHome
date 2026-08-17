-- =====================================================================
-- وحدة الترحيل — استيراد الحساب القديم كاملًا (طلبات/دفعات/أقساط)
-- يُطبَّق بعد db/migration_import.sql:  SQL Editor → الصق → Run.
-- يستبدل mig_import_batch بنسخة تستورد أيضًا طلبات الزبون ودفعاته وأقساطه.
--
-- نمذجة البنود القديمة: الطلبات الحيّة تتطلّب product_id، والبيانات القديمة
-- وصف حرّ. لذا نستخدم "منتجًا وسيطًا للترحيل" غير مفعّل، ونضع الوصف الأصلي
-- في ملاحظات الطلب، مع بقاء التفاصيل في سجل الـ staging ومستنده.
--
-- افتراض العملة: تُعامَل المبالغ القديمة كدولار (السائد في هذا السوق).
-- على المُدخِل التأكّد من العملة أثناء الإدخال.
-- =====================================================================

create or replace function mig_import_batch(p_name text default null, p_ids uuid[] default null)
returns migration_import_batches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch   migration_import_batches%rowtype;
  rec       migration_customers%rowtype;
  so        migration_orders%rowtype;
  sp        migration_payments%rowtype;
  si        migration_installments%rowtype;
  v_prod    uuid;
  new_cid   uuid;
  new_oid   uuid;
  new_pid   uuid;
  inst_n    int;
  n_cust    int := 0;
  n_ord     int := 0;
  n_pay     int := 0;
  n_inst    int := 0;
begin
  if not is_owner() then
    raise exception 'الاستيراد صلاحية المدير فقط' using errcode = 'insufficient_privilege';
  end if;

  -- المنتج الوسيط للترحيل (يُنشأ مرة واحدة، غير مفعّل)
  select id into v_prod from products where model = '__LEGACY_ITEM__' limit 1;
  if v_prod is null then
    insert into categories (name) values ('ترحيل') on conflict (name) do nothing;
    insert into products (category_id, brand, model, description, is_serialized, is_active)
    select id, 'ترحيل', '__LEGACY_ITEM__', 'بند فاتورة قديمة (ترحيل)', false, false
      from categories where name = 'ترحيل'
    returning id into v_prod;
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
    -- 1) الزبون
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

    insert into migration_source_links (live_entity_type, live_entity_id, document_id, source_reference, staging_entity_type, staging_id, batch_id)
    values ('customer', new_cid, rec.document_id, rec.source_reference, 'customer', rec.id, v_batch.id);
    insert into migration_import_batch_items (batch_id, entity_type, staging_id, action, result, imported_id)
    values (v_batch.id, 'customer', rec.id, 'create', 'ok', new_cid);
    n_cust := n_cust + 1;

    -- 2) الطلبات القديمة لهذا الزبون
    for so in
      select * from migration_orders
       where migration_customer_id = rec.id and status <> 'rejected'
       order by seq
    loop
      insert into orders (customer_id, order_date, currency, fx_rate, plan, status, is_legacy, legacy_ref, notes, created_by)
      values (
        new_cid,
        coalesce(so.order_date::timestamptz, now()),
        'USD', 1, 'cash', 'completed', true,
        so.source_reference,
        nullif(btrim(concat_ws(' — ', so.product_description, so.brand, so.model, so.notes)), ''),
        auth.uid()
      )
      returning id into new_oid;

      -- بند وحيد يشير للمنتج الوسيط، سعره = إجمالي الطلب القديم
      insert into order_items (order_id, product_id, quantity, unit_price, discount)
      values (new_oid, v_prod, 1, coalesce(so.total_amount, 0), 0);

      update migration_orders set status = 'imported', imported_order_id = new_oid, import_batch_id = v_batch.id where id = so.id;
      insert into migration_source_links (live_entity_type, live_entity_id, document_id, source_reference, staging_entity_type, staging_id, batch_id)
      values ('order', new_oid, so.document_id, so.source_reference, 'order', so.id, v_batch.id);
      n_ord := n_ord + 1;

      -- أقساط هذا الطلب
      inst_n := 0;
      for si in
        select * from migration_installments where migration_order_id = so.id order by coalesce(number, 999999), created_at
      loop
        inst_n := inst_n + 1;
        if coalesce(si.amount, 0) > 0 then
          insert into installments (order_id, number, due_date, amount_usd, notes)
          values (new_oid, coalesce(si.number, inst_n), coalesce(si.due_date, current_date), si.amount, si.notes);
          n_inst := n_inst + 1;
        end if;
      end loop;
    end loop;

    -- 3) الدفعات القديمة لهذا الزبون
    for sp in
      select * from migration_payments
       where migration_customer_id = rec.id and status <> 'rejected'
       order by created_at
    loop
      if coalesce(sp.amount, 0) > 0 then
        insert into payments (direction, customer_id, payment_date, amount, currency, fx_rate, method, is_legacy, legacy_ref, notes, received_by)
        values (
          'in', new_cid, coalesce(sp.payment_date::timestamptz, now()),
          sp.amount, 'USD', 1,
          (case sp.payment_method
             when 'transfer' then 'transfer' when 'card' then 'card'
             when 'check' then 'cheque' when 'cheque' then 'cheque'
             when 'cash' then 'cash' else 'other' end)::payment_method,
          true, sp.source_reference, sp.notes, auth.uid()
        )
        returning id into new_pid;

        -- توزيع الدفعة على الطلب المرتبط إن استُورد
        if sp.migration_order_id is not null then
          insert into payment_allocations (payment_id, order_id, amount_usd)
          select new_pid, mo.imported_order_id, round(sp.amount, 2)
            from migration_orders mo
           where mo.id = sp.migration_order_id and mo.imported_order_id is not null;
        end if;

        update migration_payments set status = 'imported', imported_payment_id = new_pid, import_batch_id = v_batch.id where id = sp.id;
        insert into migration_source_links (live_entity_type, live_entity_id, document_id, source_reference, staging_entity_type, staging_id, batch_id)
        values ('payment', new_pid, sp.document_id, sp.source_reference, 'payment', sp.id, v_batch.id);
        n_pay := n_pay + 1;
      end if;
    end loop;
  end loop;

  update migration_import_batches
     set status = 'completed', ended_at = now(),
         customers_count = n_cust, orders_count = n_ord, payments_count = n_pay,
         installments_count = n_inst, accepted_count = n_cust
   where id = v_batch.id
  returning * into v_batch;

  return v_batch;
end;
$$;

grant execute on function mig_import_batch(text, uuid[]) to authenticated;


-- ---------------------------------------------------------------------
-- التراجع عن دفعة — تراجع "ناعم" يحترم مبدأ عدم الحذف المالي:
--   الدفعات تُلغى (voided_at)، الطلبات تُلغى (cancelled)، أقساطها تُلغى،
--   الزبائن يُعطَّلون. تبقى الصفوف للتدقيق لكنها غير فعّالة (لا تدخل الأرصدة).
--   وتُعاد سجلات الـ staging إلى الحالة القابلة لإعادة الاستيراد بعد التصحيح.
-- ---------------------------------------------------------------------
create or replace function mig_rollback_batch(p_batch_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_owner() then
    raise exception 'التراجع صلاحية المدير فقط' using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'سبب التراجع مطلوب' using errcode = 'check_violation';
  end if;

  -- إلغاء الدفعات الحيّة لهذه الدفعة
  update payments p
     set voided_at = now(), void_reason = concat('تراجع دفعة استيراد: ', p_reason), voided_by = auth.uid()
    from migration_source_links sl
   where sl.batch_id = p_batch_id and sl.live_entity_type = 'payment'
     and p.id = sl.live_entity_id and p.voided_at is null;

  -- إلغاء أقساط الطلبات الحيّة لهذه الدفعة
  update installments i
     set cancelled_at = now()
    from migration_source_links sl
   where sl.batch_id = p_batch_id and sl.live_entity_type = 'order'
     and i.order_id = sl.live_entity_id and i.cancelled_at is null;

  -- إلغاء الطلبات الحيّة (يُشغّل إعادة البضاعة للمنتج الوسيط — غير مؤثّر)
  update orders o
     set status = 'cancelled', cancelled_at = now(),
         cancel_reason = concat('تراجع دفعة استيراد: ', p_reason), cancelled_by = auth.uid()
    from migration_source_links sl
   where sl.batch_id = p_batch_id and sl.live_entity_type = 'order'
     and o.id = sl.live_entity_id and o.status <> 'cancelled';

  -- تعطيل الزبائن المستورَدين (لا يمكن حذفهم لوجود صفوف مرتبطة)
  update customers c
     set status = 'inactive',
         notes = concat_ws(' | ', c.notes, concat('تراجع دفعة استيراد: ', p_reason))
    from migration_source_links sl
   where sl.batch_id = p_batch_id and sl.live_entity_type = 'customer'
     and c.id = sl.live_entity_id;

  -- إعادة سجلات الـ staging لحالة قابلة لإعادة الاستيراد + فكّ الربط
  update migration_customers set status = 'approved_for_import', imported_customer_id = null, import_batch_id = null where import_batch_id = p_batch_id;
  update migration_orders     set status = 'draft', imported_order_id = null, import_batch_id = null where import_batch_id = p_batch_id;
  update migration_payments   set status = 'draft', imported_payment_id = null, import_batch_id = null where import_batch_id = p_batch_id;

  -- روابط المصدر تشير الآن لصفوف ملغاة — تُحذف (جدول غير مالي)
  delete from migration_source_links where batch_id = p_batch_id;

  update migration_import_batches
     set status = 'rolled_back', rolled_back_at = now(), rollback_reason = p_reason
   where id = p_batch_id;
end;
$$;

grant execute on function mig_rollback_batch(uuid, text) to authenticated;
