// Formatted text from the rich text editor (medication descriptions): only plain formatting survives.
// Every attribute is dropped and anything that isn't on the list (scripts, styles, links, images, frames)
// is removed, so stored text can be shown safely. Shared by the server and the screens (no imports).

const ALLOWED = new Set(['p', 'br', 'strong', 'em', 'u', 's', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'span', 'blockquote'])
const RENAME = { b: 'strong', i: 'em', strike: 's', del: 's', h4: 'h3', h5: 'h3', h6: 'h3' }
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|template|svg|math|noscript)\b[\s\S]*?<\/\1\s*>/gi

export function sanitizeHtml(html, max = 20000) {
  const src = String(html || '').replace(DROP_WITH_CONTENT, '').replace(/<!--[\s\S]*?-->/g, '').slice(0, max * 2)
  let out = ''
  let last = 0
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g
  const text = (s) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  for (let m = tag.exec(src); m; m = tag.exec(src)) {
    out += text(src.slice(last, m.index))
    last = tag.lastIndex
    let name = m[2].toLowerCase()
    name = RENAME[name] || name
    if (!ALLOWED.has(name)) continue
    out += name === 'br' ? (m[1] ? '' : '<br>') : `<${m[1]}${name}>`
  }
  out += text(src.slice(last))
  return out.slice(0, max)
}

// Plain text for lists and search: tags become spaces, common entities decoded.
export function htmlText(html) {
  return String(html || '').replace(/<(br|\/p|\/div|\/li|\/h[1-3]|\/tr)\s*>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim()
}
