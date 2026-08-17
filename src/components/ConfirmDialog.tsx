import { useEffect, type ReactNode } from 'react'
import { useI18n } from '../i18n/i18n'

/** حوار تأكيد للإجراءات الحسّاسة (حذف/أرشفة). يظهر فوق أي نافذة أخرى. */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  message?: ReactNode
  confirmLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const { t } = useI18n()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null

  return (
    <div className="modal-overlay" style={{ zIndex: 60 }} onMouseDown={() => { if (!busy) onClose() }}>
      <div className="modal" style={{ maxWidth: 420, marginTop: 'var(--sp-7)' }} role="alertdialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <span>{title}</span>
          <button type="button" className="modal__close" aria-label={t('إغلاق', 'Close')} onClick={onClose} disabled={busy}>×</button>
        </div>
        <div className="modal__body">
          {message && <p className="muted" style={{ marginTop: 0 }}>{message}</p>}
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 'var(--sp-3)' }}>
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>{t('إلغاء', 'Cancel')}</button>
            <button type="button" className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`} onClick={onConfirm} disabled={busy}>
              {busy ? <span className="spinner" /> : (confirmLabel ?? t('تأكيد', 'Confirm'))}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
