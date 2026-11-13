// A small formatting editor like the old system's: undo/redo, bold, italic, underline, strikethrough,
// headings, bullet and numbered lists, and a table. The HTML it makes is cleaned (lib/html.js) before
// it's saved or shown, so only plain formatting is kept.
import { useEffect, useRef, useState } from 'react'
import { Bold, Code, Heading1, Heading2, Heading3, ImagePlus, Italic, Link2, List, ListOrdered, Palette, Redo2, Strikethrough, Table, Underline, Undo2, Unlink } from 'lucide-react'
import { sanitizeHtml, sanitizeSignature } from '../../lib/html.js'

const TOOLS = [
  [['undo', Undo2, 'Undo'], ['redo', Redo2, 'Redo']],
  [['bold', Bold, 'Bold'], ['italic', Italic, 'Italic'], ['underline', Underline, 'Underline'], ['strikeThrough', Strikethrough, 'Strikethrough']],
  [['h1', Heading1, 'Heading 1'], ['h2', Heading2, 'Heading 2'], ['h3', Heading3, 'Heading 3']],
  [['insertUnorderedList', List, 'Bullet List'], ['insertOrderedList', ListOrdered, 'Numbered List']],
  [['table', Table, 'Insert Table']],
]

// The email signature's toolbar (Inbox Settings): no headings or tables, but links, pictures and colour.
const SIG_TOOLS = [
  [['undo', Undo2, 'Undo'], ['redo', Redo2, 'Redo']],
  [['bold', Bold, 'Bold'], ['italic', Italic, 'Italic'], ['underline', Underline, 'Underline']],
  [['link', Link2, 'Add Link'], ['unlink', Unlink, 'Remove Link'], ['image', ImagePlus, 'Add Picture'], ['color', Palette, 'Text Colour']],
]
const COLOURS = [['#132A6E', 'Navy'], ['#0E7C78', 'Deep Teal'], ['#12A8A3', 'Teal'], ['#B4610F', 'Dark Apricot'], ['#5E6785', 'Grey'], ['#000000', 'Black']]

