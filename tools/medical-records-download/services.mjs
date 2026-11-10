// Reads the old system's Services list: opens each service's Edit panel, reads it, and closes it
// with Cancel. It never clicks Update Service and never adds a variation, so nothing changes.
// Runs on the clinic owner's PC in its own Chrome window. You log in yourself.
//
//   npm run services            -> every service (about 49; a few minutes)
//   npm run services-test       -> the first 3 only, to check it works
//
// Options: --limit N  --out <folder>  --browser-path <chrome.exe>  --url <services url>
//
// Output (default: ./output-services):
//   services.json      every service with its description, price, category, switches and variations
//   services.csv       the same, one line per service or variation, to look at in Excel
//   debug/             a screenshot + page copy whenever something looks off
//   login-state.json   your old-system login. Delete it when done.

import { chromium } from 'playwright-core'
import { createInterface } from 'node:readline'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = parseArgs(process.argv.slice(2))
const LIST_URL = args.url || 'https://hanna-pet.vetassist.app/services'
const OUT = resolve(args.out || 'output-services')
const LIMIT = args.limit ? Number(args.limit) : Infinity
const DEBUG = join(OUT, 'debug')
const JSON_FILE = join(OUT, 'services.json')
const CSV = join(OUT, 'services.csv')
const LOGIN_STATE = join(OUT, 'login-state.json')
mkdirSync(DEBUG, { recursive: true })

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
const slug = (s) => String(s).normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40)
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

