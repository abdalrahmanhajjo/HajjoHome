import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../i18n/i18n'
import PageHeader from '../components/PageHeader'
import { phoneSearchDigits, displayPhone } from '../lib/phone'
import type { Customer } from '../lib/types'

interface DupMatch {
  id: string
  code: string
  full_name: string
  phone: string | null
  area: string | null
}

export default function NewCustomer() {
  const { profile } = useAuth()
  const { t } = useI18n()
  const navigate = useNavigate()

  const [form, setForm] = useState({
    full_name: '', phone_raw: '', phone2_raw: '', area: '', address: '',
    national_id: '', guarantor_name: '', guarantor_phone: '', notes: '',
  })
  const [dups, setDups] = useState<DupMatch[]>([])
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const digits = useMemo(() => phoneSearchDigits(form.phone_raw), [form.phone_raw])
  const nameTrim = form.full_name.trim()

  useEffect(() => {
    if (digits.length < 5 && nameTrim.length < 3) { setDups([]); return }
    const handle = setTimeout(() => void checkDuplicates(), 300)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digits, nameTrim])

  async function checkDuplicates() {
    setChecking(true)
    const ors: string[] = []
    if (digits.length >= 5) ors.push(`phone.ilike.*${digits}*`)
    if (nameTrim.length >= 3) ors.push(`full_name.ilike.*${nameTrim.replace(/[%,()*]/g, ' ')}*`)
    if (ors.length === 0) { setDups([]); setChecking(false); return }
    const { data, error } = await supabase
      .from('customers').select('id, code, full_name, phone, area').or(ors.join(',')).limit(8)
    if (!error) setDups((data ?? []) as DupMatch[])
    setChecking(false)
  }

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!nameTrim) return setError(t('الاسم مطلوب', 'Name is required'))
    setSaving(true)
    const payload = {
      full_name: nameTrim,
      phone_raw: form.phone_raw.trim() || null,
      phone2_raw: form.phone2_raw.trim() || null,
      area: form.area.trim() || null,
      address: form.address.trim() || null,
      national_id: form.national_id.trim() || null,
      guarantor_name: form.guarantor_name.trim() || null,
      guarantor_phone: form.guarantor_phone.trim() || null,
      notes: form.notes.trim() || null,
      created_by: profile?.id ?? null,
    }
    const { data, error } = await supabase.from('customers').insert(payload).select('id').single()
    setSaving(false)
    if (error) return setError(error.message)
    navigate(`/customers/${(data as Pick<Customer, 'id'>).id}`)
  }

  return (
    <div>
      <PageHeader
        eyebrow={t('العلاقات', 'Relationships')}
        title={t('زبون جديد', 'New customer')}
        subtitle={t('أضِف ملف زبون جديد', 'Add a new customer file')}
        actions={<Link to="/customers" className="btn btn--ghost">{t('رجوع', 'Back')}</Link>}
      />

      <div className="grid grid--2">
        <form className="card" onSubmit={onSubmit}>
          <div className="card__header">{t('بيانات الزبون', 'Customer details')}</div>
          <div className="card__body">
            {error && <div className="alert alert--danger mt-2">{error}</div>}

            <div className="field">
              <label>{t('الاسم الكامل *', 'Full name *')}</label>
              <input className="input" value={form.full_name} onChange={(e) => update('full_name', e.target.value)} required />
            </div>

            <div className="row">
              <div className="field">
                <label>{t('الهاتف الأساسي', 'Primary phone')}</label>
                <input className="input num" dir="ltr" value={form.phone_raw} onChange={(e) => update('phone_raw', e.target.value)} placeholder="03 456 789" />
              </div>
              <div className="field">
                <label>{t('هاتف إضافي', 'Secondary phone')}</label>
                <input className="input num" dir="ltr" value={form.phone2_raw} onChange={(e) => update('phone2_raw', e.target.value)} />
              </div>
            </div>

            <div className="row">
              <div className="field">
                <label>{t('المنطقة', 'Area')}</label>
                <input className="input" value={form.area} onChange={(e) => update('area', e.target.value)} />
              </div>
              <div className="field">
                <label>{t('رقم الهوية', 'National ID')}</label>
                <input className="input" value={form.national_id} onChange={(e) => update('national_id', e.target.value)} />
              </div>
            </div>

            <div className="field">
              <label>{t('العنوان', 'Address')}</label>
              <input className="input" value={form.address} onChange={(e) => update('address', e.target.value)} />
            </div>

            <div className="row">
              <div className="field">
                <label>{t('اسم الكفيل', 'Guarantor name')}</label>
                <input className="input" value={form.guarantor_name} onChange={(e) => update('guarantor_name', e.target.value)} />
              </div>
              <div className="field">
                <label>{t('هاتف الكفيل', 'Guarantor phone')}</label>
                <input className="input num" dir="ltr" value={form.guarantor_phone} onChange={(e) => update('guarantor_phone', e.target.value)} />
              </div>
            </div>

            <div className="field">
              <label>{t('ملاحظات', 'Notes')}</label>
              <textarea className="textarea" rows={2} value={form.notes} onChange={(e) => update('notes', e.target.value)} />
            </div>

            <button className="btn btn--primary btn--block" type="submit" disabled={saving}>
              {saving ? <span className="spinner" /> : t('حفظ الزبون', 'Save customer')}
            </button>
          </div>
        </form>

        <div className="card" style={{ alignSelf: 'start' }}>
          <div className="card__header">
            {t('احتمال تكرار', 'Possible duplicate')}
            {checking && <span className="spinner" />}
          </div>
          <div className="card__body">
            {dups.length === 0 ? (
              <p className="muted small">
                {t('نبحث عن زبائن بأسماء أو أرقام مشابهة قبل الحفظ حتى لا يتكرّر الملف. لا يوجد تطابق حتى الآن.',
                   'We search for customers with similar names or phones before saving to avoid duplicates. No match yet.')}
              </p>
            ) : (
              <>
                <div className="alert alert--warn">
                  {t(`وُجد ${dups.length} زبون محتمل التطابق — تأكّد أنه ليس نفس الشخص قبل الحفظ.`,
                     `Found ${dups.length} possible matches — make sure it isn't the same person before saving.`)}
                </div>
                <div className="table-wrap mt-2">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>{t('الرقم', 'Code')}</th><th>{t('الاسم', 'Name')}</th>
                        <th>{t('الهاتف', 'Phone')}</th><th>{t('المنطقة', 'Area')}</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {dups.map((d) => (
                        <tr key={d.id}>
                          <td className="num">{d.code}</td>
                          <td>{d.full_name}</td>
                          <td className="num">{displayPhone(d.phone)}</td>
                          <td>{d.area ?? '—'}</td>
                          <td><Link className="btn btn--sm" to={`/customers/${d.id}`}>{t('فتح', 'Open')}</Link></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
