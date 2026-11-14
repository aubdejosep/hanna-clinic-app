// Account ▸ Settings ▸ Font (per person): which of three fonts each part of the app uses, and how bold the
// menu is. Shared by the server (saving) and the screens (applying, via data-font-* on <html>).
export const FONTS = [
  { key: 'heros', label: 'TeX Gyre Heros', text: 'A Helvetica-style font.' },
  { key: 'montserrat', label: 'Montserrat', text: 'Rounder and wider, as on the website and the gym’s headings.' },
  { key: 'system', label: 'System (Segoe UI)', text: 'The default. The device’s own font: Segoe UI on Windows, San Francisco on Mac and iPhone. Sharp and loads instantly.' },
]
export const FONT_PARTS = [
  { key: 'head', label: 'Headings', text: 'Page and card titles, names, big numbers.' },
  { key: 'menu', label: 'Menu', text: 'The menu on the left (or the phone menu).' },
  { key: 'text', label: 'Text', text: 'Everything else: lists, forms, notes, tables.' },
  { key: 'button', label: 'Buttons and Tabs', text: 'Buttons, tabs and chips.' },
]
export const MENU_WEIGHTS = [
  { key: 'regular', label: 'Regular' },
  { key: 'semibold', label: 'Semibold' },
  { key: 'bold', label: 'Bold' },
]
// The default for everyone who hasn't chosen (owners' choice, Nov 2026): the system font everywhere, a regular-weight menu.
export const DEFAULT_FONTS = { head: 'system', menu: 'system', text: 'system', button: 'system', menuWeight: 'regular' }

export function cleanFonts(raw) {
  let v = raw
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { v = null } }
  const out = { ...DEFAULT_FONTS }
  if (v && typeof v === 'object') {
    for (const p of FONT_PARTS) if (FONTS.some((f) => f.key === v[p.key])) out[p.key] = v[p.key]
    if (MENU_WEIGHTS.some((w) => w.key === v.menuWeight)) out.menuWeight = v.menuWeight
  }
  return out
}
