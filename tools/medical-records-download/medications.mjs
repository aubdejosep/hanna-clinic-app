// Reads the old system's Smart Prescription ▸ Medication List: for every medication it opens the view
// window (eye icon) and the Edit page, reads them, and goes back with Cancel. It never clicks Update
// Medication or the delete icon, so nothing changes. Runs on the clinic owner's PC in its own Chrome
// window. You log in yourself.
//
//   npm run medications          -> every medication (about 36; a few minutes)
//   npm run medications-test     -> the first 3 only, to check it works
//
// Options: --limit N  --out <folder>  --browser-path <chrome.exe>  --url <medication list url>
//
// Output (default: ./output-medications):
//   medications.json   every medication: name, description (with its formatting), date added,
//                      dosages (amount, unit, type), variations, and its image file name
//   images/            the medication images
//   medications.csv    one line per medication, to look at in Excel
//   debug/             a screenshot + page copy whenever something looks off
//   login-state.json   your old-system login. Delete it when done.
// Then: clinic app ▸ Smart Prescription ▸ Medication List ▸ Import from Old System ▸ pick this folder.

import { chromium } from 'playwright-core'
import { createInterface } from 'node:readline'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = parseArgs(process.argv.slice(2))
const LIST_URL = args.url || 'https://hanna-pet.vetassist.app/pharmacology'
const OUT = resolve(args.out || 'output-medications')
const LIMIT = args.limit ? Number(args.limit) : Infinity
const DEBUG = join(OUT, 'debug')
const IMAGES = join(OUT, 'images')
const JSON_FILE = join(OUT, 'medications.json')
const CSV = join(OUT, 'medications.csv')
const LOGIN_STATE = join(OUT, 'login-state.json')
mkdirSync(DEBUG, { recursive: true })
mkdirSync(IMAGES, { recursive: true })