// variant "signature": the email signature editor, with an Edit HTML switch.
export default function RichText({ id, value, onChange, label, variant }) {
  const sig = variant === 'signature'
  const clean = sig ? sanitizeSignature : sanitizeHtml
  const box = useRef(null)
  const first = useRef(true)
  const range = useRef(null)
  const [ask, setAsk] = useState(null) // { kind: 'link' | 'image' | 'color', url }
  const [htmlMode, setHtmlMode] = useState(false)
  useEffect(() => { // set once (and when a different medication loads); typing doesn't reset the cursor
    if (htmlMode) return
    if (box.current && (first.current || document.activeElement !== box.current)) { box.current.innerHTML = clean(value); first.current = false }
  }, [value, htmlMode]) // eslint-disable-line react-hooks/exhaustive-deps
  const keep = () => { const sel = window.getSelection(); if (sel?.rangeCount && box.current?.contains(sel.anchorNode)) range.current = sel.getRangeAt(0).cloneRange() }
  const restore = () => { box.current?.focus(); const sel = window.getSelection(); if (range.current && sel) { sel.removeAllRanges(); sel.addRange(range.current) } }
  function run(cmd) {
    if (['link', 'image', 'color'].includes(cmd)) { keep(); setAsk(ask?.kind === cmd ? null : { kind: cmd, url: cmd === 'link' ? 'https://' : '' }); return }
    box.current?.focus()
    if (/^h[1-3]$/.test(cmd)) document.execCommand('formatBlock', false, cmd)
    else if (cmd === 'table') document.execCommand('insertHTML', false, '<table><tbody><tr><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr></tbody></table><p><br></p>')
    else document.execCommand(cmd)
    onChange(box.current.innerHTML)
  }
  function apply(extra) {
    const url = (ask.url || '').trim()
    restore()
    if (ask.kind === 'link' && /^(https?:\/\/\S+|mailto:\S+|tel:\S+)$/i.test(url)) {
      const sel = window.getSelection()
      if (sel && !sel.isCollapsed) document.execCommand('createLink', false, url)
      else document.execCommand('insertHTML', false, `<a href="${url.replace(/"/g, '&quot;')}">${url.replace(/^mailto:|^tel:/i, '').replace(/</g, '&lt;')}</a>`)
    } else if (ask.kind === 'image' && /^https:\/\/\S+$/i.test(url)) {
      document.execCommand('insertHTML', false, `<img src="${url.replace(/"/g, '&quot;')}" alt="" style="height:60px">`)
    } else if (ask.kind === 'color' && extra) {
      document.execCommand('styleWithCSS', false, true)
      document.execCommand('foreColor', false, extra)
    } else return
    setAsk(null)
    onChange(box.current.innerHTML)
  }
  const tools = sig ? SIG_TOOLS : TOOLS
  const urlOk = ask && (ask.kind === 'link' ? /^(https?:\/\/\S+\.\S+|mailto:\S+@\S+|tel:[+\d\s-]+)$/i : /^https:\/\/\S+\.\S+$/i).test((ask.url || '').trim())
  return (
    <div className="richtext">
      <div className="richtext-bar" role="toolbar" aria-label={`${label} formatting`}>
        {!htmlMode && tools.map((group, g) => (
          <span key={g} className="richtext-group">
            {group.map(([cmd, Icon, name]) => (
              <button key={cmd} type="button" className={`icon-btn${ask?.kind === cmd ? ' is-on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => run(cmd)} aria-label={name} title={name}><Icon /></button>
            ))}
          </span>
        ))}
        {sig && (
          <span className="richtext-group richtext-end">
            <button type="button" className={`icon-btn${htmlMode ? ' is-on' : ''}`} onClick={() => { setAsk(null); if (htmlMode) { first.current = true; onChange(clean(value)) } setHtmlMode(!htmlMode) }}
              aria-pressed={htmlMode} aria-label="Edit HTML" title={htmlMode ? 'Back to Formatting' : 'Edit HTML'}><Code /></button>
          </span>
        )}
      </div>
      {ask && (
        <div className="richtext-ask">
          {ask.kind === 'color' ? (
            <>{COLOURS.map(([c, n]) => <button key={c} type="button" className="swatch" style={{ background: c }} onMouseDown={(e) => e.preventDefault()} onClick={() => apply(c)} aria-label={n} title={n} />)}
              <button type="button" className="text-btn" onClick={() => setAsk(null)}>Cancel</button></>
          ) : (
            <>
              <input className="input" autoFocus value={ask.url} onChange={(e) => setAsk({ ...ask, url: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (urlOk) apply() } if (e.key === 'Escape') setAsk(null) }}
                aria-label={ask.kind === 'link' ? 'Link address' : 'Picture address'}
                placeholder={ask.kind === 'link' ? 'https://… , mailto:… or tel:…' : 'https://… address of a picture online'} />
              <button type="button" className="btn btn-quiet" onClick={() => apply()} disabled={!urlOk}>{ask.kind === 'link' ? 'Add Link' : 'Add Picture'}</button>
              <button type="button" className="text-btn" onClick={() => setAsk(null)}>Cancel</button>
            </>
          )}
        </div>
      )}
      {htmlMode ? (
        <textarea id={id} className="richtext-html" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} aria-label={`${label} HTML`} />
      ) : (
        <div id={id} ref={box} className={`richtext-box${sig ? ' richtext-sig' : ''}`} contentEditable role="textbox" aria-multiline="true" aria-label={label}
          onInput={(e) => onChange(e.currentTarget.innerHTML)}
          onPaste={(e) => { // paste as cleaned formatting, not the source's styles
            const html = e.clipboardData.getData('text/html')
            if (!html) return
            e.preventDefault()
            document.execCommand('insertHTML', false, clean(html))
          }} />
      )}
    </div>
  )
}

// Shows saved formatted text (cleaned again, to be safe).
export function RichView({ html }) {
  return <div className="richtext-view" dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />
}
