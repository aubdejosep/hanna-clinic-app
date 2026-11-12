// Theme and text size for this person (Settings). Saved on the server (follows them to any device)
// and in this browser (public/theme-boot.js applies it before the first paint).
export const THEMES = [
  { key: 'brand', label: 'Hanna Pet - Brand Colors', text: 'The clinic’s cream, navy and teal. Soft and calm.' },
  { key: 'contrast', label: 'High Contrast', text: 'White and light grey with darker text and stronger outlines. Easier to read on bright screens.' },
  { key: 'clear', label: 'Large & Clear', text: 'High Contrast with bigger text everywhere, including small labels.' },
]
export const TEXT_SIZES = [
  { key: 'standard', label: 'Standard' },
  { key: 'large', label: 'Large' },
  { key: 'larger', label: 'Larger' },
]

export function applyDisplay({ theme, textSize }) {
  const root = document.documentElement
  if (theme && theme !== 'brand') root.dataset.theme = theme
  else delete root.dataset.theme
  if (textSize && textSize !== 'standard') root.dataset.text = textSize
  else delete root.dataset.text
  try { localStorage.setItem('hpw.display', JSON.stringify({ theme, textSize })) } catch { /* private window */ }
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = theme && theme !== 'brand' ? '#F1F3F6' : '#FBF7F0'
}