function parseArgs(list) {
  const out = {}
  for (let i = 0; i < list.length; i++) {
    if (!list[i].startsWith('--')) continue
    const key = list[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    const next = list[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = true
    else { out[key] = next; i++ }
  }
  return out
}
const log = (...m) => console.log(`[${new Date().toLocaleTimeString()}]`, ...m)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const slug = (s) => String(s).normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 50)
function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((done) => rl.question(question, () => { rl.close(); done() }))
}
async function snapshot(page, label) {
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${slug(label)}`
  try {
    await page.screenshot({ path: join(DEBUG, `${name}.png`), fullPage: true })
    writeFileSync(join(DEBUG, `${name}.html`), await page.content())
    log(`  Saved a screenshot and page copy to debug/${name}.*`)
  } catch { /* page may be gone */ }
}
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`

const results = existsSync(JSON_FILE) ? JSON.parse(readFileSync(JSON_FILE, 'utf8')) : []
function save() {
  writeFileSync(JSON_FILE + '.tmp', JSON.stringify(results, null, 2))
  renameSync(JSON_FILE + '.tmp', JSON_FILE)
  const lines = [['medication', 'date_added', 'description', 'dosages', 'variations', 'image'].join(',')]
  for (const m of results) {
    lines.push([m.name, m.dateAdded, m.descriptionText, m.dosages.map((d) => [d.amount, d.unit, d.type].filter(Boolean).join(' ')).join(' | '),
      m.variations.map((v) => v.fields.map((f) => `${f.label}: ${f.value}`).join('; ')).join(' | '), m.image || ''].map(csvCell).join(','))
  }
  try { writeFileSync(CSV, '\uFEFF' + lines.join('\n') + '\n') } catch (err) {
    if (['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) log('medications.csv is open in Excel, so it wasn’t updated. medications.json has everything.')
    else throw err
  }
}

// ---------- The list ----------
async function waitForTable(page) {
  await page.locator('table tbody tr').first().waitFor({ state: 'visible', timeout: 60000 })
  await sleep(800)
}
async function setRowsPerPage(page) {
  const label = page.getByText(/rows per page/i).first()
  if (!(await label.isVisible().catch(() => false))) return
  const box = label.locator('xpath=..')
  const current = (await box.innerText().catch(() => '')).match(/\d+/)?.[0]
  if (current === '100') return
  const select = box.locator('select')
  if (await select.count()) await select.first().selectOption('100')
  else {
    await box.locator('button, [role="combobox"]').first().click()
    await page.getByRole('option', { name: '100', exact: true }).or(page.getByText('100', { exact: true }).last()).first().click()
  }
  await waitForTable(page)
}
async function readList(page) {
  return page.locator('table').first().evaluate((table) => {
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.innerText.trim().toLowerCase())
    const col = (re) => heads.findIndex((h) => re.test(h))
    const at = { name: col(/medication/), details: col(/detail/), date: col(/date/), actions: col(/action/) }
    return [...table.querySelectorAll('tbody tr')].map((tr, index) => {
      const tds = [...tr.querySelectorAll('td')]
      const text = (i) => (i >= 0 && tds[i] ? tds[i].innerText.replace(/\s+/g, ' ').trim() : '')
      return { index, name: text(at.name), details: text(at.details), dateAdded: text(at.date), actionsCol: at.actions >= 0 ? at.actions : tds.length - 1 }
    })
  })
}
// The row's action buttons, without the delete one (red / "delete" / trash), in order: view, edit.
async function safeButtons(page, row) {
  const cell = page.locator('table tbody tr').nth(row.index).locator('td').nth(row.actionsCol)
  const all = cell.locator('button, a, [role="button"]')
  const n = await all.count()
  const keep = []
  for (let i = 0; i < n; i++) {
    const b = all.nth(i)
    const hint = await b.evaluate((el) => [el.className, el.getAttribute('aria-label'), el.getAttribute('title'), el.innerHTML].join(' ').toLowerCase())
    if (/delete|trash|destructive|red-|text-red|remove/.test(hint)) continue
    keep.push(b)
  }
  return keep
}

// ---------- Reading a page or window ----------
async function readFields(root) {
  return root.evaluate((el) => {
    const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
    const fields = []
    let lastLabel = ''
    let lastHeading = ''
    const nodes = el.querySelectorAll('h1, h2, h3, h4, label, input, textarea, select, [role="combobox"], [contenteditable="true"]')
    for (const e of nodes) {
      if (/^H[1-4]$/.test(e.tagName) && !e.closest('[contenteditable="true"]')) { lastHeading = clean(e.innerText); continue }
      if (e.tagName === 'LABEL' && !e.querySelector('input, textarea, select')) { lastLabel = clean(e.innerText).replace(/\s*\*$/, ''); continue }
      if (e.tagName === 'LABEL') continue
      if (!e.getClientRects().length || e.type === 'hidden' || e.type === 'file') continue
      if (e.tagName === 'INPUT' && e.closest('[role="combobox"]') && e.closest('[role="combobox"]') !== e) continue
      let value
      let html
      if (e.getAttribute('contenteditable') === 'true') { value = clean(e.innerText); html = e.innerHTML }
      else if (e.tagName === 'SELECT') value = e.options[e.selectedIndex]?.text
      else if (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA') value = e.value
      else value = clean(e.innerText)
      const label = e.getAttribute('aria-label') || (e.id && el.querySelector(`label[for="${CSS.escape(e.id)}"]`)?.innerText) || lastLabel
      fields.push({ section: lastHeading, label: clean(label).replace(/\s*\*$/, ''), value: clean(value), ...(html ? { html } : {}) })
    }
    const imgs = [...el.querySelectorAll('img')].filter((i) => i.getClientRects().length && i.naturalWidth > 40).map((i) => i.currentSrc || i.src)
    return { fields, images: imgs, text: el.innerText }
  })
}
function shape(row, view, edit) {
  const f = edit.fields
  const name = f.find((x) => /medication name/i.test(x.label))?.value || row.name
  const desc = f.find((x) => x.html !== undefined) || f.find((x) => /description/i.test(x.label))
  // Dosages: groups of Dosage Amount / Unit / Dosage Type under "Dosages"; variations: everything under "Medication Variations".
  const dosages = []
  const variations = []
  let current = null
  for (const x of f) {
    if (/variation/i.test(x.section)) {
      if (/name|variation/i.test(x.label) || !variations.length) variations.push({ fields: [] })
      variations[variations.length - 1].fields.push({ label: x.label, value: x.value })
      continue
    }
    if (/dosage amount|^amount/i.test(x.label)) { current = { amount: x.value, unit: '', type: '' }; dosages.push(current) } else if (current && /^unit/i.test(x.label)) current.unit = x.value
    else if (current && /dosage type|^type/i.test(x.label)) current.type = x.value
  }
  return {
    name,
    dateAdded: row.dateAdded,
    descriptionHtml: desc?.html || '',
    descriptionText: desc?.value || '',
    dosages,
    variations: variations.filter((v) => v.fields.some((y) => y.value)),
    image: null,
    list: { name: row.name, details: row.details, dateAdded: row.dateAdded },
    view: { text: view.text, images: view.images },
    edit: { fields: f, images: edit.images, url: edit.url },
  }
}
async function saveImage(page, src, name) {
  if (!src) return null
  try {
    let buf
    let ext = 'jpg'
    if (src.startsWith('data:')) {
      const m = src.match(/^data:image\/(\w+);base64,(.+)$/)
      if (!m) return null
      ext = m[1].replace('jpeg', 'jpg')
      buf = Buffer.from(m[2], 'base64')
    } else {
      const res = await page.request.get(src)
      if (!res.ok()) return null
      const type = res.headers()['content-type'] || ''
      ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg'
      buf = await res.body()
    }
    const file = `${slug(name)}.${ext}`
    writeFileSync(join(IMAGES, file), buf)
    return file
  } catch { return null }
}
async function guard(page) { // a delete confirmation must never be accepted
  const confirm = page.locator('[role="alertdialog"], [role="dialog"]').filter({ hasText: /delete|are you sure|remove/i })
  if (await confirm.count()) {
    const cancel = confirm.getByRole('button', { name: /cancel|no|keep/i })
    if (await cancel.count()) await cancel.first().click(); else await page.keyboard.press('Escape')
    throw new Error('A delete confirmation opened. It was cancelled; nothing was deleted.')
  }
}

// ---------- Main ----------
const browser = await chromium.launch({
  headless: !!args.headless,
  args: ['--window-size=1640,1120'],
  ...(args.browserPath ? { executablePath: args.browserPath } : { channel: 'chrome' }),
}).catch((err) => {
  console.error("\nCouldn't open Chrome. Is Google Chrome installed? If it's somewhere unusual, add --browser-path \"C:\\path\\to\\chrome.exe\".\n")
  console.error(String(err.message || err).split('\n')[0])
  process.exit(1)
})
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, ...(existsSync(LOGIN_STATE) ? { storageState: LOGIN_STATE } : {}) })
const page = await context.newPage()
page.setDefaultTimeout(30000)
await page.goto(LIST_URL).catch(() => {})
console.log(`
------------------------------------------------------------------
 1. In the Chrome window that just opened, log in to VetAssist.
 2. Go to Smart Prescription ▸ Medication List and wait for the list.
 3. Come back here and press Enter.
 Already read: ${results.length} medications. Saving to: ${OUT}
------------------------------------------------------------------`)
await ask('Press Enter when the list is showing… ')
try { await context.storageState({ path: LOGIN_STATE }) } catch { /* fine */ }

async function toList() {
  if (!/\/pharmacology\/?$/.test(new URL(page.url()).pathname)) await page.goto(LIST_URL)
  await waitForTable(page)
  await setRowsPerPage(page)
}
await toList()
const rows0 = await readList(page)
log(`The list shows ${rows0.length} medications.`)
const done = new Set(results.map((m) => `${m.list?.name}|${m.list?.dateAdded}`))
let read = 0
let problems = 0
for (const want of rows0) {
  if (read >= LIMIT) break
  if (done.has(`${want.name}|${want.dateAdded}`)) continue
  try {
    await toList()
    const rows = await readList(page)
    const row = rows.find((r) => r.name === want.name && r.dateAdded === want.dateAdded) || rows[want.index]
    // 1. The view window (eye)
    let [viewBtn, editBtn] = await safeButtons(page, row)
    await viewBtn.click()
    const dialog = page.locator('[role="dialog"]').last()
    await dialog.waitFor({ state: 'visible', timeout: 15000 })
    await guard(page)
    await sleep(500)
    const view = await readFields(dialog)
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(async () => { await dialog.getByRole('button').first().click().catch(() => {}) })
    await sleep(300)
    // 2. The Edit page (read only; left with Cancel / back)
    ;[viewBtn, editBtn] = await safeButtons(page, row)
    await editBtn.click()
    await page.getByText(/basic information/i).first().waitFor({ state: 'visible', timeout: 20000 })
    await guard(page)
    await sleep(900) // let the fields and editor fill in
    const main = page.locator('main').first()
    const edit = await readFields((await main.count()) ? main : page.locator('body'))
    edit.url = page.url()
    const med = shape(row, view, edit)
    med.image = await saveImage(page, edit.images[0] || view.images[0], med.name)
    const cancel = page.getByRole('button', { name: /^cancel$/i })
    if (await cancel.count()) await cancel.last().click(); else await page.goBack()
    await page.waitForURL((u) => /\/pharmacology\/?$/.test(new URL(u).pathname), { timeout: 15000 }).catch(() => {})
    const anyDose = med.dosages.length || med.variations.some((v) => v.fields.some((x) => /amount/i.test(x.label) && x.value))
    if (!anyDose && /\d+\s*dosage/i.test(row.details)) { log(`  ${med.name}: no dosages were read from the Edit page.`); await snapshot(page, `dosages-${med.name}`); problems++ }
    results.push(med)
    save()
    read++
    log(`${results.length}. ${med.name} · ${med.dosages.length} dosage${med.dosages.length === 1 ? '' : 's'} · ${med.variations.length} variation${med.variations.length === 1 ? '' : 's'}${med.image ? ' · image' : ''}`)
  } catch (err) {
    problems++
    log(`  Couldn't read ${want.name}: ${String(err.message || err).split('\n')[0]}`)
    await snapshot(page, `failed-${want.name}`)
    await page.keyboard.press('Escape').catch(() => {})
    await page.goto(LIST_URL).catch(() => {})
  }
}

console.log(`
------------------------------------------------------------------
 Medications read: ${results.length} of ${rows0.length}${problems ? `   Problems: ${problems} (see debug/)` : ''}
 Folder to import: ${OUT}
${results.length < rows0.length && read < LIMIT ? ' Run it again to retry the ones it missed.\n' : ''} When done, delete login-state.json from that folder.
------------------------------------------------------------------`)
await browser.close()
