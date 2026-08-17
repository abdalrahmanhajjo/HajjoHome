// أنواع تعكس جداول ومناظير schema.sql — للحقول التي تستعملها الواجهة.
// ليست شاملة لكل عمود؛ أضف ما تحتاجه عند توسّع الشاشات.

export type UserRole = 'owner' | 'sales' | 'accountant' | 'stock'
export type CurrencyCode = 'USD' | 'LBP'
export type CustomerStatus = 'active' | 'inactive' | 'needs_review' | 'defaulted'
export type PaymentPlan = 'cash' | 'installments' | 'mixed'
export type PaymentMethod = 'cash' | 'transfer' | 'card' | 'cheque' | 'other'
export type OrderStatus =
  | 'draft' | 'confirmed' | 'reserved' | 'ready'
  | 'delivered' | 'completed' | 'cancelled' | 'returned'
export type InstallmentStatus =
  | 'pending' | 'partial' | 'paid' | 'overdue' | 'cancelled'

export type MigrationRole = 'operator' | 'reviewer'

export interface Profile {
  id: string
  full_name: string
  role: UserRole
  is_active: boolean
  migration_role: MigrationRole | null
}

export interface Customer {
  id: string
  code: string
  full_name: string
  phone_raw: string | null
  phone: string | null
  phone2_raw: string | null
  phone2: string | null
  area: string | null
  address: string | null
  national_id: string | null
  guarantor_name: string | null
  guarantor_phone: string | null
  manual_balance_usd: number
  status: CustomerStatus
  notes: string | null
  created_at: string
}

export interface CustomerBalance {
  customer_id: string
  code: string
  full_name: string
  phone: string | null
  area: string | null
  status: CustomerStatus
  purchases_usd: number
  paid_usd: number
  balance_usd: number
  manual_balance_usd: number
  orders_count: number
  open_orders: number
  last_order_date: string | null
  last_payment_date: string | null
}

export interface OrderTotal {
  order_id: string
  code: string
  customer_id: string
  order_date: string
  status: OrderStatus
  plan: PaymentPlan
  currency: CurrencyCode
  fx_rate: number
  subtotal: number
  total: number
  paid_usd: number
  total_usd: number
  remaining_usd: number
}

export interface InstallmentRow {
  installment_id: string
  order_id: string
  customer_id: string
  number: number
  due_date: string
  amount_usd: number
  paid_usd: number
  remaining_usd: number
  status: InstallmentStatus
  days_late: number
}

export interface OverdueInstallment extends InstallmentRow {
  full_name: string
  phone: string | null
  area: string | null
  order_code: string
}

export interface DashboardToday {
  sales_today_usd: number
  collected_today_usd: number
  orders_today: number
  new_customers_today: number
  installments_due_today: number
  installments_overdue: number
  products_low_stock: number
  deliveries_pending: number
  cheques_due_week_usd: number
}

export interface StockLevel {
  product_id: string
  code: string
  category_id: string
  brand: string | null
  model: string | null
  is_serialized: boolean
  available_qty: number
  reserved_qty: number
  reorder_level: number
  needs_reorder: boolean
  sale_price: number | null
}

export interface Product {
  id: string
  code: string
  category_id: string
  brand: string | null
  model: string | null
  description: string | null
  is_serialized: boolean
  sale_price: number | null
  min_price: number | null
  warranty_months: number
  is_active: boolean
}

export interface ProductUnit {
  id: string
  product_id: string
  serial_number: string
  condition: 'new' | 'used' | 'display'
  status: string
  location: string | null
}

export interface Category {
  id: string
  name: string
  sort_order: number
}

export interface DuplicateCustomer {
  phone: string
  matches: number
  codes: string[]
  names: string[]
  ids: string[]
}

export interface Payment {
  id: string
  receipt_no: string
  direction: 'in' | 'out'
  customer_id: string | null
  amount: number
  currency: CurrencyCode
  fx_rate: number
  amount_usd: number
  method: PaymentMethod
  payment_date: string
  notes: string | null
}

// بند فاتورة كما يُرسَل إلى دالة create_sale
export interface SaleItemInput {
  product_id: string
  product_unit_id?: string | null
  quantity: number
  unit_price: number
  discount?: number
  price_override_by?: string | null
}
