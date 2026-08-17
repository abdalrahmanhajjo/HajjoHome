// تبديل الوضع الفاتح/الداكن (ثيم StoreFlow: فاتح افتراضي + مبدّل).
// كل الألوان متغيّرات في tokens.css؛ كتلة [data-theme='dark'] تتجاوزها،
// فقلب السمة على <html> يبدّل الثيم. الاختيار يُحفَظ لكل متصفّح.
export type Theme = 'light' | 'dark'

const KEY = 'app_theme'

export function getTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function applyTheme(theme: Theme) {
  if (theme === 'dark') document.documentElement.dataset.theme = 'dark'
  else delete document.documentElement.dataset.theme
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // الوضع الخاص / التخزين معطّل — يبقى الثيم مطبَّقًا لهذه الجلسة
  }
  applyTheme(theme)
}
