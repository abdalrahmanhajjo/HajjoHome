-- =====================================================================
-- نظام إدارة محل الأدوات والأجهزة الكهربائية
-- المخطط الكامل لقاعدة البيانات — ملف واحد (المصدر الوحيد للحقيقة)
--
-- التطبيق على Supabase:
--   Dashboard → SQL Editor → الصق الملف كاملًا → Run
-- أو:  psql "$DATABASE_URL" -f db/schema.sql
--
-- الترتيب مهم — الملف يُنفَّذ من أوله لآخره مرة واحدة.
-- مُختبَر على PostgreSQL 16 (Supabase).
--
-- المحتويات:
--   الجزء 1 — الأساسيات: الأنواع، الدوال، المستخدمون، الزبائن،
--             الموردون، المنتجات، القطع المسلسلة
--   الجزء 2 — البيع والمال: المشتريات، الفواتير، التوصيل،
--             الأقساط، الدفعات، توزيع الدفعات
--   الجزء 3 — المخزون والتقارير: دفتر الحركات وكل الـ views
--   الجزء 4 — سجل التدقيق والصلاحيات (RLS)
--   الجزء 5 — دوال العمليات (RPC) الآمنة: بيع، قبض دفعة
--
-- ملاحظات الإصلاحات المدمجة (راجع PROJECT_BRIEF / المحادثة):
--   * كل الـ views تعمل بـ security_invoker=on حتى تُطبَّق RLS الجداول.
--   * v_profit_by_order يمنع رؤية الكلفة/الربح لغير المدير/المحاسب.
--   * إعادة البضاعة للمخزون عند الإلغاء/الإرجاع (trg_restock_on_order_close).
--   * فحص أقل سعر يراعي عملة الفاتورة (تحويل إلى الدولار قبل المقارنة).
-- =====================================================================


-- #####################################################################
-- الجزء 1 — الأساسيات
-- #####################################################################

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists pg_trgm;    -- بحث تقريبي بالأسماء العربية

-- ---------------------------------------------------------------------
-- 1. الأنواع (Enums)
-- ---------------------------------------------------------------------
create type user_role          as enum ('owner','sales','accountant','stock');
create type customer_status    as enum ('active','inactive','needs_review','defaulted');
create type currency_code      as enum ('USD','LBP');
create type unit_condition     as enum ('new','used','display');
create type unit_status        as enum ('in_stock','reserved','sold','delivered','returned','defective','in_repair');
create type order_status       as enum ('draft','confirmed','reserved','ready','delivered','completed','cancelled','returned');
create type payment_plan       as enum ('cash','installments','mixed');
create type payment_method     as enum ('cash','transfer','card','cheque','other');
create type payment_direction  as enum ('in','out');   -- in = قبض من زبون، out = دفع لمورد
create type movement_type      as enum ('purchase_in','sale_out','customer_return','supplier_return','damaged','count_adjust','transfer');
create type data_quality       as enum ('ok','needs_review','incomplete');
create type delivery_status    as enum ('pending','scheduled','delivered','failed','cancelled');

-- ---------------------------------------------------------------------
-- 2. دوال مساعدة
-- ---------------------------------------------------------------------

-- توحيد رقم الهاتف اللبناني إلى صيغة +961XXXXXXXX
-- ملاحظة: قواعد تقريبية — راجعها على عينة من أرقام الدفاتر قبل الاعتماد.
-- نظير هذه الدالة في الواجهة: phoneSearchDigits() — عدّل أحدهما عدّل الآخر.
create or replace function normalize_phone(raw text)
returns text
language plpgsql
immutable
as $$
declare
  d text;
begin
  if raw is null or btrim(raw) = '' then
    return null;
  end if;

  d := regexp_replace(raw, '[^0-9]', '', 'g');

  if d = '' then
    return null;
  elsif left(d, 5) = '00961' then
    d := substr(d, 6);
  elsif left(d, 3) = '961' and length(d) >= 10 then
    d := substr(d, 4);
  end if;

  -- إزالة الصفر الوطني: 03456789 و 96103456789 و 3456789 كلها نفس الرقم
  d := ltrim(d, '0');

  if d = '' then
    return null;
  end if;

  return '+961' || d;
end;
$$;

