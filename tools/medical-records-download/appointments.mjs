// Reads the old system's Appointments list (every row, every page) without opening any
// appointment, and saves it to a spreadsheet. Fast: about 72 pages at 100 rows.
// Runs on the clinic owner's PC in its own Chrome window. You log in yourself.
//
//   npm run appointments-test   -> the first page only, to check it works
//   npm run appointments        -> everything (resumes by itself if it was stopped)
//   --refresh                   -> read the whole list again for the clinic app's sync (npm run sync):
//                                  rows that look the same as last time reuse what was read then (no hovering),
//                                  so it's quick. Writes a fresh appointments.jsonl (the old one is kept as
//                                  appointments-previous.jsonl) and changed.json: the pets with a new or
//                                  changed appointment (their medical records are downloaded again).
//   --auto                      -> don't wait for Enter if the saved login still works (used by npm run sync)
//   --login-state <file>        -> where the old-system login is kept (default: in the output folder)
//
// Options: --pages N  --out <folder>  --start-page N  --rows 100  --browser-path <chrome.exe>  --url <list url>
//
// Output (default: ./output-appointments):
//   appointments.csv     one line per appointment: pet, owner, booked by, date, time, status, services…
//   appointments.jsonl   the same, plus every link and hint found on the row (for the importer)
//   ("+1 more", "2 packages" and the ⓘ note are read by hovering: clicking a row opens the appointment)
//   progress.json        pages done (resume uses this)
//   debug/               a screenshot + page copy whenever something goes wrong
//   login-state.json     your old-system login, so Chrome can reopen without asking. Delete it when done.

import { chromium } from 'playwright-core'
import { createInterface } from 'node:readline'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// ---------- Settings ----------
const args = parseArgs(process.argv.slice(2))
const LIST_URL = args.url || 'https://hanna-pet.vetassist.app/appointments'
const OUT = resolve(args.out || 'output-appointments')
const ROWS_PER_PAGE = String(args.rows || 100)
const MAX_PAGES = args.pages ? Number(args.pages) : Infinity
const PAGE_TIMEOUT_MS = 60 * 1000
const DEBUG = join(OUT, 'debug')
const PROGRESS = join(OUT, 'progress.json')
const CSV = join(OUT, 'appointments.csv')
const JSONL = join(OUT, 'appointments.jsonl')
const LOGIN_STATE = resolve(args.loginState || join(OUT, 'login-state.json'))
const REFRESH = !!args.refresh
const REFRESH_JSONL = join(OUT, 'appointments-refresh.jsonl')
const CHANGED = join(OUT, 'changed.json')
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

// ---------- Progress ----------
// keys: one per appointment already saved (pet|owner|date|time|booked by|n), so a page that
// shifted (someone booked mid-run) never saves a row twice.
const VERSION = 2 // 2: owner read correctly, "+1 more" / packages / notes read by hovering (never clicking)
if (existsSync(PROGRESS) && JSON.parse(readFileSync(PROGRESS, 'utf8')).version !== VERSION) {
  const old = join(OUT, `old-run-${Date.now()}`)
  mkdirSync(old, { recursive: true })
  for (const f of [PROGRESS, JSONL, CSV]) if (existsSync(f)) renameSync(f, join(old, f.split(/[\\/]/).pop()))
  console.log(`(An earlier version's files were moved to ${old}. Starting the list again; it only takes a while.)`)
}
const progress = existsSync(PROGRESS)
  ? JSON.parse(readFileSync(PROGRESS, 'utf8'))
  : { version: VERSION, keys: {}, pagesDone: [], lastPage: 1, totalShown: null, startedAt: new Date().toISOString() }
