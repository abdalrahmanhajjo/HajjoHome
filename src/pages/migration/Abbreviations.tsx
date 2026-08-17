import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { useI18n } from '../../i18n/i18n'
import PageHeader from '../../components/PageHeader'

interface Abbr { id: string; abbreviation: string; meaning: string; context: string | null; is_active: boolean }

export default function Abbreviations() {
  const { t } = useI18n()
  const { profile } = useAuth()
  const [rows, setRows] = useState<Abbr[]>([])
  const [ab, setAb] = useState('')
  const [meaning, setMeaning] = useState('')
  const [context, setContext] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    const { data, error } = await supabase
      .from('migration_abbreviations')
      .select('id, abbreviation, meaning, context, is_active')
      .order('abbreviation')
      .limit(500)
    if (error) setError(error.message)
    else setRows((data ?? []) as Abbr[])
  }
  useEffect(() => { void reload() }, [])

  async function add(e: FormEvent) {
    e.preventDefault(); setError(null)
    if (!ab.trim() || !meaning.trim()) return setError(t('الاختصار والمعنى مطلوبان', 'Abbreviation and meaning required'))
    setBusy(true)
    const { error } = await supabase.from('migration_abbreviations').insert({
      abbreviation: ab.trim(), meaning: meaning.trim(), context: context.trim() || null, approved_by: profile?.id ?? null,
    })
    setBusy(false)
    if (error) return setError(error.message)
    setAb(''); setMeaning(''); setContext(''); reload()
  }

  return (
    <div>
      <PageHeader eyebrow={t('الترحيل', 'Migration')} title={t('الاختصارات', 'Abbreviations')} subtitle={t('اختصارات الكتابة اليدوية ومعانيها', 'Handwriting abbreviations and their meanings')} />
      {error && <div className="alert alert--danger">{error}</div>}
      <p className="faint small">{t('الاختصار نفسه قد يعني أشياء مختلفة حسب السياق — لا يُطبَّق تلقائيًا، بل يرفع ترتيب الاقتراح.',
        'The same abbreviation may mean different things by context — never auto-applied, only ranks suggestions.')}</p>

      <form className="card mt-2" onSubmit={add}>
        <div className="card__body row" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ maxWidth: 120 }}><label>{t('الاختصار', 'Abbrev.')}</label><input className="input" value={ab} onChange={(e) => setAb(e.target.value)} /></div>
          <div className="field" style={{ flex: 1 }}><label>{t('المعنى', 'Meaning')}</label><input className="input" value={meaning} onChange={(e) => setMeaning(e.target.value)} /></div>
          <div className="field" style={{ flex: 1 }}><label>{t('السياق', 'Context')}</label><input className="input" value={context} onChange={(e) => setContext(e.target.value)} /></div>
          <button className="btn btn--primary" disabled={busy}>{busy ? <span className="spinner" /> : t('إضافة', 'Add')}</button>
        </div>
      </form>

      <div className="card mt-4">
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{t('الاختصار', 'Abbrev.')}</th><th>{t('المعنى', 'Meaning')}</th><th>{t('السياق', 'Context')}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}><td className="num">{r.abbreviation}</td><td>{r.meaning}</td><td>{r.context ?? '—'}</td></tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={3}><div className="empty">{t('لا اختصارات.', 'No abbreviations.')}</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
