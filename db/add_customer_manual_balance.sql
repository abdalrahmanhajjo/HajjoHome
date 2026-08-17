-- Run once in Supabase SQL Editor before deploying the matching frontend.
-- Adds an editable customer debt that does not require products or an invoice.

begin;

alter table customers
  add column if not exists manual_balance_usd numeric(14,2) not null default 0;

alter table customers
  drop constraint if exists customers_manual_balance_usd_check;

alter table customers
  add constraint customers_manual_balance_usd_check
  check (manual_balance_usd >= 0);

comment on column customers.manual_balance_usd is
  'Editable debt entered directly on the customer without products or an invoice; USD, non-negative.';

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
  pay.last_payment_date,
  c.manual_balance_usd
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
