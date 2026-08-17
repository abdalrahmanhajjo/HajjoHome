import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { useI18n } from '../../i18n/i18n'
import PageHeader from '../../components/PageHeader'
import { displayPhone } from '../../lib/phone'

interface Candidate {
  id: string
  customer_a: string
  customer_b: string | null
  live_customer_id: string | null
  score: number
  band: string | null
  indicators: { match?: string; value?: string } | null
}
interface StagingLite {
  id: string; code: string; full_name_ar: string | null; full_name_en: string | null
  phone: string | null; national_id: string | null; area: string | null
  raw_address: string | null; source_reference: string | null; document_id: string | null
}
interface LiveLite {
  id: string; code: string; full_name: string; phone: string | null; national_id: string | null; area: string | null
}

interface Side { title: string; name: string; phone: string | null; nid: string | null; area: string | null }

export default function Duplicates() {
  const { t } = useI18n()
  const { profile } = useAuth()
  const [cands, setCands] = useState<Candidate[]>([])
  const [staging, setStaging] = useState<Record<string, StagingLite>>({})
  const [live, setLive] = useState<Record<string, LiveLite>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function reload() {
    setLoading(true)
    const { data, error } = await supabase
      .from('migration_duplicate_candidates')
      .select('id, customer_a, customer_b, live_customer_id, score, band, indicators')
      .eq('status', 'open')
      .order('score', { ascending: false })
      .limit(200)
    if (error) { setError(error.message); setLoading(false); return }
    const list = (data ?? []) as Candidate[]
    setCands(list)

    const sIds = Array.from(new Set(list.flatMap((c) => [c.customer_a, c.customer_b].filter(Boolean) as string[])))
    const lIds = Array.from(new Set(list.map((c) => c.live_customer_id).filter(Boolean) as string[]))
    const [s, l] = await Promise.all([
      sIds.length ? supabase.from('migration_customers').select('id, code, full_name_ar, full_name_en, phone, national_id, area, raw_address, source_reference, document_id').in('id', sIds) : Promise.resolve({ data: [] }),
      lIds.length ? supabase.from('customers').select('id, code, full_name, phone, national_id, area').in('id', lIds) : Promise.resolve({ data: [] }),
    ])
    const sm: Record<string, StagingLite> = {}
    for (const r of (s.data ?? []) as StagingLite[]) sm[r.id] = r
    const lm: Record<string, LiveLite> = {}
    for (const r of (l.data ?? []) as LiveLite[]) lm[r.id] = r
    setStaging(sm); setLive(lm); setLoading(false)
  }
  useEffect(() => { void reload() }, [])

  async function scan() {
    setError(null); setMsg(null); setBusy(true)
    const { data, error } = await supabase.rpc('mig_detect_duplicates')
    setBusy(false)
    if (error) return setError(error.message)
    setMsg(t(`اكتمل الفحص — ${data} مرشّح`, `Scan complete — ${data} candidates`))
    reload()
  }

  async function resolve(c: Candidate, action: 'kept_separate' | 'ignored' | 'linked' | 'merged') {
    setError(null); setBusy(true)
    const stamp = { resolved_by: profile?.id ?? null, resolved_at: new Date().toISOString() }
    try {
      if (action === 'linked' && c.live_customer_id) {
        const a = staging[c.customer_a]
        await supabase.from('migration_customers').update({ status: 'imported', imported_customer_id: c.live_customer_id, duplicate_status: 'linked' }).eq('id', c.customer_a)
        await supabase.from('migration_source_links').insert({
          live_entity_type: 'customer', live_entity_id: c.live_customer_id,
          document_id: a?.document_id ?? null, source_reference: a?.source_reference ?? null,
          staging_entity_type: 'customer', staging_id: c.customer_a,
        })
      } else if (action === 'merged' && c.customer_b) {
        await supabase.from('migration_customers').update({ status: 'rejected', duplicate_status: 'merged' }).eq('id', c.customer_b)
      }
      const { error } = await supabase.from('migration_duplicate_candidates')
        .update({ status: action, ...stamp, resolution: { action } }).eq('id', c.id)
      if (error) throw new Error(error.message)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); setBusy(false); return
    }
    setBusy(false); reload()
  }

  function nameOf(s: StagingLite | undefined): string {
    return s ? (s.full_name_ar || s.full_name_en || s.code) : '—'
  }
  function sidesOf(c: Candidate): { a: Side; b: Side; live: boolean } {
    const a = staging[c.customer_a]
    const sa: Side = { title: t('سجل الترحيل', 'Staging'), name: nameOf(a), phone: a?.phone ?? null, nid: a?.national_id ?? null, area: a?.area ?? null }
    if (c.live_customer_id) {
      const lv = live[c.live_customer_id]
      return { a: sa, b: { title: t('زبون حيّ', 'Live customer'), name: lv?.full_name ?? '—', phone: lv?.phone ?? null, nid: lv?.national_id ?? null, area: lv?.area ?? null }, live: true }
    }
    const b = c.customer_b ? staging[c.customer_b] : undefined
    return { a: sa, b: { title: t('سجل ترحيل آخر', 'Other staging'), name: nameOf(b), phone: b?.phone ?? null, nid: b?.national_id ?? null, area: b?.area ?? null }, live: false }
  }

  if (loading) return <span className="spinner" />

  return (
    <div>
      <PageHeader
        eyebrow={t('الترحيل', 'Migration')}
        title={t('الزبائن المكررون', 'Duplicate Customers')}
        subtitle={t('اكتشِف ودمج الملفات المتطابقة', 'Detect and merge matching files')}
        actions={
          <button className="btn btn--primary" disabled={busy} onClick={() => void scan()}>
            {busy ? <span className="spinner" /> : t('فحص التكرار', 'Scan')}
          </button>
        }
      />
      {error && <div className="alert alert--danger">{error}</div>}
      {msg && <div className="alert alert--ok">{msg}</div>}

      {cands.length === 0 && <div className="empty">{t('لا مرشّحي تكرار. اضغط «فحص التكرار».', 'No candidates. Click "Scan".')}</div>}

      <div className="stack">
        {cands.map((c) => {
          const { a, b, live: isLive } = sidesOf(c)
          return (
            <div className="card" key={c.id}>
              <div className="card__header between">
                <span>
                  <span className={`badge ${c.score >= 90 ? 'badge--danger' : 'badge--warn'}`}>{c.band} — {c.score}%</span>
                  <span className="faint small" style={{ marginInlineStart: 8 }}>
                    {t('تطابق', 'Match')}: {c.indicators?.match === 'national_id' ? t('رقم الهوية', 'National ID') : t('الهاتف', 'Phone')}
                  </span>
                </span>
              </div>
              <div className="card__body">
                <div className="review-grid">
                  <SideBox side={a} />
                  <SideBox side={b} />
                </div>
                <div className="row mt-2">
                  {isLive ? (
                    <button className="btn btn--primary btn--sm" disabled={busy} onClick={() => void resolve(c, 'linked')}>
                      {t('ربط بالزبون الحيّ (عدم استيراد نسخة)', 'Link to live (no new copy)')}
                    </button>
                  ) : (
                    <button className="btn btn--primary btn--sm" disabled={busy} onClick={() => void resolve(c, 'merged')}>
                      {t('دمج (رفض الثاني)', 'Merge (reject second)')}
                    </button>
                  )}
                  <button className="btn btn--sm" disabled={busy} onClick={() => void resolve(c, 'kept_separate')}>{t('إبقاؤهما منفصلين', 'Keep separate')}</button>
                  <button className="btn btn--sm btn--ghost" disabled={busy} onClick={() => void resolve(c, 'ignored')}>{t('تجاهل', 'Ignore')}</button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SideBox({ side }: { side: Side }) {
  return (
    <div className="card" style={{ background: 'var(--c-surface-2)' }}>
      <div className="card__body">
        <div className="faint small">{side.title}</div>
        <div><strong>{side.name}</strong></div>
        <div className="num small">{displayPhone(side.phone)}</div>
        <div className="small">{side.nid ?? '—'}</div>
        <div className="small">{side.area ?? '—'}</div>
      </div>
    </div>
  )
}