const save = () => { writeFileSync(PROGRESS + '.tmp', JSON.stringify(progress)); renameSync(PROGRESS + '.tmp', PROGRESS) }
const CSV_COLS = ['seq', 'page', 'pet', 'owner', 'booked_by', 'date', 'time', 'status', 'services', 'more_services', 'info', 'notes']
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`

// appointments.jsonl is the real record (one line per appointment, written as each row is read).
// The spreadsheet is rebuilt from it after every page, so having it open in Excel never stops
// the run: Excel locks the file, we skip that update and say so, and the next page catches up.
function readJsonl() {
  if (!existsSync(JSONL)) return []
  const bySeq = new Map() // a number reused after a crash: the later row is the one counted
  for (const line of readFileSync(JSONL, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let rec
    try { rec = JSON.parse(line) } catch { continue } // a line cut off by a crash
    bySeq.set(rec.seq, rec)
  }
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
}
// Rows written just before a crash are in the .jsonl but not yet in progress.json: count them as saved.
for (const rec of readJsonl()) if (rec.key && !progress.keys[rec.key]) progress.keys[rec.key] = rec.seq

// --refresh: what the last full read saw, to reuse the hover text of rows that haven't changed.
const looks = (r) => JSON.stringify([r.status, r.services, r.more || '', r.packages || '', !!r.hasInfo])
const previous = REFRESH ? new Map(readJsonl().map((r) => [r.key, r])) : new Map()
if (REFRESH && !progress.refresh) {
  progress.refresh = { startedAt: new Date().toISOString(), seen: {}, changed: {}, lastPage: 1 }
  writeFileSync(REFRESH_JSONL, '')
}
if (REFRESH && existsSync(REFRESH_JSONL)) { // resume: rows saved before a crash count as seen
  for (const line of readFileSync(REFRESH_JSONL, 'utf8').split('\n')) { try { const r = JSON.parse(line); if (r.key && !progress.refresh.seen[r.key]) progress.refresh.seen[r.key] = r.seq } catch { /* cut off */ } }
}
let csvLockedSaid = false
function writeCsv(final = false) {
  const lines = readJsonl().map((r) => [r.seq, r.page, r.pet, r.owner, r.bookedBy, r.date, r.time, r.status, (r.services || []).join(' / '), r.moreText || r.more, r.info || '', [...(r.hints || []), ...(r.extra || [])].join(' | ')].map(csvCell).join(','))
  const text = '\uFEFF' + [CSV_COLS.join(','), ...lines].join('\n') + '\n' // the mark makes Excel read ñ and é correctly
  try {
    writeFileSync(CSV, text)
    if (csvLockedSaid) log('appointments.csv is up to date again.')
    csvLockedSaid = false
    return CSV
  } catch (err) {
    if (!['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) throw err
    if (final) {
      const alt = join(OUT, `appointments-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`)
      writeFileSync(alt, text)
      log(`appointments.csv is open in Excel, so the full list went to ${alt}`)
      return alt
    }
    if (!csvLockedSaid) log('appointments.csv is open in Excel, so it isn\'t being updated. Nothing is lost: close Excel and it catches up on the next page.')
    csvLockedSaid = true
    return CSV
  }
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

// ---------- The list ----------
async function onLoginPage(page) {
  if (/login|sign-?in|auth/i.test(new URL(page.url()).pathname)) return true
  return page.getByText(/welcome back|sign in to your account/i).first().isVisible().catch(() => false)
}
async function waitForTable(page) {
  await page.locator('table tbody tr').first().waitFor({ state: 'visible', timeout: PAGE_TIMEOUT_MS })
  await sleep(700)
}

// Every row as it is on screen, read by the column headers (Pet & Owner, Booked By, Date & Time,
// Status, Services), plus any links and hints on the row. The pet cell shows "paris" and
// "Owner: Chris Aga-ab", where "Owner:" and the name are separate pieces (two lines here).
async function readRows(page) {
  return page.locator('table').first().evaluate((table) => {
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.innerText.trim().toLowerCase())
    const col = (re) => heads.findIndex((h) => re.test(h))
    const at = { pet: col(/pet|owner/), booked: col(/booked/), date: col(/date|time/), status: col(/status/), services: col(/service/) }
    const tidy = (t) => t.replace(/[\s↗↑→⧉]+$/u, '').replace(/\s+/g, ' ').trim() // link icons next to names
    const junk = (l) => /^(loading\.*|[↗↑→⧉]|…|\.\.\.)$/i.test(l)
    const lines = (td) => (td ? td.innerText.split('\n').map(tidy).filter((l) => l && !junk(l)) : [])
    return [...table.querySelectorAll('tbody tr')].map((tr, index) => {
      const tds = [...tr.querySelectorAll('td')]
      const petLines = lines(tds[at.pet])
      const oi = petLines.findIndex((l) => /^owner\s*:/i.test(l))
      const sameLine = oi >= 0 ? petLines[oi].replace(/^owner\s*:\s*/i, '') : ''
      const ownerAt = oi < 0 ? -1 : sameLine ? oi : oi + 1 // "Owner: Name" or "Owner:" then "Name"
      const rest = petLines.filter((_, i) => i !== oi && i !== ownerAt)
      const pet = rest[0] || ''
      const owner = sameLine || petLines[ownerAt] || rest[1] || ''
      const booked = (lines(tds[at.booked]).filter((l) => l.length > 1).pop() || '')
      const [date = '', time = ''] = lines(tds[at.date])
      const status = lines(tds[at.status]).join(' ')
      const svc = lines(tds[at.services])
      const more = svc.find((l) => /^\+\s*\d+\s*more$/i.test(l)) || ''
      const packages = svc.find((l) => /^\d+\s+packages?$/i.test(l)) || ''
      const known = new Set([at.pet, at.booked, at.date, at.status, at.services])
      const extraTds = tds.map((td, i) => [td, i]).filter(([, i]) => !known.has(i))
      const infoCol = extraTds.length ? extraTds[extraTds.length - 1][1] : -1
      const hasInfo = infoCol >= 0 && !!tds[infoCol].querySelector('button, svg, [role="button"]')
      const shown = new Set([pet, owner, booked, ...svc].map((t) => t.toLowerCase()))
      const hints = [...new Set([...tr.querySelectorAll('[title], [aria-label], [data-tooltip], [data-tip]')]
        .map((e) => tidy(e.getAttribute('title') || e.getAttribute('aria-label') || e.getAttribute('data-tooltip') || e.getAttribute('data-tip') || '')))]
        .filter((t) => t && t.length < 300 && !junk(t) && !shown.has(t.toLowerCase()))
      const links = [...tr.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'))
      const data = Object.fromEntries([...tr.attributes].filter((a) => a.name.startsWith('data-')).map((a) => [a.name, a.value]))
      return {
        index, pet, owner, bookedBy: booked, date, time, status,
        services: svc.filter((l) => l !== more), more, packages, hasInfo, infoCol,
        extra: extraTds.map(([td]) => td.innerText.trim()).filter(Boolean), hints, links, data,
      }
    })
  })
}

// Rows open the appointment when clicked, so "+1 more", "2 packages" and the ⓘ icon are only
// ever hovered, never clicked. Whatever pop-up appears is read, then the mouse moves away.
const POPUPS = '[role="tooltip"], [data-radix-popper-content-wrapper], [data-side], [role="dialog"], .popover, [class*="popover"], [class*="tooltip"], [class*="Tooltip"]'
async function onList(page) {
  return new URL(page.url()).pathname.replace(/\/+$/, '') === new URL(LIST_URL).pathname.replace(/\/+$/, '') && (await page.locator('table tbody tr').count()) > 0
}
async function backToList(page) {
  if (await onList(page)) return
  log('  (Left the list by accident. Going back…)')
  await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {})
  await waitForTable(page).catch(() => {})
  if (!(await onList(page))) throw new Error('not on the Appointments list any more')
}
async function peek(page, row, target) {
  try {
    const tr = page.locator('table tbody tr').nth(row.index)
    const el = target === 'info'
      ? tr.locator('td').nth(row.infoCol).locator('button, [role="button"], svg').first()
      : tr.getByText(target, { exact: true }).first()
    const before = new Set(await page.locator(POPUPS).filter({ visible: true }).allInnerTexts())
    await el.hover({ timeout: 3000 })
    let text = ''
    for (let i = 0; i < 8 && !text; i++) {
      await sleep(150)
      const now = await page.locator(POPUPS).filter({ visible: true }).allInnerTexts()
      text = now.filter((t) => t.trim() && !before.has(t)).pop() || ''
    }
    if (!text) text = (await el.getAttribute('title').catch(() => null)) || ''
    await page.mouse.move(2, 2)
    await sleep(150)
    return text.replace(/\s*\n\s*/g, ' | ').trim().slice(0, 500) || null
  } catch {
    await page.mouse.move(2, 2).catch(() => {})
    return null
  }
}

async function setRowsPerPage(page) {
  const label = page.getByText(/rows per page/i).first()
  if (!(await label.isVisible().catch(() => false))) return log('  (No "Rows per page" selector found; using what the page shows.)')
  const box = label.locator('xpath=..')
  const select = box.locator('select')
  if (await select.count()) await select.first().selectOption(ROWS_PER_PAGE)
  else {
    await box.locator('button, [role="combobox"]').first().click()
    await page.getByRole('option', { name: ROWS_PER_PAGE, exact: true }).or(page.getByText(ROWS_PER_PAGE, { exact: true }).last()).first().click()
  }
  await waitForTable(page)
}

// ---------- Pages (the same tested approach as the medical records tool) ----------
const signature = async (page) => (await readRows(page)).map((r) => r.pet + r.owner + r.date + r.time).join('|')
async function pagerNumbers(page) {
  // Page-number buttons only: leave out the "Rows per page" box (it shows 100) and any drop-down.
  return page.evaluate(() => {
    const label = [...document.querySelectorAll('body *')].find((e) => e.children.length === 0 && /rows per page/i.test(e.textContent))
    const skip = label ? [label.parentElement, label.nextElementSibling].filter(Boolean) : []
    return [...document.querySelectorAll('button, a, [role="button"]')]
      .filter((e) => /^\s*\d{1,4}\s*$/.test(e.innerText) && e.offsetParent && !e.closest('table'))
      .filter((e) => !e.closest('[role="combobox"], [aria-haspopup], select') && !e.matches('[aria-haspopup], [role="combobox"]'))
      .filter((e) => !skip.some((s) => s !== e.closest('ul, ol, nav') && s.contains(e) && !s.querySelectorAll('button, a, [role="button"]')[1]))
      .map((e) => Number(e.innerText.trim()))
  })
}
async function lastPageNumber(page) {
  const nums = await pagerNumbers(page)
  return nums.length ? Math.max(...nums) : null
}
async function waitForNewRows(page, before) {
  for (let i = 0; i < 60; i++) {
    await sleep(250)
    const after = await signature(page)
    if (after && after !== before) { await sleep(300); return true }
  }
  return false
}
async function goToPage(page, target, current = target - 1) {
  const before = await signature(page)
  const numbered = page.locator('button, a, [role="button"]').filter({ hasText: new RegExp(`^\\s*${target}\\s*$`) }).filter({ visible: true })
  for (let i = 0; i < (await numbered.count()); i++) {
    const el = numbered.nth(i)
    if (await el.evaluate((e) => !!e.closest('table')).catch(() => true)) continue
    await el.click().catch(() => {})
    if (await waitForNewRows(page, before)) return true
  }
  if (target !== current + 1) return false
  const named = page.getByRole('button', { name: /next|›|»|^>$/i }).filter({ visible: true })
  if (await named.count()) {
    const b = named.last()
    if (!(await b.isDisabled().catch(() => false))) {
      await b.click().catch(() => {})
      if (await waitForNewRows(page, before)) return true
    }
  }
  const arrow = await page.evaluateHandle(() => {
    const nums = [...document.querySelectorAll('button, a, [role="button"]')]
      .filter((e) => /^\s*\d{1,4}\s*$/.test(e.innerText) && !e.closest('table') && e.offsetParent)
    if (!nums.length) return null
    let box = nums[0].parentElement
    while (box && !nums.every((n) => box.contains(n))) box = box.parentElement
    if (!box) return null
    if (box.querySelector('table')) return null // too wide: that would reach the rows
    const btns = [...box.querySelectorAll('button, a, [role="button"]')].filter((e) => e.offsetParent && !e.closest('table'))
    const last = btns[btns.length - 1]
    return last && !nums.includes(last) && !last.disabled && last.getAttribute('aria-disabled') !== 'true' ? last : null
  })
  const el = arrow.asElement()
  if (el) {
    await el.click().catch(() => {})
    if (await waitForNewRows(page, before)) return true
  }
  return false
}
async function openList(page, target = 1) {
  await page.goto(LIST_URL, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS })
  if (await onLoginPage(page)) throw Object.assign(new Error('logged out'), { loggedOut: true })
  await waitForTable(page)
  await setRowsPerPage(page)
  let at = 1
  while (at < target) {
    const nums = (await pagerNumbers(page)).filter((n) => n > at && n <= target)
    const jump = nums.length ? Math.max(...nums) : at + 1
    if (await goToPage(page, jump, at)) { at = jump; continue }
    if (jump !== at + 1 && await goToPage(page, at + 1, at)) { at += 1; continue }
    return at
  }
  return at
}

// ---------- One pass through every page ----------
function keyOf(r, n) {
  return [r.pet, r.owner, r.date, r.time, r.bookedBy].map((s) => String(s).toLowerCase().trim()).join('|') + `|${n}`
}
async function pass(page, startPage) {
  let pageNo = await openList(page, startPage)
  let added = 0
  let pagesRead = 0
  while (true) {
    if (REFRESH) progress.refresh.lastPage = pageNo
    else progress.lastPage = pageNo
    await backToList(page)
    const rows = await readRows(page)
    const of = await lastPageNumber(page)
    const seen = {}
    let newHere = 0
    for (const r of rows) {
      const base = keyOf(r, 0)
      seen[base] = (seen[base] || 0) + 1
      const key = keyOf(r, seen[base])
      const keys = REFRESH ? progress.refresh.seen : progress.keys
      if (keys[key]) continue
      const before = previous.get(key)
      const same = before && looks(before) === looks(r)
      let moreText = same ? before.moreText ?? null : null
      let info = same ? before.info ?? null : null
      if (!same) {
        moreText = [r.more && await peek(page, r, r.more), r.packages && await peek(page, r, r.packages)].filter(Boolean).join(' | ') || null
        info = r.hasInfo ? await peek(page, r, 'info') : null
        await backToList(page)
        if (REFRESH) progress.refresh.changed[`${r.pet.toLowerCase()}|${r.owner.toLowerCase()}`] = { pet: r.pet, owner: r.owner }
      }
      const seq = Object.keys(keys).length + 1
      const rec = { seq, page: pageNo, key, ...r, moreText, info, savedAt: new Date().toISOString() }
      appendFileSync(REFRESH ? REFRESH_JSONL : JSONL, JSON.stringify(rec) + '\n')
      keys[key] = seq
      newHere++
    }
    if (!progress.pagesDone.includes(pageNo)) progress.pagesDone.push(pageNo)
    progress.totalShown = of || progress.totalShown
    save()
    if (!REFRESH) writeCsv()
    added += newHere
    pagesRead++
    log(REFRESH ? `Page ${pageNo}${of ? ` of ${of}` : ''}: ${rows.length} rows read (total ${Object.keys(progress.refresh.seen).length}, ${Object.keys(progress.refresh.changed).length} pets with something new)`
      : `Page ${pageNo}${of ? ` of ${of}` : ''}: ${rows.length} rows, ${newHere} new (total ${Object.keys(progress.keys).length})`)
    if (pagesRead >= MAX_PAGES) return { added, stopped: true }
    await backToList(page)
    if (!(await goToPage(page, pageNo + 1, pageNo))) {
      if (of && pageNo < of) {
        await snapshot(page, `stuck-on-page-${pageNo}`)
        throw new Error(`couldn't move from page ${pageNo} to page ${pageNo + 1} (the pager shows ${of} pages)`)
      }
      log(`Reached the last page (${pageNo}${of ? ` of ${of}` : ''}).`)
      return { added, stopped: false }
    }
    pageNo++
  }
}

