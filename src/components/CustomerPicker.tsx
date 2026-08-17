import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../i18n/i18n'
import { phoneSearchDigits, displayPhone } from '../lib/phone'
import { formatUsd, balanceClass } from '../lib/format'

export interface PickedCustomer {
  customer_id: string
  code: string
  full_name: string
  phone: string | null
  balance_usd: number
}

export default function CustomerPicker({
  value,
  onSelect,
  onClear,
}: {
  value: PickedCustomer | null
  onSelect: (c: PickedCustomer) => void
  onClear: () => void
}) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<PickedCustomer[]>([])
  const [loading, setLoading] = useState(false)
  const reqId = useRef(0)

  useEffect(() => {
    if (value) return
    const handle = setTimeout(() => void search(query), 250)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, value])

  async function search(q: string) {
    const trimmed = q.trim()
    if (!trimmed) { setRows([]); return }
    const myId = ++reqId.current
    setLoading(true)
    const safe = trimmed.replace(/[%,()*]/g, ' ')
    const digits = phoneSearchDigits(trimmed)
    const ors = [`full_name.ilike.*${safe}*`, `code.ilike.*${safe}*`]
    if (digits) ors.push(`phone.ilike.*${digits}*`)
    const { data } = await supabase
      .from('v_customer_balances')
      .select('customer_id, code, full_name, phone, balance_usd')
      .or(ors.join(','))
      .limit(8)
    if (myId !== reqId.current) return
    setRows((data ?? []) as PickedCustomer[])
    setLoading(false)
  }

  if (value) {
    return (
      <div className="between card" style={{ padding: 'var(--sp-3)' }}>
        <div>
          <strong>{value.full_name}</strong> <span className="faint num">{value.code}</span>
          <div className="small num">
            {t('الرصيد:', 'Balance:')}{' '}
            <span className={balanceClass(value.balance_usd)}>{formatUsd(value.balance_usd)}</span>
          </div>
        </div>
        <button type="button" className="btn btn--sm btn--ghost" onClick={onClear}>{t('تغيير', 'Change')}</button>
      </div>
    )
  }

  return (
    <div>
      <input
        className="input"
        placeholder={t('ابحث عن الزبون بالاسم أو الهاتف أو رقم الملف…', 'Search customer by name, phone, or file number…')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      {loading && <div className="small muted mt-2"><span className="spinner" /> {t('بحث…', 'Searching…')}</div>}
      {rows.length > 0 && (
        <div className="card mt-2">
          <div className="table-wrap">
            <table className="data">
              <tbody>
                {rows.map((c) => (
                  <tr key={c.customer_id} style={{ cursor: 'pointer' }} onClick={() => onSelect(c)}>
                    <td className="num">{c.code}</td>
                    <td>{c.full_name}</td>
                    <td className="num">{displayPhone(c.phone)}</td>
                    <td className="num"><span className={balanceClass(c.balance_usd)}>{formatUsd(c.balance_usd)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
