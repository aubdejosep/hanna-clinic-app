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

// Email signatures (Inbox Settings): plain formatting plus links (https, mailto, tel), pictures from https
// addresses, and simple text colour, size and alignment. Every other attribute and tag is dropped.
const SIG_ALLOWED = new Set(['p', 'br', 'strong', 'em', 'u', 's', 'div', 'span', 'a', 'img', 'table', 'tbody', 'tr', 'td', 'hr', 'small'])
const STYLE_OK = {
  color: /^(#[0-9a-f]{3,8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|[a-z]{3,20})$/i,
  'font-size': /^\d{1,2}(\.\d)?(px|pt|em|rem)$/,
  'font-weight': /^(normal|bold|[1-9]00)$/,
  'font-style': /^(normal|italic)$/,
  'text-decoration': /^(none|underline)$/,
  'text-align': /^(left|center|right)$/,
  'vertical-align': /^(top|middle|bottom)$/,
  padding: /^(\d{1,2}px\s*){1,4}$/,
  width: /^\d{1,3}px$/,
  height: /^\d{1,3}px$/,
}
const attr = (s, name) => { const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(s); return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null }
const q = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
const unq = (s) => String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
function safeStyle(s) {
  if (!s) return ''
  return unq(s).split(';').map((d) => d.split(':').map((x) => x.trim().toLowerCase()))
    .filter(([k, v]) => k && v && STYLE_OK[k] && STYLE_OK[k].test(v)).map(([k, v]) => `${k}:${v}`).join(';')
}
export function sanitizeSignature(html, max = 4000) {
  const src = String(html || '').replace(DROP_WITH_CONTENT, '').replace(/<!--[\s\S]*?-->/g, '').slice(0, max * 3)
  let out = ''
  let last = 0
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g
  const text = (s) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  for (let m = tag.exec(src); m; m = tag.exec(src)) {
    out += text(src.slice(last, m.index))
    last = tag.lastIndex
    let name = m[2].toLowerCase()
    name = RENAME[name] || name
    if (!SIG_ALLOWED.has(name) || /^h[1-3]$/.test(name)) continue
    if (m[1]) { if (!['br', 'img', 'hr'].includes(name)) out += `</${name}>`; continue }
    if (name === 'br' || name === 'hr') { out += `<${name}>`; continue }
    const style = safeStyle(attr(m[3], 'style'))
    let extra = ''
    if (name === 'a') {
      const href = unq(attr(m[3], 'href') || '').trim()
      if (/^(https:\/\/|http:\/\/|mailto:|tel:)/i.test(href)) extra += ` href="${q(href)}"`
    }
    if (name === 'img') {
      const src2 = unq(attr(m[3], 'src') || '').trim()
      if (!/^https:\/\//i.test(src2)) continue // no data: or http pictures
      extra += ` src="${q(src2)}" alt="${q(attr(m[3], 'alt') || '')}"`
      for (const k of ['width', 'height']) { const v = attr(m[3], k); if (v && /^\d{1,3}$/.test(v)) extra += ` ${k}="${v}"` }
    }
    out += `<${name}${extra}${style ? ` style="${q(style)}"` : ''}>`
  }
  out += text(src.slice(last))
  return out.slice(0, max)
}
