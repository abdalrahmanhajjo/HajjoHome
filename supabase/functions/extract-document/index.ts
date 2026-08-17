// =====================================================================
// وحدة الترحيل — المرحلة 2: استخراج OCR عبر Supabase Edge Function
//
// يقرأ الصفحة كاملة ويستخرج كل سجلّات الزبائن الموجودة فيها (لا زبونًا واحدًا)
// مع نصّ الصفحة الخام الكامل. يعمل على الخادم (المفاتيح لا تكون في المتصفح).
// يدعم Gemini (مجاني) و Anthropic. الناتج "اقتراحات" فقط (كل حقل uncertain).
//
// النشر:  supabase functions deploy extract-document
// المفتاح المجاني: supabase secrets set GEMINI_API_KEY=AIza...  (aistudio.google.com/app/apikey)
// =====================================================================

import { createClient } from 'npm:@supabase/supabase-js@2'
import { encodeBase64 } from 'jsr:@std/encoding/base64'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BUCKET = 'legacy-docs'

// حقول كل سجل زبون (هوية + عنوان + كفيل + ملخّص حساب قديم)
const FIELD_NAMES = [
  'full_name_ar', 'full_name_en', 'phone', 'phone2', 'national_id',
  'area', 'city', 'address', 'guarantor_name', 'guarantor_phone',
  'old_customer_ref', 'account_status', 'opening_balance', 'total_purchases', 'total_paid',
]

const SYSTEM =
  'أنت خبير في قراءة سجلات زبائن عربية مكتوبة بخط اليد لمحل أجهزة كهربائية. ' +
  'اقرأ الصفحة **كاملةً** بأقصى دقّة وعناية — من أعلاها لأسفلها، كل الأسطر والأعمدة والهوامش. ' +
  'الصفحة قد تحوي **عدّة زبائن** (سطر أو كتلة لكل زبون): استخرج **كل** زبون موجود في مصفوفة customers، ولا تُهمل أيًّا منهم. ' +
  'لكل زبون: الاسم، الهاتف، رقم الهوية، العنوان/المنطقة، الكفيل، ورقمه القديم، وأي أرقام مالية ظاهرة ' +
  '(الرصيد الافتتاحي opening_balance، إجمالي المشتريات total_purchases، إجمالي المدفوع total_paid). ' +
  'انسخ كل قيمة كما كُتبت تمامًا (بلا تصحيح للأسماء). راجِع الأرقام خانةً خانة وحوّل الأرقام العربية-الهندية (٠١٢٣٤٥٦٧٨٩) إلى غربية. ' +
  'انتبه للشطب والتصحيحات فوق القيم القديمة — اعتمد القيمة النهائية. إن ترددت اذكر البديل في notes. ' +
  'الحقل غير المقروء أو غير الموجود اجعله null — لا تخمّن ولا تخترع. ' +
  'ضع النصّ الخام الكامل لكل ما قرأته في الصفحة حرفيًا في raw_text.'
const USER_TEXT = 'اقرأ الصفحة كاملة واستخرج كل الزبائن الموجودين فيها.'

interface Field {
  fieldName: string
  rawValue: string | null
  normalizedValue: string | null
  status: 'clear' | 'uncertain' | 'unreadable' | 'missing'
}
interface RecordOut { fields: Field[] }
interface ExtractResult { provider: string; modelVersion: string | null; rawText: string; records: RecordOut[] }

function buildFields(rec: Record<string, unknown>): Field[] {
  return FIELD_NAMES.map((n) => {
    const v = rec[n]
    const val = v != null && String(v).trim() !== '' && String(v).trim().toLowerCase() !== 'null'
      ? String(v).trim() : null
    return { fieldName: n, rawValue: val, normalizedValue: val, status: val ? 'uncertain' : 'missing' } as Field
  })
}
// deno-lint-ignore no-explicit-any
function toRecords(customers: any): RecordOut[] {
  if (!Array.isArray(customers)) return []
  return customers.map((c) => ({ fields: buildFields(c ?? {}) }))
}