// ---------- Main ----------
const launch = {
  headless: !!args.headless, // --headless is only for testing
  args: ['--window-size=1640,1120'],
  ...(args.browserPath ? { executablePath: args.browserPath } : { channel: 'chrome' }),
}
let browser, context, page
async function openBrowser() {
  browser = await chromium.launch(launch).catch((err) => {
    console.error("\nCouldn't open Chrome. Is Google Chrome installed? If it's somewhere unusual, add --browser-path \"C:\\path\\to\\chrome.exe\".\n")
    console.error(String(err.message || err).split('\n')[0])
    process.exit(1)
  })
  context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, ...(existsSync(LOGIN_STATE) ? { storageState: LOGIN_STATE } : {}) })
  page = await context.newPage()
  page.setDefaultTimeout(PAGE_TIMEOUT_MS)
}
async function rememberLogin() {
  try { await context.storageState({ path: LOGIN_STATE + '.tmp', indexedDB: true }); renameSync(LOGIN_STATE + '.tmp', LOGIN_STATE) } catch { /* closing */ }
}
const isClosed = (err) => /has been closed|Target closed|Browser closed|browser has disconnected/i.test(String(err?.message || err))

await openBrowser()
await page.goto(LIST_URL).catch(() => {})
console.log(`
------------------------------------------------------------------
 1. In the Chrome window that just opened, log in to VetAssist.
 2. Wait until you can see the Appointments list (Table view, "All").
 3. Come back here and press Enter.
 Already saved: ${Object.keys(progress.keys).length} appointments. Saving to: ${OUT}
------------------------------------------------------------------`)
if (!(args.auto && await waitForTable(page).then(() => true).catch(() => false) && !(await onLoginPage(page)))) await ask('Press Enter when the list is showing… ')
await rememberLogin()

