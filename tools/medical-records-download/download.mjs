// Downloads every pet's medical records from the old VetAssist system: one zip per pet, made by
// the old system's own "Download All PDFs" button. Runs on the clinic owner's PC, in a Chrome
// window it opens. You log in yourself; the script never sees your password.
//
//   npm run test-run      -> 3 pets only, to check it works
//   npm start             -> everything (resumes by itself if it was stopped)
//
// Options: --test  --limit N  --out <folder>  --start-page N  --browser-path <chrome.exe>  --url <list url>
//
// Output (default: ./output):
//   zips/0001-paris-09178806850.zip   one zip per pet (the PDFs inside name the pet, owner and record IDs)
//   progress.json                     what's done, what failed, which page it was on (resume uses this)
//   pets.csv                          one line per downloaded pet: list position, pet, owner, phone, zip
//   debug/                            a screenshot + page copy whenever something goes wrong
//   login-state.json                  your old-system login, so Chrome can reopen without asking.
//                                     Delete it once the download is finished.

import { chromium } from 'playwright-core'
import { createInterface } from 'node:readline'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// ---------- Settings ----------
const args = parseArgs(process.argv.slice(2))
const LIST_URL = args.url || 'https://hanna-pet.vetassist.app/medical-records'
const OUT = resolve(args.out || 'output')
const LIMIT = args.test ? 3 : args.limit ? Number(args.limit) : Infinity
const ROWS_PER_PAGE = '100'
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000   // big records with many photos take a while to build
const PAGE_TIMEOUT_MS = 60 * 1000
const MAX_TRIES = 3

const ZIPS = join(OUT, 'zips')
const DEBUG = join(OUT, 'debug')
const PROGRESS = join(OUT, 'progress.json')
const CSV = join(OUT, 'pets.csv')
mkdirSync(ZIPS, { recursive: true })
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

// ---------- Progress (saved after every pet, so a restart carries on) ----------
const progress = existsSync(PROGRESS)
  ? JSON.parse(readFileSync(PROGRESS, 'utf8'))
  : { done: {}, failed: {}, noRecords: {}, lastPage: 1, seq: 0, startedAt: new Date().toISOString() }
