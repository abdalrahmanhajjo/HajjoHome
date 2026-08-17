# نظام إدارة محل الأدوات والأجهزة الكهربائية

نظام داخلي لإدارة الزبائن والفواتير والأقساط والمخزون. الواجهة عربية (RTL)،
وقاعدة البيانات على Supabase (PostgreSQL). المصدر الوحيد لنموذج البيانات هو
[`db/schema.sql`](db/schema.sql).

## التقنيات
- **قاعدة البيانات:** PostgreSQL عبر Supabase
- **الصلاحيات:** Row Level Security + دور المستخدم في `profiles.role`
- **الواجهة:** React + TypeScript + Vite + react-router-dom
- **التنسيق:** CSS مع رموز تصميمية في `src/styles/tokens.css` (لا لون مباشر في المكوّنات)

## الإعداد خطوة بخطوة

### 1. أنشئ مشروع Supabase
من [supabase.com](https://supabase.com) أنشئ مشروعًا جديدًا.

### 2. طبّق المخطط
Dashboard → **SQL Editor** → الصق كامل [`db/schema.sql`](db/schema.sql) → **Run**.
(اختياري) الصق [`db/seed.sql`](db/seed.sql) وشغّله لإضافة بيانات تجريبية.

### 3. أنشئ المستخدم الأول (المدير)
`profiles` مرتبط بـ `auth.users`، لذا أنشئ المستخدم من نظام المصادقة أولًا:

1. Dashboard → **Authentication → Users → Add user** — أدخل بريدًا وكلمة مرور.
2. انسخ `User UID` الظاهر للمستخدم.
3. في **SQL Editor** شغّل (مع استبدال المعرّف والاسم):

```sql
insert into profiles (id, full_name, role)
values ('ألصق-USER-UID-هنا', 'اسم المدير', 'owner');
```

الأدوار المتاحة: `owner` (المدير)، `sales` (مبيعات)، `accountant` (محاسب)، `stock` (مخزون).

### 4. اربط الواجهة بالمشروع
```bash
cp .env.example .env
```
ثم املأ `.env` من Dashboard → **Project Settings → API**:
- `VITE_SUPABASE_URL` = Project URL
- `VITE_SUPABASE_ANON_KEY` = anon public key

### 5. شغّل الواجهة
```bash
npm install
npm run dev
```
افتح الرابط الظاهر (عادة http://localhost:5173) وسجّل الدخول ببريد المدير.

## البنية
```
db/
  schema.sql   ← المخطط الكامل: 18 جدولًا، 11 view، RLS، دوال العمليات
  seed.sql     ← بيانات تجريبية اختيارية
src/
  lib/         ← عميل Supabase، الأنواع، التنسيق، توحيد الهاتف
  auth/        ← سياق المصادقة وتحميل الدور
  components/  ← التخطيط، منتقي الزبون
  pages/       ← الشاشات (لوحة، زبائن، ملف زبون، فاتورة، دفعة، مخزون)
  styles/      ← tokens.css + global.css
```

## أعراف متّبعة (من مثيثقة المشروع)
- **لا حساب مالي في الواجهة.** كل مبلغ يأتي جاهزًا من view في قاعدة البيانات.
- **لا لون مكتوب مباشرة** — فقط `var(--...)` من `tokens.css`.
- **الأرقام لاتينية**، أحادية المسافة، والديون بالأحمر.
- **توحيد الهاتف مزدوج عمدًا:** `normalize_phone()` في SQL للتخزين، و
  `phoneSearchDigits()` في `src/lib/phone.ts` للبحث. عدّل أحدهما عدّل الآخر.

## قواعد تفرضها قاعدة البيانات (لا الواجهة)
- لا يُباع الرقم التسلسلي مرتين (قفل صف عند التسابق).
- لا بيع تحت `min_price` (بعد التحويل للدولار) بدون موافقة مدير مسجّلة.
- لا خصم بدون سبب، ولا توزيع دفعة يتجاوز قيمتها.
- الدفعات لا تُعدَّل ولا تُحذف — تُلغى بـ `voided_at` فقط.
- الإلغاء/الإرجاع يعيد البضاعة للمخزون تلقائيًا.
- كل تغيير مالي يُكتب في `audit_log`.

## عمليات آمنة (RPC)
- `create_sale(...)` — تنشئ الفاتورة وبنودها ودفعتها الأولى وجدول الأقساط في معاملة واحدة.
- `record_customer_payment(...)` — تقبض دفعة وتوزّعها على أقدم الأقساط استحقاقًا.

## وحدة ترحيل البيانات القديمة (Legacy Migration)
وحدة إضافية لتحويل سجلات الدفاتر الورقية إلى بيانات رقمية. تعمل **يدويًا بالكامل** بلا OCR،
والـ OCR تحسين اختياري.

**قاعدة البيانات (بالترتيب، بعد `schema.sql`):**
`db/migration.sql` → `db/storage.sql` → `db/migration_import.sql` →
`db/migration_import_orders.sql` → `db/migration_dedup.sql`.
ثم عيّن الأدوار: `update profiles set migration_role='operator'` (أو `'reviewer'`).

**OCR (المرحلة 2 — اختياري):** المفاتيح لا تكون في المتصفح، لذا يعمل عبر Edge Function.
يدعم أكثر من مزوّد ويختار تلقائيًا حسب المفتاح الموجود:

- **مجاني (Google Gemini) — المُوصى به:** احصل على مفتاح مجاني من
  [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) (بلا فوترة):
  ```bash
  supabase functions deploy extract-document
  supabase secrets set GEMINI_API_KEY=AIza...
  ```
- **بديل مدفوع (Anthropic):** `supabase secrets set ANTHROPIC_API_KEY=sk-ant-...`

الناتج **اقتراحات فقط** (حالة كل حقل «غير مؤكد») — لا يُوثَّق شيء إلا بمراجعة بشرية.
زر «قراءة تلقائية» في شاشة الإدخال. النظام يعمل يدويًا بالكامل بدون أي مفتاح.