let startPage = Number(args.startPage) || (REFRESH ? progress.refresh.lastPage : progress.lastPage) || 1
let checking = false
let tries = 0
while (true) {
  try {
    const result = await pass(page, startPage)
    if (result.stopped) { log(`Stopped after ${MAX_PAGES} page(s), as asked.`); break }
    if (!checking || result.added > 0) {
      log(checking ? `Checking pass found ${result.added} more. Checking once more…` : 'Doing a quick checking pass for anything that moved during the run…')
      checking = true
      startPage = 1
      continue
    }
    break
  } catch (err) {
    startPage = (REFRESH ? progress.refresh.lastPage : progress.lastPage) || 1
    if (isClosed(err)) {
      log('Chrome closed. Reopening it and carrying on from the same page…')
      await browser.close().catch(() => {})
      await openBrowser()
      continue
    }
    if (err.loggedOut) {
      log('The old system logged you out.')
      await ask('Log in again in the Chrome window, wait for the list, then press Enter here… ')
      await rememberLogin()
      continue
    }
    log(`Something unexpected happened: ${String(err.message || err).split('\n')[0]}`)
    await snapshot(page, 'unexpected')
    if (++tries > 3) { await ask('This keeps happening. Press Enter to try again (or close this window; running again resumes)… '); tries = 0 } else log('Trying again from the same page…')
  }
}

await rememberLogin()
if (REFRESH) { // the fresh read becomes the list; the last one is kept beside it
  const r = progress.refresh
  if (existsSync(JSONL)) renameSync(JSONL, join(OUT, 'appointments-previous.jsonl'))
  renameSync(REFRESH_JSONL, JSONL)
  writeFileSync(CHANGED, JSON.stringify(Object.values(r.changed), null, 1))
  progress.keys = r.seen
  progress.lastRefresh = { startedAt: r.startedAt, finishedAt: new Date().toISOString(), rows: Object.keys(r.seen).length, changedPets: Object.keys(r.changed).length }
  delete progress.refresh
  save()
  log(`Refreshed: ${progress.lastRefresh.rows} appointments; ${progress.lastRefresh.changedPets} pets with a new or changed appointment (changed.json).`)
}
const sheet = writeCsv(true)
console.log(`
------------------------------------------------------------------
 Appointments saved: ${Object.keys(progress.keys).length}
 Spreadsheet: ${sheet}
------------------------------------------------------------------`)
await browser.close()
