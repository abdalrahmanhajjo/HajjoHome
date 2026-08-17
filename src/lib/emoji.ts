/* ---------------------------------------------------------------------
   إيموجي المنتجات والفئات — على نمط StoreFlow لكن بالإيموجي فقط (بلا صور).
   يختار إيموجي مناسبًا لكل مجال/فئة/منتج في محل أجهزة كهربائية اعتمادًا
   على كلمات مفتاحية بالعربية والإنجليزية. أول قاعدة تتطابق تفوز، لذا رتّبها
   من الأخصّ إلى الأعمّ.
   --------------------------------------------------------------------- */

interface Rule { emoji: string; kw: string[] }

const RULES: Rule[] = [
  { emoji: '🧊', kw: ['ثلاج', 'براد', 'fridge', 'refriger', 'freezer', 'فريزر', 'مجمد'] },
  { emoji: '🫧', kw: ['غسال', 'wash', 'laundry', 'غسيل'] },
  { emoji: '🧺', kw: ['نشاف', 'مجفف', 'dryer', 'تجفيف'] },
  { emoji: '📺', kw: ['تلفز', 'شاشة', 'tv', 'televi', 'screen', 'display', 'led tv', 'lcd'] },
  { emoji: '❄️', kw: ['مكيف', 'مكيّف', 'تكييف', 'a/c', 'air condition', 'aircon', 'split', 'سبليت', 'كونديشن'] },
  { emoji: '🪭', kw: ['مبرد صحراوي', 'صحراوي', 'air cooler', 'desert cooler'] },
  { emoji: '🌀', kw: ['مروح', 'fan', 'ventilat', 'مراوح'] },
  { emoji: '💨', kw: ['شفاط', 'hood', 'extractor', 'مدخنة', 'شفاطة'] },
  { emoji: '🔥', kw: ['فرن', 'oven', 'طباخ', 'غاز', 'stove', 'cooker', 'موقد', 'بوتاجاز', 'grill', 'شواي'] },
  { emoji: '📡', kw: ['مايكرو', 'microwave', 'ميكرو'] },
  { emoji: '🍞', kw: ['محمص', 'toaster', 'توستر', 'خبز', 'صمون'] },
  { emoji: '🫖', kw: ['غلاي', 'kettle', 'ركوة', 'قهوة', 'coffee', 'شاي', 'اسبريسو', 'espresso', 'ترمس'] },
  { emoji: '🥤', kw: ['خلاط', 'blender', 'عصار', 'juicer', 'mixer', 'عجان', 'محضّر', 'محضر', 'مفرمة', 'grinder', 'فرامة'] },
  { emoji: '👔', kw: ['مكوا', 'مكواة', 'iron', 'كوي', 'ستيمر', 'steamer'] },
  { emoji: '♨️', kw: ['سخان', 'heater', 'boiler', 'شوفاج', 'تدفئة', 'دفاي', 'مدفأة', 'water heater'] },
  { emoji: '🧹', kw: ['مكنس', 'vacuum', 'كنس', 'شفط الغبار'] },
  { emoji: '🔊', kw: ['سماع', 'speaker', 'صوت', 'audio', 'مضخم', 'amplifier', 'ستيريو', 'stereo', 'مسجل', 'ساوند'] },
  { emoji: '📱', kw: ['جوال', 'هاتف', 'phone', 'موبايل', 'mobile', 'smartphone'] },
  { emoji: '💻', kw: ['لابتوب', 'laptop', 'حاسوب', 'كمبيوتر', 'computer', 'notebook', 'تابلت', 'tablet'] },
  { emoji: '💡', kw: ['مصباح', 'إضاءة', 'اضاءة', 'lamp', 'light', 'led', 'لمبة', 'ثريا', 'نجفة', 'كشاف', 'spot'] },
  { emoji: '🔌', kw: ['كابل', 'سلك', 'cable', 'wire', 'قابس', 'مقبس', 'socket', 'plug', 'وصلة', 'مشترك', 'تمديد', 'extension'] },
  { emoji: '🔋', kw: ['بطار', 'battery', 'ups', 'شاحن', 'charger', 'انفرتر', 'inverter', 'محول', 'transformer', 'stabilizer', 'منظم'] },
  { emoji: '🧴', kw: ['سشوار', 'مجفف شعر', 'hair dryer', 'حلاق', 'trimmer', 'ماكينة حلاقة', 'shaver'] },
  { emoji: '⚙️', kw: ['قطع', 'غيار', 'spare', 'part', 'اكسسوار', 'accessor', 'ملحق'] },
]

const DEFAULT_EMOJI = '📦'

/** يختار إيموجي حسب أول قاعدة تتطابق مع أيّ من النصوص المُمرّرة. */
export function pickEmoji(...texts: (string | null | undefined)[]): string {
  const hay = texts.filter(Boolean).join(' ').toLowerCase()
  if (!hay.trim()) return DEFAULT_EMOJI
  for (const r of RULES) {
    if (r.kw.some((k) => hay.includes(k))) return r.emoji
  }
  return DEFAULT_EMOJI
}

/** إيموجي الفئة من اسمها. */
export function categoryEmoji(name?: string | null): string {
  return pickEmoji(name)
}

/** إيموجي المنتج: يعتمد على اسم الفئة أولًا ثم الماركة/الموديل/الوصف. */
export function productEmoji(p: {
  brand?: string | null
  model?: string | null
  description?: string | null
}, categoryName?: string | null): string {
  return pickEmoji(categoryName, p.description, p.model, p.brand)
}
