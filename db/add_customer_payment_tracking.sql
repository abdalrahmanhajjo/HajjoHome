-- Run after add_customer_manual_balance.sql.
-- Tracks a monthly payment cycle from the latest of the manual or recorded payment date.

begin;

alter table customers
  add column if not exists manual_last_payment_date date;

comment on column customers.manual_last_payment_date is
  'Optional manually entered last-payment date; the next payment is due one calendar month later.';

create or replace view v_customer_balances with (security_invoker = on) as
select
  c.id                                  as customer_id,
  c.code,
  c.full_name,
  c.phone,
  c.area,
  c.status,
  coalesce(o.purchases_usd, 0)          as purchases_usd,
  coalesce(pay.paid_usd, 0)             as paid_usd,
  c.manual_balance_usd + coalesce(o.purchases_usd, 0) - coalesce(pay.paid_usd, 0) as balance_usd,
  coalesce(o.orders_count, 0)           as orders_count,
  coalesce(o.open_orders, 0)            as open_orders,
  o.last_order_date,
  greatest(pay.last_payment_date, c.manual_last_payment_date::timestamptz) as last_payment_date,
  c.manual_balance_usd,
  c.manual_last_payment_date,
  (greatest(pay.last_payment_date::date, c.manual_last_payment_date) + interval '1 month')::date as next_payment_due_date,
  case
    when c.manual_balance_usd + coalesce(o.purchases_usd, 0) - coalesce(pay.paid_usd, 0) <= 0.005 then 'settled'
    when greatest(pay.last_payment_date::date, c.manual_last_payment_date) is null then 'unscheduled'
    when (greatest(pay.last_payment_date::date, c.manual_last_payment_date) + interval '1 month')::date < current_date then 'overdue'
    when (greatest(pay.last_payment_date::date, c.manual_last_payment_date) + interval '1 month')::date = current_date then 'due_today'
    else 'current'
  end as payment_tracking_status,
  case
    when (greatest(pay.last_payment_date::date, c.manual_last_payment_date) + interval '1 month')::date < current_date
      then current_date - (greatest(pay.last_payment_date::date, c.manual_last_payment_date) + interval '1 month')::date
    else 0
  end as payment_days_overdue
from customers c
left join (
  select customer_id,
         sum(total_usd)                             as purchases_usd,
         count(*)                                   as orders_count,
         count(*) filter (where remaining_usd > 0)  as open_orders,
         max(order_date)                            as last_order_date
    from v_order_totals
   where status not in ('draft','cancelled')
   group by customer_id
) o on o.customer_id = c.id
left join (
  select customer_id,
         sum(amount_usd)   as paid_usd,
         max(payment_date) as last_payment_date
    from payments
   where direction = 'in' and voided_at is null
   group by customer_id
) pay on pay.customer_id = c.id;

commit;
