import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../i18n/i18n'
import AuthShell, { AuthNotice } from '../components/AuthShell'

const MIN_LEN = 8

/** شاشة تعيين كلمة مرور جديدة بعد فتح رابط الاستعادة من البريد.
 *  تُعرض من App.tsx متى كان recovering صحيحًا — قبل بوّابات الجلسة والملف الشخصي. */
export default function ResetPassword() {
  const { session, recoveryError, updatePassword, exitRecovery } = useAuth()
  const { t } = useI18n()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < MIN_LEN) {
      setError(t(`كلمة المرور يجب أن تكون ${MIN_LEN} أحرف على الأقل`, `Password must be at least ${MIN_LEN} characters`))
      return
    }
    if (password !== confirm) {
      setError(t('كلمتا المرور غير متطابقتين', 'The two passwords do not match'))
      return
    }

    setBusy(true)
    const { error } = await updatePassword(password)
    setBusy(false)
    if (error) setError(error)
    else setDone(true)
  }

  const title = t('تعيين كلمة مرور جديدة', 'Set a new password')

  // رابط منتهٍ أو غير صالح، أو فتح الصفحة بلا جلسة استعادة
  const blocked = recoveryError ?? (!session
    ? t('لا توجد جلسة استعادة. افتح الرابط المُرسل إلى بريدك، أو اطلب رابطًا جديدًا من صفحة الدخول.',
        'No recovery session. Open the link sent to your email, or request a new one from the sign-in page.')
    : null)

  if (blocked && !done) {
    return (
      <AuthShell>
        <h1 className="display" style={{ fontSize: 27, fontWeight: 800, color: 'var(--c-text)', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
          {title}
        </h1>
        <p style={{ margin: '0 0 26px', fontSize: 14, color: 'var(--c-text-muted)' }}>
          {t('تعذّر متابعة الاستعادة.', 'Recovery could not continue.')}
        </p>
        <AuthNotice tone="error">{blocked}</AuthNotice>
        <button className="btn btn--primary btn--block mt-2" type="button" onClick={exitRecovery}>
          {t('العودة إلى تسجيل الدخول', 'Back to sign in')}
        </button>
      </AuthShell>
    )
  }

  if (done) {
    return (
      <AuthShell>
        <h1 className="display" style={{ fontSize: 27, fontWeight: 800, color: 'var(--c-text)', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
          {t('تم تغيير كلمة المرور', 'Password changed')}
        </h1>
        <p style={{ margin: '0 0 26px', fontSize: 14, color: 'var(--c-text-muted)' }}>
          {t('يمكنك الآن استخدام كلمة المرور الجديدة عند الدخول.', 'You can now use the new password to sign in.')}
        </p>
        <AuthNotice tone="success">
          {t('حُدِّثت كلمة المرور بنجاح.', 'Your password was updated successfully.')}
        </AuthNotice>
        <button className="btn btn--primary btn--block mt-2" type="button" onClick={exitRecovery}>
          {t('متابعة إلى النظام', 'Continue to the app')}
        </button>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <h1 className="display" style={{ fontSize: 27, fontWeight: 800, color: 'var(--c-text)', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
        {title}
      </h1>
      <p style={{ margin: '0 0 26px', fontSize: 14, color: 'var(--c-text-muted)' }}>
        {t(`اختر كلمة مرور جديدة لا تقلّ عن ${MIN_LEN} أحرف.`, `Choose a new password of at least ${MIN_LEN} characters.`)}
      </p>

      {error && <AuthNotice tone="error">{error}</AuthNotice>}

      <form onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="new-password">{t('كلمة المرور الجديدة', 'New password')}</label>
          <input id="new-password" type="password" className="input" dir="ltr" autoComplete="new-password"
            value={password} onChange={(e) => setPassword(e.target.value)} required
            style={{ background: 'var(--c-surface-2)' }} />
        </div>
        <div className="field">
          <label htmlFor="confirm-password">{t('تأكيد كلمة المرور', 'Confirm password')}</label>
          <input id="confirm-password" type="password" className="input" dir="ltr" autoComplete="new-password"
            value={confirm} onChange={(e) => setConfirm(e.target.value)} required
            style={{ background: 'var(--c-surface-2)' }} />
        </div>
        <button className="btn btn--primary btn--block mt-2" type="submit" disabled={busy}>
          {busy ? <span className="spinner" /> : t('حفظ كلمة المرور', 'Save password')}
        </button>
      </form>

      <p style={{ marginTop: 20, textAlign: 'center' }}>
        <button type="button" className="auth-link" onClick={exitRecovery}>
          {t('إلغاء', 'Cancel')}
        </button>
      </p>
    </AuthShell>
  )
}