// ---- المزوّد المجاني: Google Gemini (عبر fetch) ----
async function extractWithGemini(base64: string, mediaType: string): Promise<ExtractResult> {
  const key = Deno.env.get('GEMINI_API_KEY')!
  // أعلى جودة افتراضيًا. للحجم الأكبر (حدّ مجاني أسخى): GEMINI_MODEL=gemini-2.5-flash
  const model = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-pro'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`

  const itemProps: Record<string, unknown> = { notes: { type: 'STRING', nullable: true } }
  for (const n of FIELD_NAMES) itemProps[n] = { type: 'STRING', nullable: true }
  const schema = {
    type: 'OBJECT',
    properties: {
      raw_text: { type: 'STRING' },
      customers: { type: 'ARRAY', items: { type: 'OBJECT', properties: itemProps } },
    },
  }

  const body = {
    system_instruction: { parts: [{ text: SYSTEM }] },
    contents: [{ parts: [{ inline_data: { mime_type: mediaType, data: base64 } }, { text: USER_TEXT }] }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 16384,   // متّسع للتفكير + صفحة كاملة بعدّة سجلّات
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  }
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 400)}`)
  const data = await res.json()
  // deno-lint-ignore no-explicit-any
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('')
  let parsed: Record<string, unknown> = {}
  try { parsed = JSON.parse(text) } catch { return { provider: 'gemini', modelVersion: model, rawText: text, records: [] } }
  return { provider: 'gemini', modelVersion: model, rawText: (parsed.raw_text as string) ?? text, records: toRecords(parsed.customers) }
}

// ---- Anthropic (اختياري — يُحمَّل ديناميكيًا) ----
async function extractWithAnthropic(base64: string, mediaType: string): Promise<ExtractResult> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')!
  const { default: Anthropic } = await import('npm:@anthropic-ai/sdk')
  const anthropic = new Anthropic({ apiKey })

  const itemProps: Record<string, unknown> = { notes: { type: ['string', 'null'] } }
  for (const n of FIELD_NAMES) itemProps[n] = { type: ['string', 'null'] }
  const inputSchema = {
    type: 'object',
    properties: {
      raw_text: { type: 'string' },
      customers: { type: 'array', items: { type: 'object', properties: itemProps } },
    },
    required: ['raw_text', 'customers'],
  }

  const isPdf = mediaType.includes('pdf')
  const sourceBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } }

  const modelName = Deno.env.get('ANTHROPIC_MODEL') || 'claude-3-5-sonnet-20241022'
  // deno-lint-ignore no-explicit-any
  const msg: any = await anthropic.messages.create({
    model: modelName,
    max_tokens: 8192,
    system: SYSTEM,
    // deno-lint-ignore no-explicit-any
    messages: [{ role: 'user', content: [sourceBlock as any, { type: 'text', text: USER_TEXT }] }],
    tools: [{ name: 'extract_page', description: 'Extract every customer record and the full raw text from the page', input_schema: inputSchema }],
    tool_choice: { type: 'tool', name: 'extract_page' },
  })
  // deno-lint-ignore no-explicit-any
  const tool = msg.content.find((b: any) => b.type === 'tool_use')
  if (!tool) throw new Error('Anthropic did not return a tool call')
  const parsed = tool.input as Record<string, unknown>
  return { provider: 'anthropic', modelVersion: msg.model ?? null, rawText: (parsed.raw_text as string) ?? '', records: toRecords(parsed.customers) }
}

function pickProvider(requested?: string): string {
  if (requested) return requested
  if (Deno.env.get('GEMINI_API_KEY')) return 'gemini'
  if (Deno.env.get('ANTHROPIC_API_KEY')) return 'anthropic'
  return 'none'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })

  try {
    const { documentId, provider } = await req.json()
    if (!documentId) return json(400, { error: 'documentId مطلوب' })

    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data: userData } = await userClient.auth.getUser()
    if (!userData?.user) return json(401, { error: 'غير مصرّح' })
    const { data: prof } = await userClient
      .from('profiles').select('role, migration_role, is_active').eq('id', userData.user.id).maybeSingle()
    const allowed = prof?.is_active && (
      prof.role === 'owner' || prof.role === 'accountant' ||
      prof.migration_role === 'operator' || prof.migration_role === 'reviewer'
    )
    if (!allowed) return json(403, { error: 'لا تملك صلاحية الترحيل' })

    const chosen = pickProvider(provider)
    if (chosen === 'none') return json(400, { error: 'لا مفتاح OCR مضبوط. اضبط GEMINI_API_KEY (مجاني) أو ANTHROPIC_API_KEY.' })

    const admin = createClient(SUPABASE_URL, SERVICE_KEY)
    const { data: doc } = await admin.from('migration_documents').select('*').eq('id', documentId).maybeSingle()
    if (!doc?.storage_path) return json(404, { error: 'لم يُعثر على المستند أو لا مسار تخزين' })
    const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(doc.storage_path)
    if (dlErr || !blob) return json(500, { error: 'تعذّر تنزيل المستند' })
    const base64 = encodeBase64(new Uint8Array(await blob.arrayBuffer()))
    const mediaType = doc.file_type || 'image/jpeg'

    const result = chosen === 'gemini'
      ? await extractWithGemini(base64, mediaType)
      : await extractWithAnthropic(base64, mediaType)

    // تخزين العملية والحقول (لا يُوثَّق شيء تلقائيًا). حقول كل سجل مُفهرسة i:field.
    const { data: run } = await admin.from('migration_extraction_runs').insert({
      document_id: documentId, provider: result.provider, model_version: result.modelVersion,
      raw_text: result.rawText, status: 'completed', created_by: userData.user.id,
    }).select('id').single()
    if (run) {
      const rows = result.records.flatMap((rec, i) =>
        rec.fields.map((f) => ({
          extraction_run_id: run.id, field_name: `${i}:${f.fieldName}`,
          raw_value: f.rawValue, normalized_value: f.normalizedValue, status: f.status,
        }))
      )
      if (rows.length) await admin.from('migration_extracted_fields').insert(rows)
    }
    await admin.from('migration_documents').update({ ocr_status: 'done', status: 'ocr_done' }).eq('id', documentId)

    return json(200, { rawText: result.rawText, records: result.records, provider: result.provider })
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) })
  }
})
