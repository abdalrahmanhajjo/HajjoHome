-- =====================================================================
-- وحدة الترحيل — كشف التكرار (Duplicate detection)
-- يُطبَّق بعد db/migration.sql:  SQL Editor → الصق → Run.
--
-- يولّد مرشّحي تكرار بمؤشّرات قوية (نفس الهاتف/الهوية) بين:
--   * سجل ترحيل وزبون حيّ موجود.
--   * سجلَّي ترحيل.
-- لا دمج تلقائي إطلاقًا — فقط اقتراح للمراجعة البشرية (شاشة الزبائن المكررون).
-- =====================================================================

create or replace function mig_detect_duplicates()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  active_statuses mig_status[] := array['draft','data_entry','ready_for_review','needs_correction','approved_for_import']::mig_status[];
  n int;
begin
  if not is_mig_staff() then
    raise exception 'لا تملك صلاحية فحص التكرار' using errcode = 'insufficient_privilege';
  end if;

  -- أعد توليد المرشّحين المفتوحين فقط (المحسومون يبقون)
  delete from migration_duplicate_candidates where status = 'open';

  -- ترحيل ↔ زبون حيّ: نفس الهاتف
  insert into migration_duplicate_candidates (customer_a, live_customer_id, score, band, indicators, status)
  select s.id, c.id, 90, 'very_likely', jsonb_build_object('match', 'phone', 'value', s.phone), 'open'
    from migration_customers s
    join customers c on c.phone = s.phone
   where s.phone is not null and s.status = any(active_statuses)
     and not exists (select 1 from migration_duplicate_candidates dc
                      where dc.customer_a = s.id and dc.live_customer_id = c.id);

  -- ترحيل ↔ زبون حيّ: نفس رقم الهوية
  insert into migration_duplicate_candidates (customer_a, live_customer_id, score, band, indicators, status)
  select s.id, c.id, 95, 'very_likely', jsonb_build_object('match', 'national_id', 'value', s.national_id), 'open'
    from migration_customers s
    join customers c on c.national_id = s.national_id
   where s.national_id is not null and btrim(s.national_id) <> '' and s.status = any(active_statuses)
     and not exists (select 1 from migration_duplicate_candidates dc
                      where dc.customer_a = s.id and dc.live_customer_id = c.id);

  -- ترحيل ↔ ترحيل: نفس الهاتف (زوج واحد)
  insert into migration_duplicate_candidates (customer_a, customer_b, score, band, indicators, status)
  select s.id, t.id, 85, 'likely', jsonb_build_object('match', 'phone', 'value', s.phone), 'open'
    from migration_customers s
    join migration_customers t on t.phone = s.phone and t.seq > s.seq
   where s.phone is not null and s.status = any(active_statuses) and t.status = any(active_statuses)
     and not exists (select 1 from migration_duplicate_candidates dc
                      where (dc.customer_a = s.id and dc.customer_b = t.id)
                         or (dc.customer_a = t.id and dc.customer_b = s.id));

  -- ترحيل ↔ ترحيل: نفس رقم الهوية (زوج واحد)
  insert into migration_duplicate_candidates (customer_a, customer_b, score, band, indicators, status)
  select s.id, t.id, 95, 'very_likely', jsonb_build_object('match', 'national_id', 'value', s.national_id), 'open'
    from migration_customers s
    join migration_customers t on t.national_id = s.national_id and t.seq > s.seq
   where s.national_id is not null and btrim(s.national_id) <> ''
     and s.status = any(active_statuses) and t.status = any(active_statuses)
     and not exists (select 1 from migration_duplicate_candidates dc
                      where (dc.customer_a = s.id and dc.customer_b = t.id)
                         or (dc.customer_a = t.id and dc.customer_b = s.id));

  select count(*) into n from migration_duplicate_candidates where status = 'open';
  return n;
end;
$$;

grant execute on function mig_detect_duplicates() to authenticated;
