// Reads one receipt photo with Claude, for Finances ▸ Ledger. The key is the Cloudflare secret ANTHROPIC_API_KEY
// (the clinic's own Anthropic account, paid per use); the model is RECEIPT_MODEL (default below), so it can be
// switched without a code change. Prompt and fields as tested in tools/receipt-reading-test (receipt numbers are
// reliable; handwritten amounts are not, so the Ledger always asks a person to check them against the photo).

import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'

export const DEFAULT_MODEL = 'claude-sonnet-5-5'
const PRICE = { 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5], 'claude-opus-5-5': [4, 20] } // USD per million tokens (in, out)

const Reading = z.object({
  is_receipt: z.boolean().describe('false for anything that is not one receipt: a ledger notebook page, a summary sheet, an unrelated photo'),
  kind: z.enum(['OR', 'QR', 'none']).describe('OR = yellow SERVICE INVOICE (numbers like 02519); QR = pink or white QUOTATION SLIP (numbers like 05337)'),
  receipt_no: z.string().describe('The red stamped number after "No." exactly as printed, 5 digits with leading zero, e.g. "05337"; empty if none'),
  date: z.string().describe('The date written on the slip as YYYY-MM-DD (slips are written month/day/year, e.g. 11/16/26); empty if none'),
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
  unclear: z.array(z.string()).describe('Names of the fields you are unsure about (receipt_no, client, pet, items, discount, total, paid_hint, date)'),
})

const SYSTEM = `You read photos of paper receipts from a veterinary clinic in Manila for its cash ledger.
There are two kinds of slips: yellow SERVICE INVOICE (kind OR, red printed number like 02519) and pink or white QUOTATION SLIP (kind QR, red number like 05337). The red number after "No." is hand-stamped and is the most important field: copy all 5 digits exactly, including the leading zero.
The client line reads "Owner / Pet". Lines have a description and an amount in pesos; quantities are written like "7x150" (7 at 150). A discount appears as "less 20" or "dis 10". Crossed-out lines are not charged. Amounts are whole pesos, written without the peso sign, sometimes with a comma (1,400).
Photos are often taken sideways or upside down: read them in whatever orientation they are. Some photos are not receipts (a ledger notebook page, a summary sheet): mark those is_receipt false and leave the rest empty.
When a value is hard to read, give your best reading and list the field in unclear. Never invent items that are not on the slip.`

function base64(buf) {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

// -> { reading, model, usage, costUsd } or throws an Error with a plain message (err.status for the HTTP reply).
export async function readReceipt(env, image, mediaType) {
  if (!env.ANTHROPIC_API_KEY) throw Object.assign(new Error('Photo reading isn’t set up yet: an owner needs to add the Anthropic key (see the README).'), { status: 503 })
  if (image.byteLength > 5 * 1024 * 1024) throw Object.assign(new Error('This photo is too big to read (over 5 MB).'), { status: 400 })
  const model = env.RECEIPT_MODEL || DEFAULT_MODEL
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}) }) // base URL: e.g. Cloudflare AI Gateway
  let res
  try {
    res = await client.beta.messages.parse({
      model,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      output_config: { effort: 'medium', format: betaZodOutputFormat(Reading) },
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: base64(image) } },
        { type: 'text', text: 'Read this photo.' },
      ] }],
    })
  } catch (err) {
    const status = err && err.status
    const msg = status === 401 ? 'The Anthropic key was refused. An owner needs to check it.'
      : status === 400 && /credit|billing/i.test(err.message || '') ? 'The Anthropic account is out of credits. An owner needs to top it up.'
      : status === 429 || status === 529 ? 'Photo reading is busy right now. Try again in a minute.'
      : 'The photo couldn’t be read right now. Try again, or type it in.'
    throw Object.assign(new Error(msg), { status: status === 401 || status === 400 ? 503 : 502, detail: String(err && err.message || err).slice(0, 300) })
  }
  const usedModel = res.model || model
  const [pin, pout] = PRICE[usedModel] || PRICE[model] || [0, 0]
  const costUsd = Math.round(((res.usage.input_tokens * pin + res.usage.output_tokens * pout) / 1e6) * 10000) / 10000
  const usage = { input: res.usage.input_tokens, output: res.usage.output_tokens }
  if (res.stop_reason === 'refusal' || !res.parsed_output) throw Object.assign(new Error('The photo couldn’t be read. Type it in instead.'), { status: 422, costUsd })
  return { reading: res.parsed_output, model: usedModel, usage, costUsd }
}

const pesos = (n) => (n == null || !Number.isFinite(Number(n)) ? null : Math.round(Number(n) * 100))
const ONLINE = { gcash: 'gcash', bank: 'bank', maribank: 'maribank', card: 'card', qrph: 'qrph' }

// The Ledger columns a reading fills: { receipt_no | receipt_qr, client_name, pet_names, amount_cents, discount_cents,
// paid_with, income_cents, online_cents } and the items. Only for a receipt.
export function readingToRow(r) {
  if (!r || !r.is_receipt) return { fields: {}, items: [] }
  const no = String(r.receipt_no || '').replace(/\D/g, '')
  const num = no ? no.padStart(5, '0') : null
  const total = pesos(r.total)
  const discount = pesos(r.discount) || null
  const paid = ONLINE[r.paid_hint] || (r.paid_hint === 'cash' ? 'cash' : null)
  const f = {
    ...(num ? (r.kind === 'OR' ? { receipt_no: num } : { receipt_qr: num }) : {}),
    client_name: String(r.client || '').trim().slice(0, 120) || null,
    pet_names: String(r.pet || '').trim().slice(0, 200) || null,
    amount_cents: total,
    discount_cents: discount,
    paid_with: paid,
    income_cents: total != null ? total + (discount || 0) : null,
    online_cents: paid && paid !== 'cash' && total != null ? total : null,
  }
  const items = (r.items || []).slice(0, 40).map((x) => ({
    item: String(x.name || '').trim().slice(0, 120) || null,
    amount_cents: pesos(x.amount ?? (x.qty != null && x.unit_price != null ? x.qty * x.unit_price : null)),
  })).filter((x) => x.item || x.amount_cents != null)
  return { fields: f, items }
}
