// Theme and text size for this person (Settings). Saved on the server (follows them to any device)
// and in this browser (public/theme-boot.js applies it before the first paint).
export const THEMES = [
  { key: 'brand', label: 'Hanna Pet - Brand Colors', text: 'The clinic’s cream, navy and teal. Soft and calm.' },
  { key: 'contrast', label: 'High Contrast', text: 'White and light grey with darker text and stronger outlines. Easier to read on bright screens.' },
  { key: 'classic', label: 'Teal Sidebar', text: 'A deep teal sidebar with white text, a white page and teal buttons.' },
]
export const TEXT_SIZES = [
  { key: 'standard', label: 'Standard' },
  { key: 'large', label: 'Large' },
  { key: 'larger', label: 'Larger' },
]

import { cleanFonts, FONT_PARTS } from '../../lib/fonts.js'

// Fonts: data-font-head="heros" etc. on <html>, and data-menu-weight. Without them (the login page, a first
// visit) the CSS default is the system font with a regular menu, the same as DEFAULT_FONTS.
function applyFonts(root, fonts) {
  const f = cleanFonts(fonts)
  for (const p of FONT_PARTS) root.dataset[`font${p.key[0].toUpperCase()}${p.key.slice(1)}`] = f[p.key]
  root.dataset.menuWeight = f.menuWeight
  return f
}

export function applyDisplay({ theme, textSize, fonts }) {
  const root = document.documentElement
  const f = applyFonts(root, fonts)
  if (theme && theme !== 'brand') root.dataset.theme = theme
  else delete root.dataset.theme
  if (textSize && textSize !== 'standard') root.dataset.text = textSize
  else delete root.dataset.text
  try { localStorage.setItem('hpw.display', JSON.stringify({ theme, textSize, fonts: f })) } catch { /* private window */ }
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = theme && theme !== 'brand' ? '#F1F3F6' : '#FBF7F0'
}
