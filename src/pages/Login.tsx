import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../i18n/i18n'
import AuthShell, { AuthNotice } from '../components/AuthShell'

type View = 'signin' | 'forgot'

export default function Login() {
  const { signIn, sendResetEmail } = useAuth()
  const { t } = useI18n()
  const [view, setView] = useState<View>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  function switchTo(next: View) {
    setView(next)
    setError(null)
    setSent(false)
  }

  async function onSignIn(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const { error } = await signIn(email.trim(), password)
    setBusy(false)
    if (error) setError(error)
  }

  async function onForgot(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const { error } = await sendResetEmail(email.trim())
    setBusy(false)
    if (error) setError(error)
    else setSent(true)
  }

  if (view === 'forgot') {
    return (
      <AuthShell>
        <h1 className="display" style={{ fontSize: 27, fontWeight: 800, color: 'var(--c-text)', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
          {t('استعادة كلمة المرور', 'Reset your password')}
        </h1>
        <p style={{ margin: '0 0 26px', fontSize: 14, color: 'var(--c-text-muted)' }}>
          {t('أدخل بريدك وسنرسل لك رابطًا لتعيين كلمة مرور جديدة.',
             'Enter your email and we will send you a link to set a new password.')}
        </p>

        {error && <AuthNotice tone="error">{error}</AuthNotice>}
        {sent && (
          <AuthNotice tone="success">
            {t('إن كان هناك حساب بهذا البريد، فقد أُرسل إليه رابط الاستعادة. تحقّق من بريدك (وملف الرسائل المزعجة). الرابط صالح لمدة ساعة.',
               'If an account exists for this email, a recovery link has been sent. Check your inbox (and spam). The link is valid for one hour.')}
          </AuthNotice>
        )}

        <form onSubmit={onForgot} noValidate>
          <div className="field">
            <label htmlFor="reset-email">{t('البريد الإلكتروني', 'Email address')}</label>
            <input id="reset-email" type="email" className="input" dir="ltr" autoComplete="username"
              value={email} onChange={(e) => setEmail(e.target.value)} required
              style={{ background: 'var(--c-surface-2)' }} />
          </div>
          <button className="btn btn--primary btn--block mt-2" type="submit" disabled={busy}>
            {busy ? <span className="spinner" /> : t('أرسل رابط الاستعادة', 'Send recovery link')}
          </button>
        </form>

        <p style={{ marginTop: 20, textAlign: 'center' }}>
          <button type="button" className="auth-link" onClick={() => switchTo('signin')}>
            {t('العودة إلى تسجيل الدخول', 'Back to sign in')}
          </button>
        </p>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <h1 className="display" style={{ fontSize: 27, fontWeight: 800, color: 'var(--c-text)', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
        {t('مرحبًا بعودتك', 'Welcome back')}
      </h1>
      <p style={{ margin: '0 0 26px', fontSize: 14, color: 'var(--c-text-muted)' }}>
        {t('سجّل الدخول للمتابعة في نظام إدارة المحل', 'Sign in to continue to Store Management')}
      </p>

      {error && <AuthNotice tone="error">{error}</AuthNotice>}

      <form onSubmit={onSignIn} noValidate>
        <div className="field">
          <label htmlFor="email">{t('البريد الإلكتروني', 'Email address')}</label>
          <input id="email" type="email" className="input" dir="ltr" autoComplete="username"
            value={email} onChange={(e) => setEmail(e.target.value)} required
            style={{ background: 'var(--c-surface-2)' }} />
        </div>
        <div className="field">
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <label htmlFor="password" style={{ marginBottom: 0 }}>{t('كلمة المرور', 'Password')}</label>
            <button type="button" className="auth-link" onClick={() => switchTo('forgot')}>
              {t('نسيت كلمة المرور؟', 'Forgot password?')}
            </button>
          </div>
          <input id="password" type="password" className="input" dir="ltr" autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} required
            style={{ background: 'var(--c-surface-2)' }} />
        </div>
        <button className="btn btn--primary btn--block mt-2" type="submit" disabled={busy}>
          {busy ? <span className="spinner" /> : t('دخول', 'Sign in')}
        </button>
      </form>

      <p className="faint small" style={{ marginTop: 20, textAlign: 'center' }}>
        {t('الحسابات يضيفها المدير من إعدادات المستخدمين.', 'Accounts are added by the owner from user settings.')}
      </p>
    </AuthShell>
  )
}