function save() {
  writeFileSync(PROGRESS + '.tmp', JSON.stringify(progress, null, 2))
  renameSync(PROGRESS + '.tmp', PROGRESS)
}
if (!existsSync(CSV)) writeFileSync(CSV, 'seq,page,pet,owner,phone,records,zip,downloaded_at\n')
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`

// ---------- Small helpers ----------
const log = (...m) => console.log(`[${new Date().toLocaleTimeString()}]`, ...m)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const slug = (s) => String(s).normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || 'pet'
const digits = (s) => String(s || '').replace(/\D/g, '')

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
  } catch { /* the page may be gone */ }
}

// ---------- The old system's list page ----------
async function onLoginPage(page) {
  if (/login|sign-?in|auth/i.test(new URL(page.url()).pathname)) return true
  return page.getByText(/welcome back|sign in to your account/i).first().isVisible().catch(() => false)
}

async function waitForTable(page) {
  await page.locator('table tbody tr').first().waitFor({ state: 'visible', timeout: PAGE_TIMEOUT_MS })
  await sleep(600) // let the rows finish rendering
}

// The pet list rows as they are on screen right now.
async function readRows(page) {
  return page.locator('table tbody tr').evaluateAll((trs) => trs.map((tr, i) => {
    const cells = [...tr.querySelectorAll('td')].map((td) => td.innerText.trim())
    const [petCell = '', ownerCell = ''] = cells
    const petLines = petCell.split('\n').map((s) => s.trim()).filter(Boolean)
    const ownerLines = ownerCell.split('\n').map((s) => s.trim()).filter(Boolean)
    // The owner column shows an initial in a circle, then the name, then the phone.
    const phone = ownerLines.find((l) => /\d[\d\s-]{6,}/.test(l)) || ''
    const ownerName = ownerLines.filter((l) => l !== phone && l.length > 1).pop() || ''
    return { index: i, pet: petLines[0] || '', species: petLines[1] || '', owner: ownerName, phone, cells: cells.length }
  }))
}

async function setRowsPerPage(page) {
  const label = page.getByText(/rows per page/i).first()
  if (!(await label.isVisible().catch(() => false))) return log('  (No "Rows per page" selector found; using what the page shows.)')
  const box = label.locator('xpath=..')
  const select = box.locator('select')
  if (await select.count()) {
    await select.first().selectOption(ROWS_PER_PAGE)
  } else {
    await box.locator('button, [role="combobox"]').first().click()
    await page.getByRole('option', { name: ROWS_PER_PAGE, exact: true }).or(page.getByText(ROWS_PER_PAGE, { exact: true }).last()).first().click()
  }
  await waitForTable(page)
}

// Sorts by Pet Name A→Z, so rows don't move if someone edits a record during the run.
// The old system sorts on its server (it takes a moment) and may put capitals first, so this waits
// for the rows to change and accepts either kind of A→Z.
async function sortByPetName(page) {
  const header = page.locator('table thead th').filter({ hasText: /pet name/i }).first()
  if (!(await header.isVisible().catch(() => false))) return log('  (No "Pet Name" column header found; keeping the default order.)')
  const names = async () => (await readRows(page)).map((r) => r.pet)
  const ascending = (list) => list.length > 1 && (
    list.every((n, i) => i === 0 || list[i - 1].toLowerCase().localeCompare(n.toLowerCase()) <= 0) ||
    list.every((n, i) => i === 0 || list[i - 1] <= n)
  )
  for (let i = 0; i < 4; i++) {
    if (ascending(await names())) return
    const before = (await names()).join('|')
    await header.click()
    for (let w = 0; w < 60; w++) { // up to 15 seconds for the list to re-sort
      await sleep(250)
      const now = (await names()).join('|')
      if (now && now !== before) break
    }
    await sleep(400)
  }
  if (!ascending(await names())) log('  (Could not confirm A→Z order. Carrying on; the checking pass at the end catches anything missed.)')
}

// Finds the "next page" button in the pager (the ">" after the page numbers).
async function nextPageButton(page) {
  const named = page.getByRole('button', { name: /next/i })
  if (await named.count()) return named.first()
  const numbered = page.locator('button').filter({ hasText: /^\s*\d+\s*$/ })
  if (!(await numbered.count())) return null
  return numbered.last().locator('xpath=..').locator('button, a').last()
}

async function goNextPage(page) {
  const before = (await readRows(page)).map((r) => r.pet + r.phone).join('|')
  const btn = await nextPageButton(page)
  if (!btn || (await btn.isDisabled().catch(() => false)) || (await btn.getAttribute('aria-disabled')) === 'true') return false
  await btn.click()
  for (let i = 0; i < 40; i++) {
    await sleep(250)
    const after = (await readRows(page)).map((r) => r.pet + r.phone).join('|')
    if (after && after !== before) return true
  }
  return false // the rows didn't change: this was the last page
}

// Opens the list fresh, sets 100 rows and A→Z, and steps to page `target`.
async function openList(page, target = 1) {
  await page.goto(LIST_URL, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS })
  if (await onLoginPage(page)) throw Object.assign(new Error('logged out'), { loggedOut: true })
  await waitForTable(page)
  await setRowsPerPage(page)
  await sortByPetName(page)
  for (let p = 1; p < target; p++) {
    if (!(await goNextPage(page))) return p // there are fewer pages than expected
  }
  return target
}

const isClosed = (err) => /has been closed|Target closed|Browser closed|browser has disconnected/i.test(String(err?.message || err))

// ---------- One pet ----------
function keyOf(row, occurrence) {
  return `${row.pet.toLowerCase()}|${digits(row.phone) || row.owner.toLowerCase()}|${occurrence}`
}

async function downloadPet(page, row, pageNo, key) {
  const tr = page.locator('table tbody tr').nth(row.index)
  const eye = tr.locator('td').last().locator('a, button').first()
  await eye.click()

  // The page can hold a hidden copy of the label (e.g. for small screens): only use a visible button.
  const button = page.locator('button, a, [role="button"]').filter({ hasText: /download all pdfs/i }).filter({ visible: true }).first()
  await button.waitFor({ state: 'visible', timeout: PAGE_TIMEOUT_MS })
  await sleep(500)
  if (await button.isDisabled().catch(() => false)) {
    progress.noRecords[key] = { pet: row.pet, owner: row.owner, phone: row.phone, page: pageNo }
    save()
    log(`  ${row.pet} (${row.owner}) has no PDFs to download. Noted.`)
    return
  }

  const seq = ++progress.seq
  const file = `${String(seq).padStart(4, '0')}-${slug(row.pet)}-${digits(row.phone) || slug(row.owner)}.zip`
  const part = join(ZIPS, file + '.part')
  // The old system first asks "Download All Medical Records: You are about to download N medical
  // records for <pet>…" with Cancel / Download All. Confirm it, and note N to check the zip later.
  const downloadStarted = page.waitForEvent('download', { timeout: DOWNLOAD_TIMEOUT_MS })
  downloadStarted.catch(() => {}) // handled below
  await button.click()
  const confirm = page.locator('button, [role="button"]').filter({ hasText: /^\s*download all\s*$/i }).filter({ visible: true }).first()
  let expected = null
  if (await confirm.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false)) {
    const text = await page.getByText(/you are about to download/i).first().innerText().catch(() => '')
    const m = text.match(/download\s+(\d+)\s+medical record/i)
    if (m) expected = Number(m[1])
    await confirm.click()
  }
  const download = await downloadStarted
  const failure = await download.failure()
  if (failure) throw new Error(`download failed: ${failure}`)
  await download.saveAs(part)
  renameSync(part, join(ZIPS, file))

  progress.done[key] = { file, pet: row.pet, owner: row.owner, phone: row.phone, page: pageNo, records: expected, at: new Date().toISOString() }
  delete progress.failed[key]
  save()
  appendFileSync(CSV, [seq, pageNo, row.pet, row.owner, row.phone, expected ?? '', file, progress.done[key].at].map(csvCell).join(',') + '\n')
  log(`  Saved ${file}${expected ? ` (${expected} record${expected === 1 ? '' : 's'})` : ''}`)
  if (seq % 20 === 0) await rememberLogin()
}

// ---------- One pass through every page ----------
async function pass(page, { startPage, onlyFailed }) {
  let pageNo = await openList(page, startPage)
  let newThisPass = 0
  while (true) {
    progress.lastPage = pageNo
    save()
    const rows = await readRows(page)
    const seen = {}
    log(`Page ${pageNo}: ${rows.length} pets`)
    for (const row of rows) {
      const base = `${row.pet.toLowerCase()}|${digits(row.phone) || row.owner.toLowerCase()}`
      seen[base] = (seen[base] || 0) + 1
      const key = keyOf(row, seen[base])
      if (progress.done[key] || progress.noRecords[key]) continue
      if (onlyFailed && !progress.failed[key]) continue
      if ((progress.failed[key]?.tries || 0) >= MAX_TRIES) continue
      if (Object.keys(progress.done).length >= LIMIT) return { newThisPass, stopped: true }

      log(`  ${row.pet} · ${row.owner} · ${row.phone}`)
      const listUrl = page.url()
      try {
        await downloadPet(page, row, pageNo, key)
        newThisPass++
      } catch (err) {
        if (isClosed(err)) throw Object.assign(err, { browserClosed: true })
        if (err.loggedOut || (await onLoginPage(page))) throw Object.assign(err, { loggedOut: true })
        const tries = (progress.failed[key]?.tries || 0) + 1
        progress.failed[key] = { pet: row.pet, owner: row.owner, phone: row.phone, page: pageNo, tries, error: String(err.message || err).slice(0, 300) }
        save()
        log(`  Couldn't download ${row.pet} (try ${tries} of ${MAX_TRIES}): ${progress.failed[key].error}`)
        await snapshot(page, `failed-${row.pet}`)
      }
      // Back to the list, on the same page (only if we actually left it).
      const firstBefore = rows[0] && rows[0].pet + rows[0].phone
      if (page.url() !== listUrl) await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {})
      const ok = await waitForTable(page).then(() => true).catch(() => false)
      const now = ok ? await readRows(page) : []
      if (!now.length || now.length !== rows.length || (now[0].pet + now[0].phone) !== firstBefore) {
        pageNo = await openList(page, pageNo) // the list forgot its page; step back to it
      }
    }
    if (!(await goNextPage(page))) break
    pageNo++
  }
  return { newThisPass, stopped: false }
}

