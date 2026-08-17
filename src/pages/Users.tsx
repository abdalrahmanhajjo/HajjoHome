import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../i18n/i18n'
import PageHeader from '../components/PageHeader'
import { useToast } from '../components/Toast'
import { roleLabel } from '../lib/format'
import type { Profile, UserRole } from '../lib/types'

const ROLES: UserRole[] = ['owner', 'sales', 'accountant', 'stock']

export default function Users() {
  const { profile, hasRole } = useAuth()
  const { t } = useI18n()
  const { toast } = useToast()
  const [rows, setRows] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [edit, setEdit] = useState<{ id: string; name: string } | null>(null)

  async function reload() {
    setLoading(true)
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, role, is_active')
      .order('full_name')
    if (error) setError(error.message)
    else setRows((data ?? []) as Profile[])
    setLoading(false)
  }
  useEffect(() => { void reload() }, [])

  if (!hasRole('owner')) return <div className="alert alert--warn">{t('هذه الصفحة للمدير فقط.', 'This page is for owners only.')}</div>
  if (loading) return <span className="spinner" />

  async function setRole(id: string, role: UserRole) {
    const { error } = await supabase.from('profiles').update({ role }).eq('id', id)
    if (error) toast(error.message, 'danger')
    else { toast(t('تم تحديث الدور', 'Role updated')); reload() }
  }
  async function setActive(id: string, is_active: boolean) {
    const { error } = await supabase.from('profiles').update({ is_active }).eq('id', id)
    if (error) toast(error.message, 'danger')
    else { toast(is_active ? t('تم التفعيل', 'Activated') : t('تم الإيقاف', 'Suspended')); reload() }
  }
  async function saveName() {
    if (!edit) return
    const name = edit.name.trim()
    if (!name) return
    const { error } = await supabase.from('profiles').update({ full_name: name }).eq('id', edit.id)
    if (error) toast(error.message, 'danger')
    else toast(t('تم حفظ الاسم', 'Name saved'))
    setEdit(null)
    reload()
  }

  return (
    <div>
      <PageHeader
        eyebrow={t('الإدارة', 'Administration')}
        title={t('المستخدمون', 'Users')}
        subtitle={t(`${rows.length} مستخدم`, `${rows.length} users`)}
      />
      {error && <div className="alert alert--danger">{error}</div>}

      <div className="grid grid--2">
        <AddUser onDone={reload} />

        <div className="card" style={{ alignSelf: 'start' }}>
          <div className="card__header">{t('المستخدمون', 'Users')} ({rows.length})</div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>{t('الاسم', 'Name')}</th><th>{t('الدور', 'Role')}</th><th>{t('الحالة', 'Status')}</th><th></th></tr></thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <td>
                      {edit?.id === u.id ? (
                        <div className="row" style={{ gap: 'var(--sp-1)', flexWrap: 'nowrap' }}>
                          <input className="input" value={edit.name} autoFocus
                            onChange={(e) => setEdit({ id: u.id, name: e.target.value })}
                            onKeyDown={(e) => { if (e.key === 'Enter') void saveName() }} />
                          <button className="btn btn--sm btn--primary" onClick={() => void saveName()}>{t('حفظ', 'Save')}</button>
                          <button className="btn btn--sm btn--ghost" onClick={() => setEdit(null)}>{t('إلغاء', 'Cancel')}</button>
                        </div>
                      ) : (
                        <>{u.full_name}{u.id === profile?.id && <span className="faint small"> {t('(أنت)', '(you)')}</span>}</>
                      )}
                    </td>
                    <td>
                      <select className="select" value={u.role} disabled={u.id === profile?.id}
                        onChange={(e) => setRole(u.id, e.target.value as UserRole)}>
                        {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                      </select>
                    </td>
                    <td>{u.is_active ? <span className="badge badge--ok">{t('مفعّل', 'Active')}</span> : <span className="badge badge--muted">{t('موقوف', 'Suspended')}</span>}</td>
                    <td>
                      <div className="row" style={{ gap: 'var(--sp-1)', flexWrap: 'nowrap' }}>
                        <button className="btn btn--sm btn--ghost" onClick={() => setEdit({ id: u.id, name: u.full_name })}>{t('تعديل', 'Edit')}</button>
                        {u.id !== profile?.id && (
                          <button className="btn btn--sm" onClick={() => setActive(u.id, !u.is_active)}>
                            {u.is_active ? t('إيقاف', 'Suspend') : t('تفعيل', 'Activate')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

function AddUser({ onDone }: { onDone: () => void }) {
  const { t } = useI18n()
  const [uid, setUid] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<UserRole>('sales')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const uuidOk = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid.trim())

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null); setMsg(null)
    if (!uuidOk) return setError(t('مُعرّف المستخدم غير صحيح (UUID)', 'Invalid user ID (UUID)'))
    if (!name.trim()) return setError(t('الاسم مطلوب', 'Name is required'))
    setBusy(true)
    const { error } = await supabase.from('profiles').insert({ id: uid.trim(), full_name: name.trim(), role })
    setBusy(false)
    if (error) return setError(error.message)
    setUid(''); setName(''); setRole('sales'); setMsg(t('تمت إضافة المستخدم', 'User added'))
    onDone()
  }

  return (
    <form className="card" onSubmit={submit} style={{ alignSelf: 'start' }}>
      <div className="card__header">{t('إضافة مستخدم', 'Add user')}</div>
      <div className="card__body">
        <p className="faint small">{t('أنشئ المستخدم أولًا في Supabase → Authentication، ثم الصق مُعرّفه (UID) هنا لتحديد دوره.', 'Create the user first in Supabase → Authentication, then paste their UID here to assign a role.')}</p>
        {error && <div className="alert alert--danger">{error}</div>}
        {msg && <div className="alert alert--ok">{msg}</div>}
        <div className="field"><label>{t('مُعرّف المستخدم (UID)', 'User ID (UID)')}</label><input className="input num" dir="ltr" value={uid} onChange={(e) => setUid(e.target.value)} placeholder="xxxxxxxx-xxxx-..." /></div>
        <div className="field"><label>{t('الاسم', 'Name')}</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label>{t('الدور', 'Role')}</label>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </select>
        </div>
        <button className="btn btn--primary btn--block" disabled={busy}>{busy ? <span className="spinner" /> : t('إضافة', 'Add')}</button>
      </div>
    </form>
  )
}