// Results so far (resume skips services already read).
const results = existsSync(JSON_FILE) ? JSON.parse(readFileSync(JSON_FILE, 'utf8')) : []
function save() {
  writeFileSync(JSON_FILE + '.tmp', JSON.stringify(results, null, 2))
  renameSync(JSON_FILE + '.tmp', JSON_FILE)
  const lines = [['service', 'description', 'price', 'category', 'active', 'featured_online', 'variation', 'variation_description', 'variation_price'].join(',')]
  for (const s of results) {
    const base = [s.name, s.description, s.price, s.category, s.active, s.featuredOnline]
    if (!s.variations.length) lines.push([...base, '', '', ''].map(csvCell).join(','))
    for (const v of s.variations) lines.push([...base, v.name, v.description, v.price].map(csvCell).join(','))
  }
  try { writeFileSync(CSV, '\uFEFF' + lines.join('\n') + '\n') } catch (err) {
    if (['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) log('services.csv is open in Excel, so it wasn’t updated. services.json has everything.')
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
    const at = { name: col(/name/), price: col(/price/), category: col(/categor/), status: col(/status/), variations: col(/variation/), actions: col(/action/) }
    return [...table.querySelectorAll('tbody tr')].map((tr, index) => {
      const tds = [...tr.querySelectorAll('td')]
      const text = (i) => (i >= 0 && tds[i] ? tds[i].innerText.replace(/\s+/g, ' ').trim() : '')
      const actions = at.actions >= 0 ? tds[at.actions] : tds[tds.length - 1]
      const star = actions ? [...actions.querySelectorAll('svg')].pop() : null
      return {
        index, name: text(at.name), price: text(at.price), category: text(at.category), status: text(at.status),
        variationCount: Number(text(at.variations)) || 0,
        starHint: star ? [star.getAttribute('class'), star.getAttribute('fill'), star.closest('button')?.getAttribute('aria-label'), star.closest('button')?.getAttribute('title')].filter(Boolean).join(' ') : '',
        actionsCol: at.actions >= 0 ? at.actions : tds.length - 1,
      }
    })
  })
}

// ---------- The Edit panel ----------
const PANEL = '[role="dialog"], [data-state="open"][class*="sheet"], [class*="drawer"], [class*="Sheet"]'
async function openPanel(page, row) {
  const cell = page.locator('table tbody tr').nth(row.index).locator('td').nth(row.actionsCol)
  const buttons = cell.locator('button, a, [role="button"]')
  const edit = (await buttons.count()) ? buttons.first() : cell.locator('svg').first()
  await edit.click()
  const panel = page.locator(PANEL).filter({ hasText: /edit service/i }).last()
  await panel.waitFor({ state: 'visible', timeout: 15000 })
  await sleep(600) // let the fields fill in
  return panel
}
async function readPanel(panel) {
  return panel.evaluate((root) => {
    const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
    const fields = []
    let lastLabel = ''
    const nodes = root.querySelectorAll('label, input, textarea, select, [role="switch"], [role="checkbox"], [role="combobox"]')
    for (const e of nodes) {
      if (e.tagName === 'LABEL' && !e.querySelector('input, textarea, select, [role="switch"]')) { lastLabel = clean(e.innerText).replace(/\s*\*$/, ''); continue }
      if (e.tagName === 'LABEL') continue
      if (e.getAttribute('aria-hidden') === 'true' || !e.getClientRects().length) continue // hidden copies behind switches
      if (e.type === 'hidden' || (e.tagName === 'INPUT' && e.closest('[role="combobox"]') && e.closest('[role="combobox"]') !== e)) continue
      let value
      const isSwitch = e.matches('[role="switch"], [role="checkbox"]') || e.type === 'checkbox'
      if (isSwitch) value = e.getAttribute('aria-checked') ?? e.getAttribute('data-state') ?? String(!!e.checked)
      else if (e.tagName === 'SELECT') value = e.options[e.selectedIndex]?.text
      else if (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA') value = e.value
      else value = clean(e.innerText).replace(/\s*\d+\/\d+$/, '')
      let label = e.getAttribute('aria-label') || (e.id && root.querySelector(`label[for="${CSS.escape(e.id)}"]`)?.innerText) || ''
      if (isSwitch && !label) { // the switch's card: "Service Active  Available for clinic appointments…"
        let box = e.parentElement
        for (let i = 0; i < 4 && box && clean(box.innerText).length < 3; i++) box = box.parentElement
        label = String(box?.innerText || '').split('\n').map(clean).find(Boolean) || ''
      }
      fields.push({ label: clean(label || lastLabel).replace(/\s*\*$/, ''), value: clean(value), switch: isSwitch })
    }
    return { fields, text: root.innerText }
  })
}
function shape(row, read) {
  const get = (re) => read.fields.find((f) => re.test(f.label))?.value ?? ''
  const isOn = (f) => /^(true|checked|on)$/i.test(f.value)
  const on = (re) => { const f = read.fields.find((x) => x.switch && re.test(x.label)); return f ? isOn(f) : null }
  const switches = read.fields.filter((f) => f.switch)
  const variations = []
  let current = null
  for (const f of read.fields) {
    if (/^variation name/i.test(f.label)) { current = { name: f.value, description: '', price: '' }; variations.push(current) }
    else if (current && /^variation desc/i.test(f.label)) current.description = f.value
    else if (current && /^variation price/i.test(f.label)) current.price = f.value
  }
  return {
    name: get(/^service name/i) || row.name,
    description: get(/^description/i),
    price: get(/^base price|^price/i) || row.price,
    category: get(/^category/i) || row.category,
    active: on(/active/i) ?? (switches[0] ? isOn(switches[0]) : /^active$/i.test(row.status)),
    featuredOnline: on(/featured|online/i) ?? (switches[1] ? isOn(switches[1]) : null),
    variations: variations.filter((v) => v.name || v.price),
    list: { price: row.price, category: row.category, status: row.status, variations: row.variationCount, starHint: row.starHint },
    fields: read.fields,
    panelText: read.text,
  }
}
async function closePanel(page, panel) {
  const cancel = panel.getByRole('button', { name: /^cancel$/i })
  if (await cancel.count()) await cancel.first().click()
  else await page.keyboard.press('Escape')
  await panel.waitFor({ state: 'hidden', timeout: 10000 }).catch(async () => {
    await page.keyboard.press('Escape')
    await panel.waitFor({ state: 'hidden', timeout: 5000 })
  })
  await sleep(300)
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
 2. Go to Services and wait until you can see the list.
 3. Come back here and press Enter.
 Already read: ${results.length} services. Saving to: ${OUT}
------------------------------------------------------------------`)
await ask('Press Enter when the list is showing… ')
try { await context.storageState({ path: LOGIN_STATE }) } catch { /* fine */ }

if (!/\/services\b/.test(new URL(page.url()).pathname)) await page.goto(LIST_URL)
await waitForTable(page)
await setRowsPerPage(page)
const rows = await readList(page)
log(`The list shows ${rows.length} services.`)
const done = new Set(results.map((s) => `${s.list?.name || s.name}|${s.list?.price}`))
let read = 0
let problems = 0
for (const row of rows) {
  if (read >= LIMIT) break
  if (done.has(`${row.name}|${row.price}`)) continue
  try {
    const panel = await openPanel(page, row)
    const service = shape(row, await readPanel(panel))
    service.list.name = row.name
    if (row.variationCount && service.variations.length !== row.variationCount) {
      log(`  ${row.name}: the list says ${row.variationCount} variations but the panel showed ${service.variations.length}.`)
      await snapshot(page, `variations-${row.name}`)
      problems++
    }
    await closePanel(page, panel)
    results.push(service)
    save()
    read++
    log(`${results.length}. ${service.name} · ₱${service.price} · ${service.category}${service.variations.length ? ` · ${service.variations.length} variations` : ''}`)
  } catch (err) {
    problems++
    log(`  Couldn't read ${row.name}: ${String(err.message || err).split('\n')[0]}`)
    await snapshot(page, `failed-${row.name}`)
    await page.keyboard.press('Escape').catch(() => {})
    await page.goto(LIST_URL).catch(() => {})
    await waitForTable(page).catch(() => {})
    await setRowsPerPage(page).catch(() => {})
  }
}

console.log(`
------------------------------------------------------------------
 Services read: ${results.length} of ${rows.length}${problems ? `   Problems: ${problems} (see debug/)` : ''}
 Spreadsheet: ${CSV}
${results.length < rows.length && read < LIMIT ? ' Run it again to retry the ones it missed.\n' : ''}------------------------------------------------------------------`)
await browser.close()
