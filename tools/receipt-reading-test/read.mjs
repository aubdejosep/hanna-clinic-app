// Receipt reading test: reads every receipt photo with each model and scores it against the answer key
// (data/receipt-answer-key.json, checked by hand against the sister's ledgers). Runs on the owner's PC.
//
//   set ANTHROPIC_API_KEY=...            (PowerShell: $env:ANTHROPIC_API_KEY="...")
//   npm install
//   node read.mjs --photos C:\receipts   (folders inside it named 2026-11-15, 2026-11-16, 2026-11-19)
//
// Options: --models claude-sonnet-5-5,claude-haiku-5-5   --key ../../data/receipt-answer-key.json   --days 2026-11-16
// Writes results/<time>/ (each model's readings and report.md). Those contain client names: never commit them.
// Receipt numbers matter most; then totals, items, names and the payment hint.

import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback }
const PHOTOS = arg('photos')
const KEY = path.resolve(arg('key', path.join(here, '..', '..', 'data', 'receipt-answer-key.json')))
const MODELS = arg('models', 'claude-sonnet-5-5,claude-haiku-5-5').split(',')
const ONLY_DAYS = arg('days') ? arg('days').split(',') : null
const PRICE = { 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5], 'claude-opus-5-5': [4, 20] } // USD per million tokens (in, out)
const PARALLEL = 3
if (!PHOTOS || !fs.existsSync(PHOTOS)) { console.error('Give the photos folder: node read.mjs --photos <folder with 2026-11-15, 2026-11-16, ...>'); process.exit(1) }
if (!fs.existsSync(KEY)) { console.error(`Answer key not found: ${KEY}`); process.exit(1) }
const key = JSON.parse(fs.readFileSync(KEY, 'utf8')).days

const Reading = z.object({
  is_receipt: z.boolean().describe('false for anything that is not one receipt: a ledger notebook page, a summary sheet, an unrelated photo'),
  kind: z.enum(['OR', 'QR', 'none']).describe('OR = yellow SERVICE INVOICE (numbers like 02519); QR = pink or white QUOTATION SLIP (numbers like 05337)'),
  receipt_no: z.string().describe('The red stamped number after "No." exactly as printed, 5 digits with leading zero, e.g. "05337"; empty if none'),
  client: z.string().describe('The owner name from the Client / Sold To line (before a slash); empty if none'),
  pet: z.string().describe('The pet name after the slash, if written; empty if none'),
  items: z.array(z.object({
    name: z.string(),
    qty: z.number().nullable().describe('Only when written, e.g. 7 for "7x150"'),
    unit_price: z.number().nullable().describe('Only when written, e.g. 150 for "7x150"'),
    amount: z.number().nullable().describe('The amount in pesos in the Amount column for this line'),
  })).describe('Each line that is charged; leave out crossed-out lines'),
  discount: z.number().nullable().describe('Pesos taken off ("less 20", "dis 10"), if written'),
  total: z.number().nullable().describe('The final total in pesos (the Total box or the last figure, after any discount)'),
  paid_hint: z.enum(['none', 'cash', 'gcash', 'bank', 'maribank', 'card', 'qrph', 'online']).describe('Only if a payment method is written on the slip (e.g. "G-cash", "BDO", "B", "OL" circled); otherwise none'),
  unclear: z.array(z.string()).describe('Names of the fields you are unsure about'),
})

const SYSTEM = `You read photos of paper receipts from a veterinary clinic in Manila for its cash ledger.
There are two kinds of slips: yellow SERVICE INVOICE (kind OR, red printed number like 02519) and pink or white QUOTATION SLIP (kind QR, red number like 05337). The red number after "No." is hand-stamped and is the most important field: copy all 5 digits exactly, including the leading zero.
The client line reads "Owner / Pet". Lines have a description and an amount in pesos; quantities are written like "7x150" (7 at 150). A discount appears as "less 20" or "dis 10". Crossed-out lines are not charged. Amounts are whole pesos, written without the peso sign, sometimes with a comma (1,400).
Photos are often taken sideways or upside down: read them in whatever orientation they are. Some photos are not receipts (a ledger notebook page, a summary sheet): mark those is_receipt false and leave the rest empty.
When a value is hard to read, give your best reading and list the field in unclear. Never invent items that are not on the slip.`

const client = new Anthropic()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function readPhoto(model, file) {
  const data = fs.readFileSync(file)
  if (data.length > 5 * 1024 * 1024) return { error: 'photo over 5 MB (skipped)' }
  const started = Date.now()
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await client.messages.parse({
        model,
        max_tokens: 8000,
        system: SYSTEM,
        output_config: { effort: 'medium', format: zodOutputFormat(Reading) },
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: data.toString('base64') } },
          { type: 'text', text: 'Read this photo.' },
        ] }],
      })
      const [pin, pout] = PRICE[model] || [0, 0]
      const cost = (response.usage.input_tokens * pin + response.usage.output_tokens * pout) / 1e6
      if (response.stop_reason === 'refusal') return { error: 'refused', seconds: (Date.now() - started) / 1000, cost }
      return { reading: response.parsed_output, seconds: (Date.now() - started) / 1000, cost, usage: response.usage }
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError && attempt < 4) { await sleep(5000 * attempt); continue }
      return { error: err.message, seconds: (Date.now() - started) / 1000, cost: 0 }
    }
  }
}

