// Uploads the photos taken out of the old medical records (tools/medical-records-download, "npm run photos")
// to the app's private photo storage (Cloudflare R2 bucket hanna-clinic-photos).
//
//   npm run upload:photos -- --dir ..\tools\medical-records-download\output-photos
//
// Uses your wrangler login (no keys needed). 4 at a time; about an hour for all of them on a normal
// connection. Running it again skips what's already uploaded (listed in <dir>\uploaded.txt), so it's
// safe to stop and start. Add --local to put them in the local test copy instead.

import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, a, i, all) => (a.startsWith('--') ? [...pairs, [a.slice(2), all[i + 1]?.startsWith('--') ? true : all[i + 1] ?? true]] : pairs), []))
if (!args.dir || args.dir === true) { console.error('Usage: npm run upload:photos -- --dir <output-photos folder> [--local]'); process.exit(1) }
const DIR = resolve(args.dir)
const BUCKET = 'hanna-clinic-photos'
const where = args.local ? '--local' : '--remote'
const manifest = join(DIR, 'photos.jsonl')
if (!existsSync(manifest)) { console.error(`Can't find ${manifest}. Run "npm run photos" in tools\\medical-records-download first.`); process.exit(1) }
const DONE = join(DIR, args.local ? 'uploaded-local.txt' : 'uploaded.txt')
const done = new Set(existsSync(DONE) ? readFileSync(DONE, 'utf8').split('\n').filter(Boolean) : [])
const photos = readFileSync(manifest, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
const todo = photos.filter((p) => !done.has(p.key))
console.log(`${photos.length} photos; ${done.size} already uploaded; ${todo.length} to go (${where.slice(2)}).`)

function put(p) {
  return new Promise((ok) => {
    const child = spawn('npx', ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${p.key}`, '--file', join(DIR, p.path), '--content-type', p.type || 'image/jpeg', where],
      { shell: process.platform === 'win32', stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    child.stderr.on('data', (d) => { err += d })
    child.on('close', (code) => ok(code === 0 ? null : err.trim().split('\n').slice(-2).join(' ') || `exit ${code}`))
  })
}

// A failed upload (a dropped connection, a busy moment) is tried up to 3 times before it's reported.
async function putWithRetry(p) {
  let error = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    error = await put(p)
    if (!error) return null
    await new Promise((r) => setTimeout(r, attempt * 2000))
  }
  return error
}

let next = 0
let ok = 0
let failed = 0
const started = Date.now()
async function worker() {
  while (next < todo.length) {
    const p = todo[next++]
    const error = await putWithRetry(p)
    if (error) { failed++; console.log(`  Not uploaded: ${p.key}: ${error.slice(0, 200)}`); continue }
    appendFileSync(DONE, `${p.key}\n`)
    ok++
    if (ok % 100 === 0) {
      const per = (Date.now() - started) / ok
      console.log(`${ok + done.size} of ${photos.length} uploaded. About ${Math.ceil((per * (todo.length - ok - failed)) / 60000)} min to go.`)
    }
  }
}
await Promise.all(Array.from({ length: Number(args.parallel) || 4 }, worker))
console.log(`Done: ${ok} uploaded now, ${failed} failed${failed ? ' (run it again to retry them)' : ''}. Total uploaded: ${ok + done.size} of ${photos.length}.`)
