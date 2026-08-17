// شعار المحل — بلاطة ثابتة اللون تعمل على الشريط الداكن وشاشة الدخول الفاتحة.
export function Logo({ size = 34 }: { size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: '#f4f4f1',
        color: '#131312',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 800,
        fontSize: size * 0.52,
        lineHeight: 1,
        flexShrink: 0,
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.08)',
      }}
    >
      ح
    </span>
  )
}