-- تحديث updated_at تلقائيًا
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. المستخدمون والصلاحيات
-- ---------------------------------------------------------------------
create table profiles (
  id          uuid primary key references auth.users(id) on delete restrict,
  full_name   text not null check (btrim(full_name) <> ''),
  role        user_role not null default 'sales',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger trg_profiles_updated before update on profiles
  for each row execute function set_updated_at();

-- دور المستخدم الحالي — تُستخدم داخل سياسات RLS
create or replace function auth_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid() and is_active
$$;

create or replace function is_owner()
returns boolean
language sql
stable
as $$ select auth_role() = 'owner' $$;

-- ---------------------------------------------------------------------
-- 4. الزبائن
-- ---------------------------------------------------------------------
create sequence customer_seq;

create table customers (
  id              uuid primary key default gen_random_uuid(),
  seq             bigint not null default nextval('customer_seq'),
  code            text generated always as ('C-' || lpad(seq::text, 5, '0')) stored,

  full_name       text not null check (btrim(full_name) <> ''),
  phone_raw       text,
  phone           text generated always as (normalize_phone(phone_raw)) stored,
  phone2_raw      text,
  phone2          text generated always as (normalize_phone(phone2_raw)) stored,

  area            text,
  address         text,
  national_id     text,
  guarantor_name  text,
  guarantor_phone text,
  manual_balance_usd numeric(14,2) not null default 0 check (manual_balance_usd >= 0),
  status          customer_status not null default 'active',
  notes           text,

  -- حقول ترحيل الدفاتر القديمة
  is_legacy       boolean not null default false,
  legacy_ref      text,          -- مثال: 'دفتر 3 / صفحة 128'
  quality         data_quality not null default 'ok',

  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter sequence customer_seq owned by customers.seq;
create unique index customers_code_uq on customers(code);
create index customers_phone_idx    on customers(phone);
create index customers_phone2_idx   on customers(phone2);
create index customers_name_trgm    on customers using gin (full_name gin_trgm_ops);
create index customers_area_idx     on customers(area);
create index customers_status_idx   on customers(status);

create trigger trg_customers_updated before update on customers
  for each row execute function set_updated_at();

comment on column customers.phone is
  'محسوب تلقائيًا من phone_raw — لا يُكتب مباشرة. غير فريد عمدًا: بيانات الدفاتر فيها تكرار، والتنبيه يتم عبر v_duplicate_customers.';

-- ---------------------------------------------------------------------
-- 5. الموردون
-- ---------------------------------------------------------------------
create sequence supplier_seq;

create table suppliers (
  id           uuid primary key default gen_random_uuid(),
  seq          bigint not null default nextval('supplier_seq'),
  code         text generated always as ('V-' || lpad(seq::text, 4, '0')) stored,
  name         text not null check (btrim(name) <> ''),
  company      text,
  phone_raw    text,
  phone        text generated always as (normalize_phone(phone_raw)) stored,
  address      text,
  notes        text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter sequence supplier_seq owned by suppliers.seq;
create unique index suppliers_code_uq on suppliers(code);
create trigger trg_suppliers_updated before update on suppliers
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 6. الفئات والمنتجات (الكتالوج — الموديل وليس القطعة)
-- ---------------------------------------------------------------------
create table categories (
  id        uuid primary key default gen_random_uuid(),
  name      text not null unique,     -- براد، غسالة، فرن، تلفزيون ...
  sort_order int not null default 0
);

create sequence product_seq;

create table products (
  id              uuid primary key default gen_random_uuid(),
  seq             bigint not null default nextval('product_seq'),
  code            text generated always as ('P-' || lpad(seq::text, 5, '0')) stored,

  category_id     uuid not null references categories(id) on delete restrict,
  brand           text,
  model           text,
  description     text,

  -- true = كل قطعة لها رقم تسلسلي (براد، غسالة)
  -- false = بضاعة بالكمية (كابل، لمبة) — الرصيد من دفتر الحركات
  is_serialized   boolean not null default true,

  sale_price      numeric(14,2) check (sale_price >= 0),   -- سعر البيع المقترح (دولار)
  min_price       numeric(14,2) check (min_price  >= 0),   -- أقل سعر مسموح (دولار)
  warranty_months int not null default 0 check (warranty_months >= 0),
  default_supplier_id uuid references suppliers(id) on delete set null,
  reorder_level   numeric(12,3) not null default 0 check (reorder_level >= 0),
  is_active       boolean not null default true,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint products_price_floor_chk
    check (min_price is null or sale_price is null or min_price <= sale_price)
);

alter sequence product_seq owned by products.seq;
create unique index products_code_uq on products(code);
create index products_category_idx on products(category_id);
create index products_brand_model_trgm on products using gin
  ((coalesce(brand,'') || ' ' || coalesce(model,'')) gin_trgm_ops);

create trigger trg_products_updated before update on products
  for each row execute function set_updated_at();

-- سعر الشراء في جدول منفصل: موظف المبيعات لا يملك صلاحية القراءة عليه
-- (RLS يعمل على مستوى الصف لا العمود، لذلك الفصل هو الطريقة الصحيحة)
create table product_costs (
  product_id         uuid primary key references products(id) on delete cascade,
  purchase_price_usd numeric(14,2) not null check (purchase_price_usd >= 0),
  updated_at         timestamptz not null default now()
);

create trigger trg_product_costs_updated before update on product_costs
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 7. القطع المسلسلة (الجهاز الفعلي الموجود بالمستودع)
-- ---------------------------------------------------------------------
create table product_units (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references products(id) on delete restrict,
  serial_number  text not null check (btrim(serial_number) <> ''),
  condition      unit_condition not null default 'new',
  status         unit_status not null default 'in_stock',
  location       text,                       -- 'المستودع 1 - رف B'
  received_at    date,
  purchase_id    uuid,                       -- FK يُضاف بعد إنشاء purchases
  notes          text,
  is_legacy      boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index product_units_serial_uq on product_units(lower(btrim(serial_number)));
create index product_units_product_idx on product_units(product_id);
create index product_units_status_idx  on product_units(status);

create trigger trg_units_updated before update on product_units
  for each row execute function set_updated_at();

-- كلفة القطعة الواحدة — مفصولة لنفس سبب product_costs
create table unit_costs (
  product_unit_id uuid primary key references product_units(id) on delete cascade,
  cost_usd        numeric(14,2) not null check (cost_usd >= 0)
);


-- #####################################################################
-- الجزء 2 — البيع والمال
-- #####################################################################

-- ---------------------------------------------------------------------
-- 1. المشتريات من الموردين
-- ---------------------------------------------------------------------
create sequence purchase_seq;

create table purchases (
  id            uuid primary key default gen_random_uuid(),
  seq           bigint not null default nextval('purchase_seq'),
  code          text generated always as ('PO-' || lpad(seq::text, 5, '0')) stored,
  supplier_id   uuid not null references suppliers(id) on delete restrict,
  purchase_date date not null default current_date,
  currency      currency_code not null default 'USD',
  fx_rate       numeric(14,4) not null default 1 check (fx_rate > 0),  -- كم وحدة من العملة تساوي 1 دولار
  invoice_ref   text,          -- رقم فاتورة المورد الورقية
  notes         text,
  cancelled_at  timestamptz,
  cancel_reason text,
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter sequence purchase_seq owned by purchases.seq;
create unique index purchases_code_uq on purchases(code);
create index purchases_supplier_idx on purchases(supplier_id, purchase_date);
create trigger trg_purchases_updated before update on purchases
  for each row execute function set_updated_at();

create table purchase_items (
  id           uuid primary key default gen_random_uuid(),
  purchase_id  uuid not null references purchases(id) on delete cascade,
  product_id   uuid not null references products(id) on delete restrict,
  quantity     numeric(12,3) not null check (quantity > 0),
  unit_cost    numeric(14,2) not null check (unit_cost >= 0),
  line_total   numeric(14,2) generated always as (round(quantity * unit_cost, 2)) stored
);

create index purchase_items_purchase_idx on purchase_items(purchase_id);
create index purchase_items_product_idx  on purchase_items(product_id);

-- ربط القطعة بفاتورة الشراء التي أتت بها
alter table product_units
  add constraint product_units_purchase_fk
  foreign key (purchase_id) references purchases(id) on delete set null;

-- ---------------------------------------------------------------------
-- 2. الطلبات / فواتير البيع
-- ---------------------------------------------------------------------
create sequence order_seq;

create table orders (
  id                   uuid primary key default gen_random_uuid(),
  seq                  bigint not null default nextval('order_seq'),
  code                 text generated always as ('S-' || lpad(seq::text, 6, '0')) stored,

  customer_id          uuid not null references customers(id) on delete restrict,
  order_date           timestamptz not null default now(),

  currency             currency_code not null default 'USD',
  fx_rate              numeric(14,4) not null default 1 check (fx_rate > 0),

  discount_amount      numeric(14,2) not null default 0 check (discount_amount >= 0),
  discount_reason      text,
  discount_approved_by uuid references profiles(id),
  delivery_fee         numeric(14,2) not null default 0 check (delivery_fee >= 0),

  plan                 payment_plan not null default 'cash',
  status               order_status not null default 'draft',
  notes                text,

  is_legacy            boolean not null default false,
  legacy_ref           text,
  quality              data_quality not null default 'ok',

  created_by           uuid references profiles(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  cancelled_at         timestamptz,
  cancel_reason        text,
  cancelled_by         uuid references profiles(id),

  constraint orders_discount_reason_chk
    check (discount_amount = 0 or discount_reason is not null),
  constraint orders_cancel_reason_chk
    check (cancelled_at is null or cancel_reason is not null)
);

alter sequence order_seq owned by orders.seq;
create unique index orders_code_uq on orders(code);
create index orders_customer_idx on orders(customer_id, order_date desc);
create index orders_status_idx   on orders(status);
create index orders_date_idx     on orders(order_date);

create trigger trg_orders_updated before update on orders
  for each row execute function set_updated_at();

create table order_items (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references orders(id) on delete cascade,
  product_id        uuid not null references products(id) on delete restrict,
  product_unit_id   uuid references product_units(id) on delete restrict,
  quantity          numeric(12,3) not null default 1 check (quantity > 0),
  unit_price        numeric(14,2) not null check (unit_price >= 0),
  discount          numeric(14,2) not null default 0 check (discount >= 0),
  line_total        numeric(14,2) generated always as
                      (round(quantity * unit_price - discount, 2)) stored,
  -- من وافق على البيع تحت أقل سعر مسموح
  price_override_by uuid references profiles(id),

  constraint order_items_unit_qty_chk
    check (product_unit_id is null or quantity = 1)
);

create index order_items_order_idx   on order_items(order_id);
create index order_items_product_idx on order_items(product_id);
create index order_items_unit_idx    on order_items(product_unit_id);

-- ---------------------------------------------------------------------
-- 3. حارس القطع المسلسلة
--    يمنع بيع نفس الرقم التسلسلي مرتين، مع قفل الصف لمنع التسابق.
--    إصلاح: فحص أقل سعر يحوّل سعر الفاتورة إلى الدولار قبل المقارنة.
-- ---------------------------------------------------------------------
create or replace function order_item_unit_guard()
returns trigger
language plpgsql
as $$
declare
  u           product_units%rowtype;
  floor_price numeric(14,2);
  ord_fx      numeric(14,4);
  net_usd     numeric(14,2);
begin
  if tg_op = 'INSERT' then
    -- التحقق من أقل سعر مسموح (بالدولار)
    select min_price into floor_price from products where id = new.product_id;
    select fx_rate   into ord_fx     from orders   where id = new.order_id;

    if floor_price is not null then
      net_usd := round((new.unit_price - new.discount) / coalesce(ord_fx, 1), 2);
      if net_usd < floor_price and new.price_override_by is null then
        raise exception 'السعر % (بالدولار) أقل من الحد المسموح % — يلزم موافقة المدير (price_override_by)',
          net_usd, floor_price
          using errcode = 'check_violation';
      end if;
    end if;

    if new.product_unit_id is not null then
      select * into u from product_units where id = new.product_unit_id for update;

      if u.product_id <> new.product_id then
        raise exception 'الرقم التسلسلي % لا يعود لهذا المنتج', u.serial_number
          using errcode = 'check_violation';
      end if;

      if u.status not in ('in_stock','reserved') then
        raise exception 'الجهاز % غير متاح للبيع (حالته الحالية: %)', u.serial_number, u.status
          using errcode = 'check_violation';
      end if;

      update product_units set status = 'sold' where id = new.product_unit_id;
    end if;
    return new;

  elsif tg_op = 'DELETE' then
    if old.product_unit_id is not null then
      update product_units set status = 'in_stock'
       where id = old.product_unit_id and status = 'sold';
    end if;
    return old;
  end if;
  return null;
end;
$$;

create trigger trg_order_item_unit_guard
  before insert or delete on order_items
  for each row execute function order_item_unit_guard();

-- ---------------------------------------------------------------------
-- 4. التوصيل والتركيب
-- ---------------------------------------------------------------------
create table deliveries (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references orders(id) on delete cascade,
  status         delivery_status not null default 'pending',
  scheduled_at   timestamptz,
  delivered_at   timestamptz,
  address        text,
  area           text,
  driver_name    text,
  installer_name text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint deliveries_delivered_chk
    check (status <> 'delivered' or delivered_at is not null)
);

create index deliveries_order_idx  on deliveries(order_id);
create index deliveries_status_idx on deliveries(status, scheduled_at);
create trigger trg_deliveries_updated before update on deliveries
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 5. جدول الأقساط (الجدولة فقط — الحالة تُحسب ولا تُخزَّن)
-- ---------------------------------------------------------------------
create table installments (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  number      int not null check (number > 0),
  due_date    date not null,
  amount_usd  numeric(14,2) not null check (amount_usd > 0),
  notes       text,
  cancelled_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (order_id, number)
);

create index installments_due_idx   on installments(due_date);
create index installments_order_idx on installments(order_id);

-- ---------------------------------------------------------------------
-- 6. الدفعات — سجل مالي لا يُعدَّل ولا يُحذف
-- ---------------------------------------------------------------------
create sequence receipt_seq;

create table payments (
  id             uuid primary key default gen_random_uuid(),
  seq            bigint not null default nextval('receipt_seq'),
  receipt_no     text generated always as ('R-' || lpad(seq::text, 6, '0')) stored,

  direction      payment_direction not null,      -- in = قبض من زبون، out = دفع لمورد
  customer_id    uuid references customers(id) on delete restrict,
  supplier_id    uuid references suppliers(id) on delete restrict,

  payment_date   timestamptz not null default now(),
  amount         numeric(14,2) not null check (amount > 0),
  currency       currency_code not null default 'USD',
  fx_rate        numeric(14,4) not null default 1 check (fx_rate > 0),
  amount_usd     numeric(14,2) generated always as (round(amount / fx_rate, 2)) stored,

  method         payment_method not null default 'cash',
  reference_no   text,           -- رقم الشيك أو الحوالة
  cheque_due_date date,
  notes          text,

  is_legacy      boolean not null default false,
  legacy_ref     text,

  received_by    uuid references profiles(id),
  created_at     timestamptz not null default now(),

  voided_at      timestamptz,
  void_reason    text,
  voided_by      uuid references profiles(id),

  constraint payments_party_chk
    check ((customer_id is not null) <> (supplier_id is not null)),
  constraint payments_direction_chk
    check ((direction = 'in'  and customer_id is not null)
        or (direction = 'out' and supplier_id is not null)),
  constraint payments_cheque_chk
    check (method <> 'cheque' or reference_no is not null),
  constraint payments_void_chk
    check (voided_at is null or void_reason is not null)
);

alter sequence receipt_seq owned by payments.seq;
create unique index payments_receipt_uq on payments(receipt_no);
create index payments_customer_idx on payments(customer_id, payment_date desc);
create index payments_supplier_idx on payments(supplier_id, payment_date desc);
create index payments_date_idx     on payments(payment_date);
create index payments_cheque_idx   on payments(cheque_due_date)
  where method = 'cheque' and voided_at is null;

-- منع التعديل على الحقول المالية ومنع الحذف نهائيًا
create or replace function payments_immutable()
returns trigger
language plpgsql
as $$
begin
  if old.amount       is distinct from new.amount
  or old.currency     is distinct from new.currency
  or old.fx_rate      is distinct from new.fx_rate
  or old.direction    is distinct from new.direction
  or old.customer_id  is distinct from new.customer_id
  or old.supplier_id  is distinct from new.supplier_id
  or old.payment_date is distinct from new.payment_date
  or (old.voided_at is not null and new.voided_at is null) then
    raise exception 'لا يجوز تعديل دفعة مسجّلة (%). ألغِها بتعبئة voided_at ثم سجّل دفعة صحيحة.', old.receipt_no
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_payments_immutable before update on payments
  for each row execute function payments_immutable();

create or replace function forbid_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'الحذف ممنوع على جدول % — السجلات المالية تُلغى ولا تُحذف.', tg_table_name
    using errcode = 'check_violation';
end;
$$;

create trigger trg_payments_no_delete before delete on payments
  for each row execute function forbid_delete();

-- ---------------------------------------------------------------------
-- 7. توزيع الدفعة على الفواتير والأقساط
-- ---------------------------------------------------------------------
create table payment_allocations (
  id             uuid primary key default gen_random_uuid(),
  payment_id     uuid not null references payments(id) on delete cascade,
  order_id       uuid not null references orders(id) on delete restrict,
  installment_id uuid references installments(id) on delete restrict,
  amount_usd     numeric(14,2) not null check (amount_usd > 0),
  created_at     timestamptz not null default now()
);

create index alloc_payment_idx     on payment_allocations(payment_id);
create index alloc_order_idx       on payment_allocations(order_id);
create index alloc_installment_idx on payment_allocations(installment_id);

create or replace function allocation_guard()
returns trigger
language plpgsql
as $$
declare
  p            payments%rowtype;
  total_alloc  numeric(14,2);
  ord_customer uuid;
  inst_order   uuid;
begin
  select * into p from payments where id = new.payment_id for update;

  if p.direction <> 'in' then
    raise exception 'التوزيع مسموح فقط للدفعات المقبوضة من الزبائن'
      using errcode = 'check_violation';
  end if;

  select customer_id into ord_customer from orders where id = new.order_id;
  if ord_customer <> p.customer_id then
    raise exception 'الفاتورة تعود لزبون آخر غير صاحب الدفعة'
      using errcode = 'check_violation';
  end if;

  if new.installment_id is not null then
    select order_id into inst_order from installments where id = new.installment_id;
    if inst_order <> new.order_id then
      raise exception 'القسط لا يعود لهذه الفاتورة'
        using errcode = 'check_violation';
    end if;
  end if;

  select coalesce(sum(amount_usd), 0) into total_alloc
    from payment_allocations
   where payment_id = new.payment_id
     and id <> new.id;

  if total_alloc + new.amount_usd > p.amount_usd + 0.01 then
    raise exception 'مجموع التوزيعات (%) يتجاوز قيمة الدفعة (%)',
      total_alloc + new.amount_usd, p.amount_usd
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger trg_allocation_guard
  before insert or update on payment_allocations
  for each row execute function allocation_guard();


-- #####################################################################
-- الجزء 3 — المخزون والتقارير
-- #####################################################################

-- ---------------------------------------------------------------------
-- 1. دفتر حركات المخزون (append-only)
-- ---------------------------------------------------------------------
create table inventory_movements (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references products(id) on delete restrict,
  product_unit_id uuid references product_units(id) on delete restrict,
  movement_type   movement_type not null,
  quantity        numeric(12,3) not null check (quantity <> 0),
  reference_type  text,      -- 'order_item' | 'purchase_item' | 'count' | ...
  reference_id    uuid,
  reason          text,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now()
);

create index inv_mov_product_idx on inventory_movements(product_id, created_at);
create index inv_mov_ref_idx     on inventory_movements(reference_type, reference_id);
create index inv_mov_unit_idx    on inventory_movements(product_unit_id);

create trigger trg_inv_mov_no_delete before delete on inventory_movements
  for each row execute function forbid_delete();

-- تسجيل تلقائي لحركة البيع
create or replace function log_sale_movement()
returns trigger
language plpgsql
as $$
begin
  insert into inventory_movements
    (product_id, product_unit_id, movement_type, quantity, reference_type, reference_id, reason)
  values
    (new.product_id, new.product_unit_id, 'sale_out', -new.quantity, 'order_item', new.id, 'بيع ضمن فاتورة');
  return new;
end;
$$;

create trigger trg_log_sale_movement after insert on order_items
  for each row execute function log_sale_movement();

-- تسجيل تلقائي لحركة الشراء
create or replace function log_purchase_movement()
returns trigger
language plpgsql
as $$
begin
  insert into inventory_movements
    (product_id, movement_type, quantity, reference_type, reference_id, reason)
  values
    (new.product_id, 'purchase_in', new.quantity, 'purchase_item', new.id, 'استلام من مورد');
  return new;
end;
$$;

create trigger trg_log_purchase_movement after insert on purchase_items
  for each row execute function log_purchase_movement();

-- إصلاح: إعادة البضاعة للمخزون عند إلغاء/إرجاع الفاتورة
-- (الإلغاء تحديث ناعم لا يحذف order_items، لذلك فرع DELETE في الحارس لا يعمل)
create or replace function restock_on_order_close()
returns trigger
language plpgsql
as $$
declare
  it              order_items%rowtype;
  new_unit_status unit_status;
  mv_reason       text;
begin
  if new.status in ('cancelled','returned')
     and old.status is distinct from new.status
     and old.status not in ('cancelled','returned') then

    if new.status = 'cancelled' then
      new_unit_status := 'in_stock';
      mv_reason := 'إلغاء فاتورة — إرجاع للمخزون';
    else
      new_unit_status := 'returned';
      mv_reason := 'إرجاع فاتورة — إرجاع للمخزون';
    end if;

    for it in select * from order_items where order_id = new.id loop
      insert into inventory_movements
        (product_id, product_unit_id, movement_type, quantity,
         reference_type, reference_id, reason)
      values
        (it.product_id, it.product_unit_id, 'customer_return', it.quantity,
         'order_item', it.id, mv_reason);

      if it.product_unit_id is not null then
        update product_units
           set status = new_unit_status
         where id = it.product_unit_id
           and status in ('sold','delivered','reserved');
      end if;
    end loop;
  end if;

  return new;
end;
$$;

create trigger trg_restock_on_order_close
  after update of status on orders
  for each row execute function restock_on_order_close();

-- ---------------------------------------------------------------------
-- 2. مجاميع الفاتورة
-- ---------------------------------------------------------------------
create view v_order_totals with (security_invoker = on) as
with base as (
  select
    o.id            as order_id,
    o.code,
    o.customer_id,
    o.order_date,
    o.status,
    o.plan,
    o.currency,
    o.fx_rate,
    o.is_legacy,
    coalesce(i.subtotal, 0)                                          as subtotal,
    coalesce(i.subtotal, 0) - o.discount_amount + o.delivery_fee     as total,
    coalesce(p.paid_usd, 0)                                          as paid_usd
  from orders o
  left join (
    select order_id, sum(line_total) as subtotal
      from order_items group by order_id
  ) i on i.order_id = o.id
  left join (
    select a.order_id, sum(a.amount_usd) as paid_usd
      from payment_allocations a
      join payments pm on pm.id = a.payment_id
     where pm.voided_at is null
     group by a.order_id
  ) p on p.order_id = o.id
)
select
  b.*,
  round(b.total / b.fx_rate, 2)                  as total_usd,
  round(b.total / b.fx_rate, 2) - b.paid_usd     as remaining_usd
from base b;

-- ---------------------------------------------------------------------
-- 3. رصيد الزبون  (الشاشة الأهم في النظام)
-- ---------------------------------------------------------------------
create view v_customer_balances with (security_invoker = on) as
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

-- ---------------------------------------------------------------------
-- 4. حالة الأقساط — محسوبة، لا مخزَّنة
-- ---------------------------------------------------------------------
create view v_installment_status with (security_invoker = on) as
select
  i.id          as installment_id,
  i.order_id,
  o.customer_id,
  i.number,
  i.due_date,
  i.amount_usd,
  coalesce(a.paid, 0)                as paid_usd,
  i.amount_usd - coalesce(a.paid, 0) as remaining_usd,
  case
    when i.cancelled_at is not null                    then 'cancelled'
    when coalesce(a.paid, 0) >= i.amount_usd - 0.01    then 'paid'
    when i.due_date < current_date                     then 'overdue'
    when coalesce(a.paid, 0) > 0                       then 'partial'
    else 'pending'
  end as status,
  case
    when i.cancelled_at is null
     and coalesce(a.paid, 0) < i.amount_usd - 0.01
      then greatest(0, current_date - i.due_date)
    else 0
  end as days_late
from installments i
join orders o on o.id = i.order_id
left join (
  select a.installment_id, sum(a.amount_usd) as paid
    from payment_allocations a
    join payments p on p.id = a.payment_id
   where p.voided_at is null and a.installment_id is not null
   group by a.installment_id
) a on a.installment_id = i.id;

create view v_overdue_installments with (security_invoker = on) as
select
  s.*,
  c.full_name,
  c.phone,
  c.area,
  o.code as order_code
from v_installment_status s
join customers c on c.id = s.customer_id
join orders    o on o.id = s.order_id
where s.status = 'overdue'
order by s.days_late desc;

-- ---------------------------------------------------------------------
-- 5. أعمار الديون (0-30 / 31-60 / 61-90 / +90)
-- ---------------------------------------------------------------------
create view v_debt_aging with (security_invoker = on) as
select
  customer_id,
  full_name,
  phone,
  coalesce(sum(remaining_usd) filter (where days_late between  0 and 30), 0) as bucket_0_30,
  coalesce(sum(remaining_usd) filter (where days_late between 31 and 60), 0) as bucket_31_60,
  coalesce(sum(remaining_usd) filter (where days_late between 61 and 90), 0) as bucket_61_90,
  coalesce(sum(remaining_usd) filter (where days_late > 90), 0)              as bucket_90_plus,
  sum(remaining_usd)                                            as total_overdue
from v_overdue_installments
group by customer_id, full_name, phone;

-- ---------------------------------------------------------------------
-- 6. المخزون
-- ---------------------------------------------------------------------
create view v_stock_levels with (security_invoker = on) as
select
  p.id            as product_id,
  p.code,
  p.category_id,
  p.brand,
  p.model,
  p.is_serialized,
  case when p.is_serialized then coalesce(u.in_stock, 0)
       else coalesce(m.qty, 0) end          as available_qty,
  coalesce(u.reserved, 0)                   as reserved_qty,
  p.reorder_level,
  (case when p.is_serialized then coalesce(u.in_stock, 0)
        else coalesce(m.qty, 0) end) <= p.reorder_level as needs_reorder,
  p.sale_price
from products p
left join (
  select product_id,
         count(*) filter (where status = 'in_stock') as in_stock,
         count(*) filter (where status = 'reserved') as reserved
    from product_units group by product_id
) u on u.product_id = p.id
left join (
  select product_id, sum(quantity) as qty
    from inventory_movements group by product_id
) m on m.product_id = p.id
where p.is_active;

-- المنتجات الراكدة: لم تُبع منذ 180 يومًا
create view v_stagnant_products with (security_invoker = on) as
select
  p.id as product_id, p.code, p.brand, p.model,
  s.available_qty,
  x.last_sold_at
from products p
join v_stock_levels s on s.product_id = p.id
left join (
  select oi.product_id, max(o.order_date) as last_sold_at
    from order_items oi
    join orders o on o.id = oi.order_id
   where o.status not in ('draft','cancelled')
   group by oi.product_id
) x on x.product_id = p.id
where s.available_qty > 0
  and (x.last_sold_at is null or x.last_sold_at < now() - interval '180 days');

-- ---------------------------------------------------------------------
-- 7. الموردون
-- ---------------------------------------------------------------------
create view v_supplier_balances with (security_invoker = on) as
select
  s.id as supplier_id,
  s.code,
  s.name,
  coalesce(pu.total_usd, 0)                          as purchases_usd,
  coalesce(pay.paid_usd, 0)                          as paid_usd,
  coalesce(pu.total_usd, 0) - coalesce(pay.paid_usd, 0) as balance_usd
from suppliers s
left join (
  select p.supplier_id, sum(round(pi.line_total / p.fx_rate, 2)) as total_usd
    from purchases p
    join purchase_items pi on pi.purchase_id = p.id
   where p.cancelled_at is null
   group by p.supplier_id
) pu on pu.supplier_id = s.id
left join (
  select supplier_id, sum(amount_usd) as paid_usd
    from payments
   where direction = 'out' and voided_at is null
   group by supplier_id
) pay on pay.supplier_id = s.id;

-- ---------------------------------------------------------------------
-- 8. جودة البيانات — ملفات مكررة محتملة
-- ---------------------------------------------------------------------
create view v_duplicate_customers with (security_invoker = on) as
select
  phone,
  count(*)             as matches,
  array_agg(code order by seq)      as codes,
  array_agg(full_name order by seq) as names,
  array_agg(id order by seq)        as ids
from customers
where phone is not null
group by phone
having count(*) > 1;

-- ---------------------------------------------------------------------
-- 9. لوحة التحكم — مؤشرات اليوم
-- ---------------------------------------------------------------------
create view v_dashboard_today with (security_invoker = on) as
select
  (select coalesce(sum(total_usd), 0) from v_order_totals
     where order_date::date = current_date and status not in ('draft','cancelled'))  as sales_today_usd,
  (select coalesce(sum(amount_usd), 0) from payments
     where payment_date::date = current_date and direction = 'in' and voided_at is null) as collected_today_usd,
  (select count(*) from orders
     where order_date::date = current_date and status not in ('draft','cancelled'))  as orders_today,
  (select count(*) from customers where created_at::date = current_date)             as new_customers_today,
  (select count(*) from v_installment_status where due_date = current_date
     and status in ('pending','partial'))                                            as installments_due_today,
  (select count(*) from v_installment_status where status = 'overdue')               as installments_overdue,
  (select count(*) from v_stock_levels where needs_reorder)                          as products_low_stock,
  (select count(*) from deliveries where status in ('pending','scheduled'))          as deliveries_pending,
  (select coalesce(sum(amount_usd), 0) from payments
     where method = 'cheque' and voided_at is null
       and cheque_due_date between current_date and current_date + 7)                as cheques_due_week_usd;

-- ---------------------------------------------------------------------
-- 10. الأرباح — يراها المدير/المحاسب فقط (حارس دور + security_invoker)
-- ---------------------------------------------------------------------
create view v_profit_by_order with (security_invoker = on) as
select
  t.order_id,
  t.code,
  t.order_date,
  t.total_usd,
  coalesce(cost.cost_usd, 0)                as cost_usd,
  t.total_usd - coalesce(cost.cost_usd, 0)  as gross_profit_usd
from v_order_totals t
left join (
  select oi.order_id,
         sum(round(coalesce(uc.cost_usd, pc.purchase_price_usd, 0) * oi.quantity, 2)) as cost_usd
    from order_items oi
    left join unit_costs    uc on uc.product_unit_id = oi.product_unit_id
    left join product_costs pc on pc.product_id      = oi.product_id
   group by oi.order_id
) cost on cost.order_id = t.order_id
where t.status not in ('draft','cancelled')
  and auth_role() in ('owner','accountant');   -- غير المخوّل: صفر صفوف


-- #####################################################################
-- الجزء 4 — سجل التدقيق والصلاحيات
-- #####################################################################

-- ---------------------------------------------------------------------
-- 1. سجل التدقيق
-- ---------------------------------------------------------------------
create table audit_log (
  id          bigint generated always as identity primary key,
  user_id     uuid,
  action      text not null,
  entity_type text not null,
  entity_id   uuid,
  old_value   jsonb,
  new_value   jsonb,
  created_at  timestamptz not null default now()
);

create index audit_entity_idx on audit_log(entity_type, entity_id, created_at desc);
create index audit_user_idx   on audit_log(user_id, created_at desc);

create or replace function audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  eid uuid;
begin
  if tg_op = 'DELETE' then
    eid := (to_jsonb(old) ->> 'id')::uuid;
    insert into audit_log(user_id, action, entity_type, entity_id, old_value, new_value)
    values (auth.uid(), tg_op, tg_table_name, eid, to_jsonb(old), null);
    return old;
  elsif tg_op = 'UPDATE' then
    eid := (to_jsonb(new) ->> 'id')::uuid;
    insert into audit_log(user_id, action, entity_type, entity_id, old_value, new_value)
    values (auth.uid(), tg_op, tg_table_name, eid, to_jsonb(old), to_jsonb(new));
    return new;
  else
    eid := (to_jsonb(new) ->> 'id')::uuid;
    insert into audit_log(user_id, action, entity_type, entity_id, old_value, new_value)
    values (auth.uid(), tg_op, tg_table_name, eid, null, to_jsonb(new));
    return new;
  end if;
end;
$$;

create trigger trg_audit_customers   after insert or update or delete on customers
  for each row execute function audit_trigger();
create trigger trg_audit_orders      after insert or update or delete on orders
  for each row execute function audit_trigger();
create trigger trg_audit_order_items after insert or update or delete on order_items
  for each row execute function audit_trigger();
create trigger trg_audit_payments    after insert or update or delete on payments
  for each row execute function audit_trigger();
create trigger trg_audit_alloc       after insert or update or delete on payment_allocations
  for each row execute function audit_trigger();
create trigger trg_audit_products    after insert or update or delete on products
  for each row execute function audit_trigger();
create trigger trg_audit_units       after insert or update or delete on product_units
  for each row execute function audit_trigger();
create trigger trg_audit_installments after insert or update or delete on installments
  for each row execute function audit_trigger();
create trigger trg_audit_purchases   after insert or update or delete on purchases
  for each row execute function audit_trigger();
create trigger trg_audit_costs       after insert or update or delete on product_costs
  for each row execute function audit_trigger();

-- ---------------------------------------------------------------------
-- 2. الدوال التي تعمل نيابة عن المستخدم
--    تكتب في جداول لا يملك موظف المبيعات صلاحية عليها، لذا بصلاحية المالك.
-- ---------------------------------------------------------------------
alter function order_item_unit_guard()   security definer set search_path = public;
alter function log_sale_movement()       security definer set search_path = public;
alter function log_purchase_movement()   security definer set search_path = public;
alter function restock_on_order_close()  security definer set search_path = public;

-- ---------------------------------------------------------------------
-- 3. تفعيل RLS
-- ---------------------------------------------------------------------
alter table profiles            enable row level security;
alter table customers           enable row level security;
alter table suppliers           enable row level security;
alter table categories          enable row level security;
alter table products            enable row level security;
alter table product_costs       enable row level security;
alter table product_units       enable row level security;
alter table unit_costs          enable row level security;
alter table purchases           enable row level security;
alter table purchase_items      enable row level security;
alter table orders              enable row level security;
alter table order_items         enable row level security;
alter table deliveries          enable row level security;
alter table installments        enable row level security;
alter table payments            enable row level security;
alter table payment_allocations enable row level security;
alter table inventory_movements enable row level security;
alter table audit_log           enable row level security;

-- ---------------------------------------------------------------------
-- 4. الصلاحيات الأساسية (RLS يفلتر بعدها)
-- ---------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on all tables in schema public from anon;

-- الحذف ممنوع على الجميع — النظام يعمل بالإلغاء لا بالحذف
revoke delete on all tables in schema public from authenticated;

-- ---------------------------------------------------------------------
-- 5. السياسات
-- ---------------------------------------------------------------------

-- الملفات الشخصية
create policy profiles_select on profiles for select to authenticated
  using (id = auth.uid() or is_owner());
create policy profiles_manage on profiles for insert to authenticated
  with check (is_owner());
create policy profiles_update on profiles for update to authenticated
  using (is_owner()) with check (is_owner());

-- الزبائن
create policy customers_select on customers for select to authenticated
  using (auth_role() is not null);
create policy customers_insert on customers for insert to authenticated
  with check (auth_role() in ('owner','sales','accountant'));
create policy customers_update on customers for update to authenticated
  using (auth_role() in ('owner','sales','accountant'))
  with check (auth_role() in ('owner','sales','accountant'));

-- الفئات والمنتجات
create policy categories_select on categories for select to authenticated
  using (auth_role() is not null);
create policy categories_write on categories for insert to authenticated
  with check (auth_role() in ('owner','stock'));
create policy categories_update on categories for update to authenticated
  using (auth_role() in ('owner','stock')) with check (auth_role() in ('owner','stock'));

create policy products_select on products for select to authenticated
  using (auth_role() is not null);
create policy products_insert on products for insert to authenticated
  with check (auth_role() in ('owner','stock'));
create policy products_update on products for update to authenticated
  using (auth_role() in ('owner','stock')) with check (auth_role() in ('owner','stock'));

-- أسعار الشراء: المدير والمحاسب فقط
create policy costs_select on product_costs for select to authenticated
  using (auth_role() in ('owner','accountant'));
create policy costs_write on product_costs for insert to authenticated
  with check (auth_role() in ('owner','accountant'));
create policy costs_update on product_costs for update to authenticated
  using (is_owner()) with check (is_owner());

create policy unit_costs_select on unit_costs for select to authenticated
  using (auth_role() in ('owner','accountant'));
create policy unit_costs_write on unit_costs for insert to authenticated
  with check (auth_role() in ('owner','accountant'));

-- القطع
create policy units_select on product_units for select to authenticated
  using (auth_role() is not null);
create policy units_insert on product_units for insert to authenticated
  with check (auth_role() in ('owner','stock'));
create policy units_update on product_units for update to authenticated
  using (auth_role() in ('owner','stock')) with check (auth_role() in ('owner','stock'));

-- الموردون والمشتريات: لا يراها موظف المبيعات
create policy suppliers_select on suppliers for select to authenticated
  using (auth_role() in ('owner','accountant','stock'));
create policy suppliers_write on suppliers for insert to authenticated
  with check (auth_role() in ('owner','stock'));
create policy suppliers_update on suppliers for update to authenticated
  using (auth_role() in ('owner','stock')) with check (auth_role() in ('owner','stock'));

create policy purchases_select on purchases for select to authenticated
  using (auth_role() in ('owner','accountant','stock'));
create policy purchases_write on purchases for insert to authenticated
  with check (auth_role() in ('owner','stock'));
create policy purchases_update on purchases for update to authenticated
  using (auth_role() in ('owner','stock')) with check (auth_role() in ('owner','stock'));

create policy purchase_items_select on purchase_items for select to authenticated
  using (auth_role() in ('owner','accountant','stock'));
create policy purchase_items_write on purchase_items for insert to authenticated
  with check (auth_role() in ('owner','stock'));

-- الفواتير
create policy orders_select on orders for select to authenticated
  using (auth_role() is not null);
create policy orders_insert on orders for insert to authenticated
  with check (auth_role() in ('owner','sales'));
create policy orders_update on orders for update to authenticated
  using (auth_role() in ('owner','sales'))
  with check (
    auth_role() in ('owner','sales')
    -- الإلغاء صلاحية المدير وحده
    and (cancelled_at is null or is_owner())
  );

create policy order_items_select on order_items for select to authenticated
  using (auth_role() is not null);
create policy order_items_insert on order_items for insert to authenticated
  with check (auth_role() in ('owner','sales'));
create policy order_items_update on order_items for update to authenticated
  using (auth_role() in ('owner','sales')) with check (auth_role() in ('owner','sales'));

-- التوصيل
create policy deliveries_select on deliveries for select to authenticated
  using (auth_role() is not null);
create policy deliveries_write on deliveries for insert to authenticated
  with check (auth_role() in ('owner','sales','stock'));
create policy deliveries_update on deliveries for update to authenticated
  using (auth_role() in ('owner','sales','stock'))
  with check (auth_role() in ('owner','sales','stock'));

-- الأقساط
create policy installments_select on installments for select to authenticated
  using (auth_role() is not null);
create policy installments_insert on installments for insert to authenticated
  with check (auth_role() in ('owner','sales','accountant'));
create policy installments_update on installments for update to authenticated
  using (auth_role() in ('owner','sales','accountant'))
  with check (auth_role() in ('owner','sales','accountant'));

-- الدفعات: كل دور يرى ما يخصّه (قبض من الزبائن للمبيعات، دفع للموردين للمخزون)
create policy payments_select on payments for select to authenticated
  using (
    auth_role() in ('owner','accountant')
    or (auth_role() = 'sales' and direction = 'in')
    or (auth_role() = 'stock' and direction = 'out')
  );
create policy payments_insert on payments for insert to authenticated
  with check (
    (direction = 'in'  and auth_role() in ('owner','accountant','sales'))
    or (direction = 'out' and auth_role() in ('owner','stock'))
  );
-- التعديل للإلغاء (voided_at) فقط — المدير والمحاسب. الحقول المالية محميّة بالـ trigger.
create policy payments_update on payments for update to authenticated
  using (auth_role() in ('owner','accountant'))
  with check (auth_role() in ('owner','accountant'));

-- توزيع الدفعات
create policy alloc_select on payment_allocations for select to authenticated
  using (auth_role() in ('owner','accountant','sales'));
create policy alloc_insert on payment_allocations for insert to authenticated
  with check (auth_role() in ('owner','accountant','sales'));

-- دفتر الحركات: الجميع يقرأ (لا يحوي كلفة)، والإدخال اليدوي للمخزون/المدير.
-- ملاحظة: حركات البيع/الشراء تُدرَج عبر triggers بصلاحية المالك (security definer).
create policy inv_mov_select on inventory_movements for select to authenticated
  using (auth_role() is not null);
create policy inv_mov_insert on inventory_movements for insert to authenticated
  with check (auth_role() in ('owner','stock'));

-- سجل التدقيق: المدير فقط يقرأ
create policy audit_select on audit_log for select to authenticated
  using (is_owner());


-- #####################################################################
-- الجزء 5 — دوال العمليات (RPC) الآمنة
--   تُنفَّذ كوحدة واحدة (معاملة) لتفادي الفواتير نصف المكتملة.
--   security definer + فحص الدور في الأعلى.
-- #####################################################################

-- ---------------------------------------------------------------------
-- 1. قبض دفعة من زبون وتوزيعها على أقدم الأقساط استحقاقًا
--    (الفائض بعد كل الأقساط يُنسب إلى الفاتورة كرصيد دائن)
-- ---------------------------------------------------------------------
create or replace function record_customer_payment(
  p_customer_id   uuid,
  p_order_id      uuid,
  p_amount        numeric,
  p_currency      currency_code default 'USD',
  p_fx            numeric default 1,
  p_method        payment_method default 'cash',
  p_reference     text default null,
  p_cheque_due    date default null,
  p_notes         text default null
)
returns payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment   payments%rowtype;
  v_remaining numeric(14,2);
  v_alloc     numeric(14,2);
  inst        record;
begin
  if auth_role() not in ('owner','accountant','sales') then
    raise exception 'لا تملك صلاحية تسجيل دفعة' using errcode = 'insufficient_privilege';
  end if;

  if (select customer_id from orders where id = p_order_id) is distinct from p_customer_id then
    raise exception 'الفاتورة لا تعود لهذا الزبون' using errcode = 'check_violation';
  end if;

  insert into payments
    (direction, customer_id, amount, currency, fx_rate, method,
     reference_no, cheque_due_date, notes, received_by)
  values
    ('in', p_customer_id, p_amount, p_currency, p_fx, p_method,
     p_reference, p_cheque_due, p_notes, auth.uid())
  returning * into v_payment;

  v_remaining := v_payment.amount_usd;

  -- توزيع على الأقساط: الأقدم استحقاقًا أولًا
  for inst in
    select i.id,
           (i.amount_usd - coalesce(x.paid, 0)) as due
      from installments i
      left join (
        select a.installment_id, sum(a.amount_usd) as paid
          from payment_allocations a
          join payments p on p.id = a.payment_id
         where p.voided_at is null and a.installment_id is not null
         group by a.installment_id
      ) x on x.installment_id = i.id
     where i.order_id = p_order_id
       and i.cancelled_at is null
       and (i.amount_usd - coalesce(x.paid, 0)) > 0.005
     order by i.due_date, i.number
  loop
    exit when v_remaining <= 0.005;
    v_alloc := least(v_remaining, inst.due);
    insert into payment_allocations(payment_id, order_id, installment_id, amount_usd)
      values (v_payment.id, p_order_id, inst.id, v_alloc);
    v_remaining := round(v_remaining - v_alloc, 2);
  end loop;

  -- الفائض يُنسب إلى الفاتورة مباشرة (دفعة أولى / دفعة نقدية / رصيد دائن)
  if v_remaining > 0.005 then
    insert into payment_allocations(payment_id, order_id, installment_id, amount_usd)
      values (v_payment.id, p_order_id, null, v_remaining);
  end if;

  return v_payment;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. إنشاء فاتورة بيع كاملة (بنود + دفعة أولى + جدول أقساط) في معاملة واحدة
--    p_items: jsonb مصفوفة من:
--      { product_id, product_unit_id, quantity, unit_price, discount, price_override_by }
--    كل الحسابات المالية تتم في الخادم (لا حساب في الواجهة).
-- ---------------------------------------------------------------------
create or replace function create_sale(
  p_customer_id        uuid,
  p_items              jsonb,
  p_currency           currency_code default 'USD',
  p_fx                 numeric default 1,
  p_discount           numeric default 0,
  p_discount_reason    text default null,
  p_delivery_fee       numeric default 0,
  p_plan               payment_plan default 'cash',
  p_down_payment       numeric default 0,
  p_installment_count  int default 0,
  p_first_due          date default null,
  p_interval_months    int default 1,
  p_notes              text default null
)
returns orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order       orders%rowtype;
  v_item        jsonb;
  v_subtotal    numeric(14,2);
  v_total       numeric(14,2);
  v_total_usd   numeric(14,2);
  v_down_usd    numeric(14,2);
  v_financed    numeric(14,2);
  v_base        numeric(14,2);
  v_last        numeric(14,2);
  v_amt         numeric(14,2);
  v_pay_id      uuid;
  i             int;
begin
  if auth_role() not in ('owner','sales') then
    raise exception 'لا تملك صلاحية إنشاء فاتورة' using errcode = 'insufficient_privilege';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'الفاتورة بلا بنود' using errcode = 'check_violation';
  end if;

  insert into orders
    (customer_id, currency, fx_rate, discount_amount, discount_reason,
     delivery_fee, plan, status, notes, created_by)
  values
    (p_customer_id, p_currency, p_fx, coalesce(p_discount,0), p_discount_reason,
     coalesce(p_delivery_fee,0), p_plan, 'confirmed', p_notes, auth.uid())
  returning * into v_order;

  -- البنود (تُشغّل حارس القطع + حركة المخزون)
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into order_items
      (order_id, product_id, product_unit_id, quantity, unit_price, discount, price_override_by)
    values
      (v_order.id,
       (v_item->>'product_id')::uuid,
       nullif(v_item->>'product_unit_id','')::uuid,
       coalesce((v_item->>'quantity')::numeric, 1),
       (v_item->>'unit_price')::numeric,
       coalesce((v_item->>'discount')::numeric, 0),
       nullif(v_item->>'price_override_by','')::uuid);
  end loop;

  -- المجاميع (بعملة الفاتورة ثم تحويلها إلى الدولار)
  select coalesce(sum(line_total), 0) into v_subtotal
    from order_items where order_id = v_order.id;
  v_total     := v_subtotal - coalesce(p_discount,0) + coalesce(p_delivery_fee,0);
  v_total_usd := round(v_total / p_fx, 2);
  v_down_usd  := round(coalesce(p_down_payment,0) / p_fx, 2);

  -- الدفعة الأولى تُنسب إلى الفاتورة مباشرة (ليست ضمن جدول الأقساط)
  if coalesce(p_down_payment,0) > 0 then
    insert into payments
      (direction, customer_id, amount, currency, fx_rate, method, notes, received_by)
    values
      ('in', p_customer_id, p_down_payment, p_currency, p_fx, 'cash',
       'دفعة أولى — فاتورة ' || v_order.code, auth.uid())
    returning id into v_pay_id;

    insert into payment_allocations(payment_id, order_id, installment_id, amount_usd)
      values (v_pay_id, v_order.id, null, v_down_usd);
  end if;

  -- جدول الأقساط للمبلغ المتبقي (بالدولار)، آخر قسط يمتص فرق التقريب
  if p_plan in ('installments','mixed') and coalesce(p_installment_count,0) > 0 then
    v_financed := round(v_total_usd - v_down_usd, 2);
    if v_financed > 0.005 then
      v_base := round(v_financed / p_installment_count, 2);
      v_last := round(v_financed - v_base * (p_installment_count - 1), 2);
      for i in 1 .. p_installment_count loop
        if i < p_installment_count then v_amt := v_base; else v_amt := v_last; end if;
        if v_amt > 0 then
          insert into installments(order_id, number, due_date, amount_usd)
          values (
            v_order.id, i,
            coalesce(p_first_due, current_date) + ((i - 1) * p_interval_months) * interval '1 month',
            v_amt
          );
        end if;
      end loop;
    end if;
  end if;

  return v_order;
end;
$$;

grant execute on function record_customer_payment(uuid,uuid,numeric,currency_code,numeric,payment_method,text,date,text) to authenticated;
grant execute on function create_sale(uuid,jsonb,currency_code,numeric,numeric,text,numeric,payment_plan,numeric,int,date,int,text) to authenticated;

-- =====================================================================
-- نهاية المخطط
-- =====================================================================
