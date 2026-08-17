-- =====================================================================
-- بيانات تجريبية للاختبار — شغّلها بعد schema.sql
-- (اختياري) تُنفَّذ من SQL Editor بصلاحية الخدمة فتتجاوز RLS.
-- لا تُنشئ مستخدمين هنا — المستخدم الأول يُنشأ من Authentication (اقرأ README).
-- =====================================================================

-- الفئات
insert into categories (name, sort_order) values
  ('براد', 1),
  ('غسالة', 2),
  ('تلفزيون', 3),
  ('مكيّف', 4),
  ('إكسسوارات', 9)
on conflict (name) do nothing;

-- منتجات مسلسلة (كل قطعة برقم تسلسلي) + منتج بالكمية
with cat as (
  select
    (select id from categories where name = 'براد')       as fridge,
    (select id from categories where name = 'غسالة')      as washer,
    (select id from categories where name = 'تلفزيون')    as tv,
    (select id from categories where name = 'إكسسوارات')  as acc
)
insert into products (category_id, brand, model, description, is_serialized, sale_price, min_price, warranty_months, reorder_level)
select fridge, 'Samsung', 'RT42',  'براد 420 لتر، فضي', true, 700, 650, 12, 1 from cat
union all select washer, 'LG',     'F4',    'غسالة 8 كغ',       true, 520, 470, 12, 1 from cat
union all select tv,     'Sony',   'X80K',  'تلفزيون 55 بوصة',  true, 640, 600, 24, 1 from cat
union all select acc,    'Generic','CABLE', 'كابل كهرباء 3م',   false, 8,  6,  0, 20 from cat;

-- أسعار الشراء (يراها المدير/المحاسب فقط)
insert into product_costs (product_id, purchase_price_usd)
select id,
       case when model = 'RT42' then 560
            else round(coalesce(sale_price, 0) * 0.8, 2) end
from products
on conflict (product_id) do nothing;

-- قطع مسلسلة في المخزون
insert into product_units (product_id, serial_number, condition, status, location, received_at)
select p.id, s.serial, 'new', 'in_stock', 'المستودع 1 - رف A', current_date
from products p
join (values
  ('RT42', 'SN-RT42-0001'),
  ('RT42', 'SN-RT42-0002'),
  ('F4',   'SN-F4-1001'),
  ('F4',   'SN-F4-1002'),
  ('X80K', 'SN-X80K-777')
) as s(model, serial) on s.model = p.model;

-- رصيد للمنتج بالكمية عبر حركة إدخال (الكابل)
insert into inventory_movements (product_id, movement_type, quantity, reference_type, reason)
select id, 'count_adjust', 50, 'seed', 'رصيد افتتاحي تجريبي'
from products where model = 'CABLE';

-- زبون تجريبي
insert into customers (full_name, phone_raw, area, address)
values ('محمد أحمد', '03 456 789', 'صيدا', 'شارع رياض الصلح')
on conflict do nothing;
