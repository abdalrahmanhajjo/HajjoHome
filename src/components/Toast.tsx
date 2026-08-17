import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

type ToastKind = 'ok' | 'danger' | 'info'
interface ToastItem { id: number; message: string; kind: ToastKind }
interface ToastApi { toast: (message: string, kind?: ToastKind) => void }

const Ctx = createContext<ToastApi | null>(null)

/** إشعار عائم موحّد. استعمله: const { toast } = useToast(); toast('تم الحفظ'). */
export function useToast(): ToastApi {
  const c = useContext(Ctx)
  if (!c) throw new Error('useToast must be used within <ToastProvider>')
  return c
}

let seq = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const remove = useCallback((id: number) => setItems((xs) => xs.filter((t) => t.id !== id)), [])

  const toast = useCallback((message: string, kind: ToastKind = 'ok') => {
    const id = ++seq
    setItems((xs) => [...xs, { id, message, kind }])
    window.setTimeout(() => remove(id), 4000)
  }, [remove])

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="toast-wrap" aria-live="polite" aria-atomic="false">
        {items.map((t) => (
          <div key={t.id} className={`toast toast--${t.kind}`} role="status" onClick={() => remove(t.id)}>
            <span className="toast__dot" aria-hidden />
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
