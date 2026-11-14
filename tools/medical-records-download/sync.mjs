// npm run sync: gets what changed in VetAssist since the last time, for the clinic app's
// Clinic Operations ▸ Import from VetAssist. Runs on the clinic owner's PC; you log in to VetAssist once.
//
//   1. Appointments: reads the whole list again (quick: rows that look the same reuse what was read before)
//      and notes the pets with a new or changed appointment.            -> output-appointments/
//   2. Medical records: downloads new pets, and those pets again (same zip names).  -> output/
//   3. Reads the downloaded zips' records.                             -> output-records/records.jsonl.gz
//   4. Takes their photos out.                                         -> output-photos/
//   5. Uploads the new photos to the app's storage (your wrangler login).
//   6. Optional: --services and --medications read those lists again (a few minutes each).
//
// If anything stops it (internet, PC restart, Chrome closing), run npm run sync again: it carries on from
// the step it was on. Options: --no-upload (skip step 5), --services, --medications, --browser-path <chrome.exe>.
// Then follow the steps it prints (the app shows each file's changes before importing anything).

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
process.chdir(HERE)
const flags = new Set(process.argv.slice(2))
const passed = (name) => { const at = process.argv.indexOf(name); return at > 0 ? [name, process.argv[at + 1]] : [] }
const browser = [...passed('--browser-path'), ...(flags.has('--headless') ? ['--headless'] : [])] // --headless: tests only
const url = { appointments: passed('--appointments-url').map((x, i) => (i ? x : '--url')), records: passed('--records-url').map((x, i) => (i ? x : '--url')) } // tests only
const OUT = resolve('output-sync')
mkdirSync(OUT, { recursive: true })
const STATE = join(OUT, 'state.json')
const LOGIN = join(OUT, 'login-state.json') // shared by every step, so you log in once (stays on this PC)
const log = (m) => console.log(`\n[${new Date().toLocaleTimeString()}] ${m}`)

let state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : null
if (!state || state.finishedAt) state = { startedAt: new Date().toISOString(), done: {} }
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 1))
save()

function run(label, script, args) {
  return new Promise((ok, fail) => {
    log(`${label}…`)
    const child = spawn(process.execPath, [script, ...args], { stdio: 'inherit' })
    child.on('close', (code) => (code === 0 ? ok() : fail(new Error(`${label} stopped (code ${code}). Run npm run sync again to carry on from here.`))))
  })
}
async function step(id, label, script, args) {
  if (state.done[id]) { log(`${label}: already done in this sync.`); return }
  await run(label, script, args)
  state.done[id] = new Date().toISOString()
  save()
}
const login = ['--login-state', LOGIN, '--auto', ...browser]

console.log(`
------------------------------------------------------------------
 VetAssist sync${Object.keys(state.done).length ? ' (carrying on)' : ''}
 A Chrome window opens: log in to VetAssist there if it asks, then press Enter here.
 After the first step, the others reuse that login.
------------------------------------------------------------------`)
try {
  await step('appointments', 'Step 1 of 5: reading the Appointments list', 'appointments.mjs', ['--refresh', ...login, ...url.appointments])
  const changed = existsSync('output-appointments/changed.json') ? JSON.parse(readFileSync('output-appointments/changed.json', 'utf8')) : []
  log(`${changed.length} pet${changed.length === 1 ? '' : 's'} with a new or changed appointment.`)
  await step('download', 'Step 2 of 5: downloading new and changed medical records', 'download.mjs', ['--redo', 'output-appointments/changed.json', ...login, ...url.records])
  const lastRun = 'output/last-run.json'
  const zips = existsSync(lastRun) ? JSON.parse(readFileSync(lastRun, 'utf8')).zips || [] : []
  await step('records', `Step 3 of 5: reading ${zips.length} downloaded zip${zips.length === 1 ? '' : 's'}`, 'records.mjs', existsSync(lastRun) ? ['--redo-zips', lastRun] : [])
  await step('photos', 'Step 4 of 5: taking out their photos', 'photos.mjs', existsSync(lastRun) ? ['--redo-zips', lastRun] : [])
  if (!flags.has('--no-upload')) await step('upload', 'Step 5 of 5: uploading new photos to the app', join('..', '..', 'scripts', 'upload-photos.mjs'), ['--dir', resolve('output-photos')])
  if (flags.has('--services')) await step('services', 'Extra: reading the Services list', 'services.mjs', login)
  if (flags.has('--medications')) await step('medications', 'Extra: reading the Medication List', 'medications.mjs', login)
} catch (err) {
  console.error(`\n${err.message}\n`)
  process.exit(1)
}
state.finishedAt = new Date().toISOString()
save()

const P = (f) => resolve(f)
const next = `VetAssist sync finished ${new Date().toLocaleString()}.

Now in the clinic app: Clinic Operations ▸ Import from VetAssist. For each step, choose the file(s),
click Check for Changes, look at what will change, then Import. Go in this order:

 1. Owners and Pets: in VetAssist, Masterlist ▸ Owners ▸ Export and Masterlist ▸ Pets ▸ Export
    (today's files, from your Downloads folder).
 2. Passed Away Pets: Masterlist ▸ Deceased Pets ▸ Export.
 3. Appointments:   ${P('output-appointments/appointments.jsonl')}
 4. Medical Records: ${P('output-records/records.jsonl.gz')}
 5. Record Photos:  ${P('output-photos/photos.jsonl')}  and  ${P('output-photos/uploaded.txt')}
${flags.has('--services') ? ` 6. Services:       ${P('output-services/services.json')}\n` : ''}${flags.has('--medications') ? ' Medications: Smart Prescription ▸ Medication List ▸ Import, folder output-medications.\n' : ''}
Run npm run sync again whenever you want the latest (e.g. every few days, and the evening before go-live).
`
writeFileSync(join(OUT, 'NEXT-STEPS.txt'), next)
console.log(`\n------------------------------------------------------------------\n${next}------------------------------------------------------------------\n(Saved in ${join(OUT, 'NEXT-STEPS.txt')})`)