// ---------- Main ----------
// A fresh Chrome window each time (reopening a saved Chrome profile made downloads crash in
// testing). The old system's login is kept in login-state.json instead, so reopening Chrome after
// a crash doesn't need you to log in again. Delete that file when the download is finished.
const LOGIN_STATE = join(OUT, 'login-state.json')
const launch = {
  headless: !!args.headless, // --headless is only for testing; normally you see the window
  // Only this automated window: no download bubble or download scanning popups getting in the way.
  args: ['--window-size=1640,1120', '--disable-features=DownloadBubble,DownloadBubbleV2', '--safebrowsing-disable-download-protection'],
  ...(args.browserPath ? { executablePath: args.browserPath } : { channel: 'chrome' }),
}
let browser, context, page
async function openBrowser() {
  browser = await chromium.launch(launch).catch((err) => {
    console.error("\nCouldn't open Chrome. Is Google Chrome installed? If it's somewhere unusual, add --browser-path \"C:\\path\\to\\chrome.exe\".\n")
    console.error(String(err.message || err).split('\n')[0])
    process.exit(1)
  })
  context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1600, height: 1000 },
    ...(existsSync(LOGIN_STATE) ? { storageState: LOGIN_STATE } : {}),
  })
  page = await context.newPage()
  page.setDefaultTimeout(PAGE_TIMEOUT_MS)
}
async function rememberLogin() {
  try {
    await context.storageState({ path: LOGIN_STATE + '.tmp', indexedDB: true })
    renameSync(LOGIN_STATE + '.tmp', LOGIN_STATE)
  } catch { /* the window may be closing */ }
}
await openBrowser()

