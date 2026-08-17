import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!url || !anonKey) {
  // رسالة واضحة بدل خطأ غامض عند نسيان ملف .env
  // eslint-disable-next-line no-console
  console.error(
    'مفقود VITE_SUPABASE_URL أو VITE_SUPABASE_ANON_KEY — انسخ .env.example إلى .env واملأ القيم.'
  )
}

export const supabase = createClient(url ?? '', anonKey ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
})

export const isSupabaseConfigured = Boolean(url && anonKey)