const digits = (s) => String(s || '').replace(/\D/g, '').padStart(5, '0').slice(-5)
const letters = (s) => String(s || '').toLowerCase().replace(/[^a-zñ]/g, '')
function lev(a, b) {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) m[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return m[a.length][b.length]
}
const sameName = (a, b) => { const x = letters(a); const y = letters(b); return !!x && !!y && (x.startsWith(y.slice(0, 4)) || y.startsWith(x.slice(0, 4)) || lev(x, y) <= 2) }
const amountsOf = (items) => items.map((i) => i.amount ?? (i.qty != null && i.unit_price != null ? i.qty * i.unit_price : null)).filter((a) => a != null && a > 0).sort((a, b) => a - b)
const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])

function score(day, results) {
  const k = key[day]
  const withPhoto = k.receipts.filter((r) => r.photo)
  const byNo = Object.fromEntries(k.receipts.map((r) => [r.no, r]))
  const s = { day, photos: results.length, expectedNonReceipts: k.photos - withPhoto.length, receipts: withPhoto.length, numberRight: 0, totalRight: 0, itemsChecked: 0, itemsRight: 0, nameRight: 0, hints: 0, hintsRight: 0, nonReceipts: 0, wrongNumbers: [], missed: [], totalMisses: [], errors: 0, seconds: 0, cost: 0 }
  const seen = new Set()
  for (const r of results) {
    s.seconds += r.seconds || 0; s.cost += r.cost || 0
    if (r.error) { s.errors++; continue }
    const x = r.reading
    if (!x.is_receipt) { s.nonReceipts++; continue }
    const no = digits(x.receipt_no)
    const truth = byNo[no]
    if (!truth || !truth.photo) { s.wrongNumbers.push(`${r.file}: read ${x.receipt_no || '(none)'}`); continue }
    if (seen.has(no)) { s.wrongNumbers.push(`${r.file}: ${no} read twice`); continue }
    seen.add(no); s.numberRight++
    if (x.total === truth.total) s.totalRight++; else s.totalMisses.push(`${no}: read ${x.total}, is ${truth.total}`)
    if (truth.items) { s.itemsChecked++; if (sameList(amountsOf(x.items), truth.items)) s.itemsRight++ }
    if (sameName(x.client, truth.client)) s.nameRight++
    if (x.paid_hint !== 'none') { s.hints++; if ((x.paid_hint !== 'cash') === !!truth.online) s.hintsRight++ }
  }
  s.missed = withPhoto.filter((r) => !seen.has(r.no)).map((r) => r.no)
  return s
}

async function runModel(model, days, outDir) {
  const all = []
  for (const day of days) {
    const folder = path.join(PHOTOS, day)
    const files = fs.readdirSync(folder).filter((f) => /\.(jpe?g)$/i.test(f)).sort()
    const results = []
    let next = 0
    process.stdout.write(`${model} · ${day}: `)
    await Promise.all(Array.from({ length: PARALLEL }, async () => {
      while (next < files.length) {
        const file = files[next++]
        const r = await readPhoto(model, path.join(folder, file))
        results.push({ file, ...r })
        process.stdout.write(r.error ? 'x' : '.')
      }
    }))
    process.stdout.write('\n')
    fs.writeFileSync(path.join(outDir, `${model}-${day}.json`), JSON.stringify(results, null, 1))
    all.push(score(day, results))
  }
  return all
}

const days = Object.keys(key).filter((d) => (!ONLY_DAYS || ONLY_DAYS.includes(d)) && fs.existsSync(path.join(PHOTOS, d)))
if (!days.length) { console.error(`No day folders found in ${PHOTOS} (expected ${Object.keys(key).join(', ')})`); process.exit(1) }
const outDir = path.join(here, 'results', new Date().toISOString().replace(/[:.]/g, '-'))
fs.mkdirSync(outDir, { recursive: true })
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '–')
let report = `# Receipt reading test\n\nDays: ${days.join(', ')}. Answer key: ${KEY}\n\n| Model | Receipt numbers | Wrong numbers | Totals | Items (Nov 16, 19) | Owner names | Payment hints right | Non-receipts found | Errors | Avg seconds | Cost (USD) |\n|---|---|---|---|---|---|---|---|---|---|---|\n`
const details = []
for (const model of MODELS) {
  const sc = await runModel(model, days, outDir)
  const t = sc.reduce((a, s) => { for (const k of Object.keys(s)) if (typeof s[k] === 'number') a[k] = (a[k] || 0) + s[k]; return a }, {})
  report += `| ${model} | ${t.numberRight}/${t.receipts} (${pct(t.numberRight, t.receipts)}) | ${sc.reduce((n, s) => n + s.wrongNumbers.length, 0)} | ${t.totalRight}/${t.numberRight} (${pct(t.totalRight, t.numberRight)}) | ${t.itemsRight}/${t.itemsChecked} (${pct(t.itemsRight, t.itemsChecked)}) | ${t.nameRight}/${t.numberRight} (${pct(t.nameRight, t.numberRight)}) | ${t.hintsRight}/${t.hints} | ${t.nonReceipts}/${t.expectedNonReceipts} | ${t.errors} | ${(t.seconds / t.photos).toFixed(1)} | $${t.cost.toFixed(3)} |\n`
  for (const s of sc) details.push(`### ${model} · ${s.day}\n- Missed receipt numbers: ${s.missed.join(', ') || 'none'}\n- Wrong or extra numbers: ${s.wrongNumbers.join('; ') || 'none'}\n- Totals read wrong: ${s.totalMisses.join('; ') || 'none'}\n`)
}
report += `\nCost per receipt at this rate × 30 receipts a day × 30 days gives the monthly figure.\n\n${details.join('\n')}`
fs.writeFileSync(path.join(outDir, 'report.md'), report)
console.log(`\n${report}\nSaved in ${outDir}`)
