import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { useI18n } from '../../i18n/i18n'
import PageHeader from '../../components/PageHeader'
import { normalizeArabicName } from '../../migration/normalize'

interface Term { id: string; category: string; term: string; weight: number; is_active: boolean }

const CATEGORIES = [
  { v: 'name', ar: 'اسم', en: 'Name' }, { v: 'family', ar: 'عائلة', en: 'Family' },
  { v: 'city', ar: 'مدينة', en: 'City' }, { v: 'area', ar: 'منطقة', en: 'Area' },
  { v: 'brand', ar: 'ماركة', en: 'Brand' }, { v: 'model', ar: 'موديل', en: 'Model' },
  { v: 'phrase', ar: 'عبارة', en: 'Phrase' },
]

export default function Vocabulary() {
  const { t, lang } = useI18n()
  const { profile } = useAuth()
  const [rows, setRows] = useState<Term[]>([])
  const [category, setCategory] = useState('name')
  const [term, setTerm] = useState('')
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    let q = supabase.from('migration_vocabulary').select('id, category, term, weight, is_active').order('weight', { ascending: false }).limit(500)
    if (filter !== 'all') q = q.eq('category', filter)
    const { data, error } = await q
    if (error) setError(error.message)
    else setRows((data ?? []) as Term[])
  }
  useEffect(() => { void reload() }, [filter])

  async function add(e: FormEvent) {
    e.preventDefault(); setError(null)
    if (!term.trim()) return
    setBusy(true)
    const { error } = await supabase.from('migration_vocabulary').insert({
      category, term: term.trim(), normalized: normalizeArabicName(term.trim()), created_by: profile?.id ?? null,
    })
    setBusy(false)
    if (error) return setError(error.message)
    setTerm(''); reload()
  }

  return (
    <div>
      <PageHeader eyebrow={t('الترحيل', 'Migration')} title={t('القاموس العربي', 'Arabic Vocabulary')} subtitle={t('مصطلحات ومرادفات تحسّن دقّة القراءة', 'Terms and synonyms that improve recognition')} />
      {error && <div className="alert alert--danger">{error}</div>}

      <form className="card" onSubmit={add}>
        <div className="card__body row" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ maxWidth: 160 }}>
            <label>{t('الفئة', 'Category')}</label>
            <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c.v} value={c.v}>{t(c.ar, c.en)}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}><label>{t('المصطلح', 'Term')}</label><input className="input" value={term} onChange={(e) => setTerm(e.target.value)} /></div>
          <button className="btn btn--primary" disabled={busy}>{busy ? <span className="spinner" /> : t('إضافة', 'Add')}</button>
        </div>
      </form>

      <div className="field mt-4" style={{ maxWidth: 200 }}>
        <label>{t('تصفية', 'Filter')}</label>
        <select className="select" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">{t('الكل', 'All')}</option>
          {CATEGORIES.map((c) => <option key={c.v} value={c.v}>{t(c.ar, c.en)}</option>)}
        </select>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{t('الفئة', 'Category')}</th><th>{t('المصطلح', 'Term')}</th><th className="num">{t('الوزن', 'Weight')}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{CATEGORIES.find((c) => c.v === r.category)?.[lang] ?? r.category}</td>
                  <td>{r.term}</td>
                  <td className="num">{r.weight}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={3}><div className="empty">{t('لا مصطلحات.', 'No terms.')}</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
