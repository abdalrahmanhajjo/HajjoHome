import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { pick } from '../i18n/i18n'
import type { Profile, UserRole } from '../lib/types'

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  /** المستخدم قادم من رابط استعادة كلمة المرور — تُعرض شاشة التعيين بدل التطبيق. */
  recovering: boolean
  /** رابط استعادة منتهٍ أو غير صالح (يصل في هاش الرابط). */
  recoveryError: string | null
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  sendResetEmail: (email: string) => Promise<{ error: string | null }>
  updatePassword: (password: string) => Promise<{ error: string | null }>
  exitRecovery: () => void
  hasRole: (...roles: UserRole[]) => boolean
  isMigStaff: boolean
}

const AuthContext = createContext<AuthState | undefined>(undefined)

/** مسار الرجوع الذي يوجّه إليه بريد الاستعادة. */
export const RESET_PATH = '/reset-password'

/** يقرأ حالة الاستعادة من الرابط مباشرة.
 *  ضروري لأن حدث PASSWORD_RECOVERY قد يُطلق قبل أن يُسجَّل المستمع،
 *  كما أنّ supabase-js يمسح الهاش بعد معالجته. */
function readRecoveryUrl(): { recovery: boolean; error: string | null } {
  if (typeof window === 'undefined') return { recovery: false, error: null }
  const raw = window.location.hash.replace(/^#/, '')
  const hash = new URLSearchParams(raw)
  const query = new URLSearchParams(window.location.search)
  const get = (k: string) => hash.get(k) ?? query.get(k)

  const errorCode = get('error_code')
  if (errorCode) {
    const expired = errorCode === 'otp_expired' || get('error') === 'access_denied'
    return {
      recovery: true,
      error: expired
        ? pick('انتهت صلاحية رابط الاستعادة أو سبق استخدامه. اطلب رابطًا جديدًا.',
               'This recovery link has expired or was already used. Request a new one.')
        : get('error_description') ?? errorCode,
    }
  }

  const isRecovery = get('type') === 'recovery' || window.location.pathname === RESET_PATH
  return { recovery: isRecovery, error: null }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const initialRecovery = useState(readRecoveryUrl)[0]
  const [recovering, setRecovering] = useState(initialRecovery.recovery)
  const [recoveryError, setRecoveryError] = useState(initialRecovery.error)

  async function loadProfile(userId: string) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, role, is_active, migration_role')
      .eq('id', userId)
      .maybeSingle()
    if (error) {
      // eslint-disable-next-line no-console
      console.error('فشل تحميل الملف الشخصي:', error.message)
      setProfile(null)
      return
    }
    setProfile(data as Profile | null)
  }

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      if (data.session?.user) await loadProfile(data.session.user.id)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, next) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      setSession(next)
      if (next?.user) {
        await loadProfile(next.user.id)
      } else {
        setProfile(null)
      }
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: translateAuthError(error.message) }
    return { error: null }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setProfile(null)
  }

  async function sendResetEmail(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}${RESET_PATH}`,
    })
    if (error) return { error: translateAuthError(error.message) }
    return { error: null }
  }

  async function updatePassword(password: string) {
    const { error } = await supabase.auth.updateUser({ password })
    if (error) return { error: translateAuthError(error.message) }
    return { error: null }
  }

  /** يغادر وضع الاستعادة وينظّف الرابط من الرمز/الخطأ. */
  function exitRecovery() {
    setRecovering(false)
    setRecoveryError(null)
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', '/')
    }
  }

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      loading,
      recovering,
      recoveryError,
      signIn,
      signOut,
      sendResetEmail,
      updatePassword,
      exitRecovery,
      hasRole: (...roles: UserRole[]) =>
        profile != null && profile.is_active && roles.includes(profile.role),
      isMigStaff:
        profile != null &&
        profile.is_active &&
        (profile.role === 'owner' ||
          profile.role === 'accountant' ||
          profile.migration_role === 'operator' ||
          profile.migration_role === 'reviewer'),
    }),
    [session, profile, loading, recovering, recoveryError]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth يجب أن يُستخدم داخل AuthProvider')
  return ctx
}

function translateAuthError(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return pick('البريد أو كلمة المرور غير صحيحة', 'Invalid email or password')
  if (/email not confirmed/i.test(msg)) return pick('البريد غير مفعّل بعد', 'Email not confirmed yet')
  if (/auth session missing/i.test(msg))
    return pick('انتهت جلسة الاستعادة. افتح رابط البريد من جديد.', 'The recovery session expired. Open the emailed link again.')
  if (/should be different from the old password/i.test(msg))
    return pick('كلمة المرور الجديدة يجب أن تختلف عن القديمة', 'The new password must differ from the old one')
  if (/password should be at least (\d+)/i.test(msg)) {
    const n = msg.match(/at least (\d+)/i)?.[1] ?? '6'
    return pick(`كلمة المرور يجب أن تكون ${n} أحرف على الأقل`, `Password must be at least ${n} characters`)
  }
  if (/for security purposes|rate limit|too many requests/i.test(msg))
    return pick('طلبات كثيرة خلال وقت قصير. انتظر قليلًا ثم أعد المحاولة.', 'Too many requests in a short time. Wait a moment and try again.')
  if (/unable to validate email address|invalid format/i.test(msg))
    return pick('صيغة البريد الإلكتروني غير صحيحة', 'Invalid email format')
  return msg
}
