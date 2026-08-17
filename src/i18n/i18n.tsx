import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Lang = 'ar' | 'en'

interface I18nState {
  lang: Lang
  dir: 'rtl' | 'ltr'
  setLang: (l: Lang) => void
  // t(arabic, english?) — يعيد النص حسب اللغة المختارة. عربي هو الأصل.
  t: (ar: string, en?: string) => string
}

const I18nContext = createContext<I18nState | undefined>(undefined)
const STORAGE_KEY = 'app_lang'

// لغة على مستوى الوحدة — لتُستخدم في الدوال الصِّرفة (تنسيق التسميات) خارج React.
let moduleLang: Lang = (() => {
  try { return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'ar' } catch { return 'ar' }
})()
// eslint-disable-next-line react-refresh/only-export-components
export function currentLang(): Lang { return moduleLang }
// eslint-disable-next-line react-refresh/only-export-components
export function pick<T>(ar: T, en: T): T { return moduleLang === 'en' ? en : ar }

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved === 'en' ? 'en' : 'ar'
  })
  const dir: 'rtl' | 'ltr' = lang === 'ar' ? 'rtl' : 'ltr'

  useEffect(() => {
    moduleLang = lang
    document.documentElement.lang = lang
    document.documentElement.dir = dir
    try { localStorage.setItem(STORAGE_KEY, lang) } catch { /* ignore */ }
  }, [lang, dir])

  const value = useMemo<I18nState>(
    () => ({
      lang,
      dir,
      setLang: setLangState,
      t: (ar, en) => (lang === 'en' && en ? en : ar),
    }),
    [lang, dir]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useI18n(): I18nState {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}

export function LangSwitcher() {
  const { lang, setLang } = useI18n()
  return (
    <button
      className="tb-pill"
      onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
      title={lang === 'ar' ? 'English' : 'العربية'}
      aria-label={lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}
    >
      {lang === 'ar' ? 'EN' : 'ع'}
    </button>
  )
}