await page.goto(LIST_URL).catch(() => {})
console.log(`
------------------------------------------------------------------
 1. In the Chrome window that just opened, log in to VetAssist.
 2. Wait until you can see the "Pets with Medical Records" list.
 3. Come back here and press Enter.
 Already done: ${Object.keys(progress.done).length} pets. Saving to: ${OUT}
------------------------------------------------------------------`)
await ask('Press Enter when the list is showing… ')
await rememberLogin()

let startPage = Number(args.startPage) || progress.lastPage || 1
let checking = false
let restarts = 0
let doneAtRestart = -1
while (true) {
  try {
    const result = await pass(page, { startPage, onlyFailed: false })
    if (result.stopped) { log(`Test limit reached (${LIMIT} pets).`); break }
    if (!checking || result.newThisPass > 0) {
      log(checking ? `Checking pass found ${result.newThisPass} more. Checking once more…` : 'Reached the last page. Doing a checking pass for anything missed…')
      checking = true
      startPage = 1
      continue
    }
    break
  } catch (err) {
    startPage = progress.lastPage || 1
    const doneNow = Object.keys(progress.done).length
    if (doneNow !== doneAtRestart) { restarts = 0; doneAtRestart = doneNow }
    if (err.browserClosed || isClosed(err)) {
      restarts++
      if (restarts > 3) {
        await ask('Chrome keeps closing without making progress. Check the PC, then press Enter to reopen it… ')
        restarts = 0
      } else log('Chrome closed. Reopening it and carrying on from the same page…')
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
    restarts++
    if (restarts > 3) {
      await ask('This keeps happening. The debug folder has screenshots. Press Enter to try again (or close this window; running again resumes)… ')
      restarts = 0
    } else log('Trying again from the same page…')
  }
}

const failed = Object.values(progress.failed)
console.log(`
------------------------------------------------------------------
 Downloaded: ${Object.keys(progress.done).length} pets
 No PDFs:    ${Object.keys(progress.noRecords).length}
 Failed:     ${failed.length}${failed.length ? ' (listed in progress.json → "failed"; run again to retry)' : ''}
 Zips are in: ${ZIPS}
------------------------------------------------------------------`)
await rememberLogin()
await browser.close()
