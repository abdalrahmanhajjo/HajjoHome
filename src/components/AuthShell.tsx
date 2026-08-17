import { useEffect, useRef, type ReactNode } from 'react'
import { useI18n } from '../i18n/i18n'
import { Logo } from './Logo'

/** لوحة قماشية متموّجة للبانِل الداكن — خيوط أحادية تنساب ببطء وتلمع قرب المؤشّر.
 *  (منقولة من StoreFlow) — تحترم تفضيل تقليل الحركة. */
function SilkWaves() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const parent = canvas?.parentElement
    if (!canvas || !parent) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let raf = 0, w = 0, h = 0
    const mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999, energy: 0, over: false }
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      w = rect.width; h = rect.height
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(() => resize())
    ro.observe(parent)
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      mouse.tx = e.clientX - rect.left; mouse.ty = e.clientY - rect.top; mouse.over = true
    }
    const onLeave = () => { mouse.over = false }
    parent.addEventListener('pointermove', onMove)
    parent.addEventListener('pointerleave', onLeave)
    const LINES = 26, STEP = 8
    let t = Math.random() * 100
    const drawFrame = () => {
      ctx.clearRect(0, 0, w, h)
      if (w < 2 || h < 2) return
      for (let i = 0; i < LINES; i++) {
        const yBase = (h * (i + 0.5)) / LINES
        const phase = i * 0.55
        ctx.beginPath()
        for (let x = -STEP; x <= w + STEP; x += STEP) {
          const idle = Math.sin(x * 0.006 + t * 2 + phase) * 7 + Math.sin(x * 0.0023 - t * 1.3 + phase * 1.7) * 12
          const dx = x - mouse.x, dy = yBase - mouse.y
          const influence = Math.exp(-(dx * dx + dy * dy) / 26000) * mouse.energy
          const swell = Math.sin(x * 0.02 + t * 6 + phase) * 30 * influence
          const y = yBase + idle + swell - dy * 0.35 * influence
          if (x === -STEP) ctx.moveTo(x, y); else ctx.lineTo(x, y)
        }
        const rowDy = yBase - mouse.y
        const glow = Math.exp(-(rowDy * rowDy) / 22000) * mouse.energy
        const shimmer = Math.sin(phase + t) ** 2
        ctx.strokeStyle = `rgba(244,244,241,${(0.045 + 0.03 * shimmer + 0.22 * glow).toFixed(3)})`
        ctx.lineWidth = 1
        ctx.stroke()
      }
    }
    const loop = () => {
      t += 0.004
      mouse.x += (mouse.tx - mouse.x) * 0.08
      mouse.y += (mouse.ty - mouse.y) * 0.08
      mouse.energy += ((mouse.over ? 1 : 0) - mouse.energy) * 0.05
      drawFrame(); raf = requestAnimationFrame(loop)
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) drawFrame()
    else raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf); ro.disconnect()
      parent.removeEventListener('pointermove', onMove)
      parent.removeEventListener('pointerleave', onLeave)
    }
  }, [])
  return <canvas ref={ref} aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
}

/** شريط تنبيه موحّد لشاشات المصادقة (خطأ أو نجاح). */
export function AuthNotice({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
  const color = tone === 'error' ? 'var(--c-danger)' : 'var(--c-success)'
  const bg = tone === 'error' ? 'var(--c-danger-soft)' : 'var(--c-success-soft)'
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      style={{
        background: bg, color, border: `1px solid ${color}`, borderRadius: 10,
        padding: '10px 14px', fontSize: 13, marginBottom: 16, fontWeight: 500, lineHeight: 1.6,
      }}
    >
      {children}
    </div>
  )
}

/** الإطار المشترك لشاشات المصادقة (الدخول، استعادة كلمة المرور):
 *  بانِل العلامة على اليمين، ومحتوى النموذج يُمرَّر كـ children. */
export default function AuthShell({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  return (
    <>
      <style>{`
        @keyframes auth-in { from { opacity: 0; transform: scale(0.985); } to { opacity: 1; transform: scale(1); } }
        .auth-wrap { min-height: 100vh; background: var(--c-bg); padding: 16px; display: flex; }
        .auth-split {
          width: 100%; min-height: calc(100vh - 32px);
          background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 16px;
          overflow: hidden; display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1.1fr);
          animation: auth-in .35s ease-out;
        }
        .auth-brand {
          position: relative; overflow: hidden; display: flex; flex-direction: column;
          justify-content: space-between; padding: clamp(24px,3vw,40px); color: var(--c-shell-text);
        }
        .auth-brand > * { position: relative; z-index: 1; }
        .auth-tagline h2 {
          margin: 0 0 14px; font-size: clamp(1.9rem,3.2vw,2.8rem); font-weight: 800;
          letter-spacing: -0.03em; line-height: 1.15; max-width: 16ch;
        }
        .auth-tagline h2 span { color: var(--c-shell-muted); }
        .auth-tagline p { margin: 0; font-size: 15px; line-height: 1.7; color: var(--c-shell-muted); max-width: 42ch; }
        .auth-pane { display: flex; flex-direction: column; align-items: center; padding: clamp(28px,4vw,48px); overflow-y: auto; }
        .auth-body { width: 100%; max-width: 400px; margin: auto 0; }
        .auth-foot { width: 100%; text-align: center; font-size: 13px; color: var(--c-text-faint); padding-top: 28px; }
        .auth-foot b { color: var(--c-text); font-weight: 700; }
        .auth-link {
          background: none; border: 0; padding: 0; cursor: pointer;
          font: inherit; font-size: 13px; font-weight: 600; color: var(--c-primary);
        }
        .auth-link:hover { text-decoration: underline; }
        @media (max-width: 900px) {
          .auth-split { grid-template-columns: 1fr; min-height: auto; }
          .auth-brand { display: none; }
        }
      `}</style>

      <div className="auth-wrap">
        <div className="auth-split">
          <aside className="auth-brand sf-brand-gradient">
            <SilkWaves />
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <Logo size={34} />
              <span className="display" style={{ fontWeight: 800, fontSize: 16, letterSpacing: '.02em' }}>{t('محل الحاجّو', 'Hajjo Store')}</span>
            </div>
            <div className="auth-tagline">
              <h2 className="display">{t('أدِرْ محلّك ', 'Run your whole ')}<span>{t('بالكامل', 'store')}</span></h2>
              <p>{t('الزبائن، الفواتير، الأقساط، المخزون، والموردون — نظام واحد لفريقك كلّه.', 'Customers, invoices, installments, inventory and suppliers — one workspace for your whole team.')}</p>
            </div>
          </aside>

          <div className="auth-pane">
            <div className="auth-body">{children}</div>
            <div className="auth-foot">{t('بدعم من', 'Powered by')} <b>{t('محل الحاجّو', 'Hajjo Store')}</b></div>
          </div>
        </div>
      </div>
    </>
  )
}
