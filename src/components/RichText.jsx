// A small formatting editor like the old system's: undo/redo, bold, italic, underline, strikethrough,
// headings, bullet and numbered lists, and a table. The HTML it makes is cleaned (lib/html.js) before
// it's saved or shown, so only plain formatting is kept.
import { useEffect, useRef } from 'react'
import { Bold, Heading1, Heading2, Heading3, Italic, List, ListOrdered, Redo2, Strikethrough, Table, Underline, Undo2 } from 'lucide-react'
import { sanitizeHtml } from '../../lib/html.js'

const TOOLS = [
  [['undo', Undo2, 'Undo'], ['redo', Redo2, 'Redo']],
  [['bold', Bold, 'Bold'], ['italic', Italic, 'Italic'], ['underline', Underline, 'Underline'], ['strikeThrough', Strikethrough, 'Strikethrough']],
  [['h1', Heading1, 'Heading 1'], ['h2', Heading2, 'Heading 2'], ['h3', Heading3, 'Heading 3']],
  [['insertUnorderedList', List, 'Bullet List'], ['insertOrderedList', ListOrdered, 'Numbered List']],
  [['table', Table, 'Insert Table']],
]

export default function RichText({ id, value, onChange, label }) {
  const box = useRef(null)
  const first = useRef(true)
  useEffect(() => { // set once (and when a different medication loads); typing doesn't reset the cursor
    if (box.current && (first.current || document.activeElement !== box.current)) { box.current.innerHTML = sanitizeHtml(value); first.current = false }
  }, [value])
  function run(cmd) {
    box.current?.focus()
    if (/^h[1-3]$/.test(cmd)) document.execCommand('formatBlock', false, cmd)
    else if (cmd === 'table') document.execCommand('insertHTML', false, '<table><tbody><tr><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr></tbody></table><p><br></p>')
    else document.execCommand(cmd)
    onChange(box.current.innerHTML)
  }
  return (
    <div className="richtext">
      <div className="richtext-bar" role="toolbar" aria-label={`${label} formatting`}>
        {TOOLS.map((group, g) => (
          <span key={g} className="richtext-group">
            {group.map(([cmd, Icon, name]) => (
              <button key={cmd} type="button" className="icon-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => run(cmd)} aria-label={name} title={name}><Icon /></button>
            ))}
          </span>
        ))}
      </div>
      <div id={id} ref={box} className="richtext-box" contentEditable role="textbox" aria-multiline="true" aria-label={label}
        onInput={(e) => onChange(e.currentTarget.innerHTML)}
        onPaste={(e) => { // paste as cleaned formatting, not the source's styles
          const html = e.clipboardData.getData('text/html')
          if (!html) return
          e.preventDefault()
          document.execCommand('insertHTML', false, sanitizeHtml(html))
        }} />
    </div>
  )
}

// Shows saved formatted text (cleaned again, to be safe).
export function RichView({ html }) {
  return <div className="richtext-view" dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />
}
