-- =====================================================================
-- وحدة الترحيل — التحقّق المالي
-- يُطبَّق بعد db/migration.sql:  SQL Editor → الصق → Run.
-- يفحص طلبات الـ staging ويولّد اختلافات مالية للمراجعة (لا اعتماد تلقائي).
-- =====================================================================

create or replace function mig_validate_financials()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  if not is_mig_staff() then
    raise exception 'لا تملك صلاحية التحقّق المالي' using errcode = 'insufficient_privilege';
  end if;

  -- أعد توليد الفحوص غير المعتمدة كاستثناء
  delete from migration_financial_checks where status <> 'approved_exception';

  -- المدفوع يتجاوز الإجمالي
  insert into migration_financial_checks
    (migration_customer_id, migration_order_id, check_type, expected, actual, difference, currency, status)
  select mo.migration_customer_id, mo.id, 'paid_exceeds_total',
         mo.total_amount, mo.paid_amount,
         round(coalesce(mo.paid_amount,0) - coalesce(mo.total_amount,0), 2), mo.currency, 'mismatch'
    from migration_orders mo
   where mo.status <> 'rejected'
     and coalesce(mo.paid_amount,0) > coalesce(mo.total_amount,0) + 0.01;

  -- المتبقّي المكتوب لا يساوي (الإجمالي - المدفوع)
  insert into migration_financial_checks
    (migration_customer_id, migration_order_id, check_type, expected, actual, difference, currency, status)
  select mo.migration_customer_id, mo.id, 'remaining_mismatch',
         round(coalesce(mo.total_amount,0) - coalesce(mo.paid_amount,0), 2), mo.remaining_amount,
         round((coalesce(mo.total_amount,0) - coalesce(mo.paid_amount,0)) - mo.remaining_amount, 2),
         mo.currency, 'mismatch'
    from migration_orders mo
   where mo.status <> 'rejected' and mo.remaining_amount is not null
     and abs((coalesce(mo.total_amount,0) - coalesce(mo.paid_amount,0)) - mo.remaining_amount) > 0.01;

  -- عملة مفقودة على طلب فيه مبلغ
  insert into migration_financial_checks
    (migration_customer_id, migration_order_id, check_type, expected, actual, difference, currency, status)
  select mo.migration_customer_id, mo.id, 'missing_currency', null, null, null, mo.currency, 'warning'
    from migration_orders mo
   where mo.status <> 'rejected' and coalesce(mo.total_amount,0) > 0
     and (mo.currency is null or btrim(mo.currency) = '');

  select count(*) into n from migration_financial_checks
   where status in ('mismatch','warning','owner_review','accountant_review');
  return n;
end;
$$;

grant execute on function mig_validate_financials() to authenticated;
