import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './auth/AuthProvider'
import { pick } from './i18n/i18n'
import { isSupabaseConfigured } from './lib/supabase'
import Layout from './components/Layout'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'

// تقسيم الشيفرة: كل صفحة تُحمّل عند الحاجة (يخفّف الحزمة الأولى)
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Customers = lazy(() => import('./pages/Customers'))
const CustomerFile = lazy(() => import('./pages/CustomerFile'))
const NewCustomer = lazy(() => import('./pages/NewCustomer'))
const NewInvoice = lazy(() => import('./pages/NewInvoice'))
const RecordPayment = lazy(() => import('./pages/RecordPayment'))
const InvoiceDetail = lazy(() => import('./pages/InvoiceDetail'))
const ReceiptDetail = lazy(() => import('./pages/ReceiptDetail'))
const Reports = lazy(() => import('./pages/Reports'))
const Products = lazy(() => import('./pages/Products'))
const Stock = lazy(() => import('./pages/Stock'))
const Suppliers = lazy(() => import('./pages/Suppliers'))
const Deliveries = lazy(() => import('./pages/Deliveries'))
const Users = lazy(() => import('./pages/Users'))
const MigrationDashboard = lazy(() => import('./pages/migration/MigrationDashboard'))
const UploadDocuments = lazy(() => import('./pages/migration/UploadDocuments'))
const MigDocuments = lazy(() => import('./pages/migration/Documents'))
const DataEntry = lazy(() => import('./pages/migration/DataEntry'))
const ReviewQueue = lazy(() => import('./pages/migration/ReviewQueue'))
const Duplicates = lazy(() => import('./pages/migration/Duplicates'))
const ImportBatches = lazy(() => import('./pages/migration/ImportBatches'))
const OwnerReview = lazy(() => import('./pages/migration/OwnerReview'))
const FinancialChecks = lazy(() => import('./pages/migration/FinancialChecks'))
const Vocabulary = lazy(() => import('./pages/migration/Vocabulary'))
const Abbreviations = lazy(() => import('./pages/migration/Abbreviations'))
const RecognitionAnalytics = lazy(() => import('./pages/migration/RecognitionAnalytics'))
const LearningCorrections = lazy(() => import('./pages/migration/LearningCorrections'))

export default function App() {
  const { session, profile, loading, recovering } = useAuth()

  if (!isSupabaseConfigured) {
    return (
      <div className="center-screen">
        <div className="card login-card">
          <div className="card__body stack">
            <h3>{pick('الإعداد غير مكتمل', 'Setup incomplete')}</h3>
            <p className="muted small">
              {pick('لم يتم ضبط الاتصال بـ Supabase. انسخ ملف', 'Supabase connection is not configured. Copy')}{' '}
              <code>.env.example</code> {pick('إلى', 'to')}{' '}
              <code>.env</code> {pick('واملأ', 'and fill')} <code>VITE_SUPABASE_URL</code> {pick('و', 'and')}{' '}
              <code>VITE_SUPABASE_ANON_KEY</code>{pick('، ثم أعد تشغيل الخادم.', ', then restart the dev server.')}
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="center-screen">
        <span className="spinner" aria-label="جارٍ التحميل" />
      </div>
    )
  }

  // رابط استعادة كلمة المرور يُنشئ جلسة صالحة، لذا يجب اعتراضه قبل بوّابة الجلسة
  // وإلّا هبط المستخدم على لوحة التحكّم دون أن يعيّن كلمة مرور جديدة.
  if (recovering) return <ResetPassword />

  if (!session) return <Login />

  if (!profile) {
    return (
      <div className="center-screen">
        <div className="card login-card">
          <div className="card__body stack">
            <h3>{pick('لا يوجد حساب مفعّل', 'No active account')}</h3>
            <p className="muted small">
              {pick('حسابك غير مربوط بملف مستخدم أو أنه غير مفعّل. تواصل مع المدير لإضافة صفّك في جدول',
                    'Your account is not linked to a profile or is inactive. Ask the owner to add your row in the')}{' '}
              <code>profiles</code> {pick('.', 'table.')}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <Layout>
      <Suspense fallback={<span className="spinner" />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/customers/new" element={<NewCustomer />} />
          <Route path="/customers/:id" element={<CustomerFile />} />
          <Route path="/invoices/new" element={<NewInvoice />} />
          <Route path="/invoices/:id" element={<InvoiceDetail />} />
          <Route path="/receipts/:id" element={<ReceiptDetail />} />
          <Route path="/payments/new" element={<RecordPayment />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/products" element={<Products />} />
          <Route path="/stock" element={<Stock />} />
          <Route path="/suppliers" element={<Suppliers />} />
          <Route path="/deliveries" element={<Deliveries />} />
          <Route path="/users" element={<Users />} />
          <Route path="/migration" element={<MigrationDashboard />} />
          <Route path="/migration/upload" element={<UploadDocuments />} />
          <Route path="/migration/documents" element={<MigDocuments />} />
          <Route path="/migration/entry" element={<DataEntry />} />
          <Route path="/migration/review" element={<ReviewQueue />} />
          <Route path="/migration/duplicates" element={<Duplicates />} />
          <Route path="/migration/import" element={<ImportBatches />} />
          <Route path="/migration/owner-review" element={<OwnerReview />} />
          <Route path="/migration/financial" element={<FinancialChecks />} />
          <Route path="/migration/vocabulary" element={<Vocabulary />} />
          <Route path="/migration/abbreviations" element={<Abbreviations />} />
          <Route path="/migration/analytics" element={<RecognitionAnalytics />} />
          <Route path="/migration/learning" element={<LearningCorrections />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  )
}
