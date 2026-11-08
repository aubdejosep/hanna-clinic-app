// Creates a login, or sets a new password for an existing one, without the app.
// Used to create the two owner logins before the Staff screen exists.
//
//   npm run set-password -- --email you@example.com --first Aubrey --last Surname --role owner
//
// It asks for the password (typing isn't shown), then writes data/set-password.sql.
// Load it with:  npx wrangler d1 execute hanna-clinic --remote --file data/set-password.sql
// The file holds only a scrambled form of the password, never the password itself (data/ is git-ignored).

import { createInterface } from 'node:readline'
import { mkdirSync, writeFileSync } from 'node:fs'
import { hashPassword, passwordProblem } from '../lib/password.js'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []),
)
const ROLES = ['owner', 'admin', 'vet', 'front_desk', 'groomer']
const email = String(args.email || '').trim().toLowerCase()
const role = args.role || 'owner'
if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || !args.first || !ROLES.includes(role)) {
  console.error('Usage: npm run set-password -- --email you@example.com --first Aubrey --last Surname [--role owner] [--title "Co-owner"]')
  console.error(`Roles: ${ROLES.join(', ')}`)
  process.exit(1)
}

// One prompt session for both questions. Lines are queued, so an answer typed (or pasted)
// before the next question appears isn't lost.
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
let prompt = ''
rl._writeToOutput = (text) => { if (text.includes(prompt)) process.stdout.write(prompt) } // never echo the typing
const lines = []
let waiting = null
rl.on('line', (line) => (waiting ? (waiting(line), (waiting = null)) : lines.push(line)))
function askHidden(question) {
  prompt = question
  process.stdout.write(question)
  return new Promise((resolve) => {
    const done = (answer) => { process.stdout.write('\n'); resolve(answer) }
    if (lines.length) done(lines.shift())
    else waiting = done
  })
}

const password = await askHidden(`Password for ${email}: `)
const problem = passwordProblem(password)
if (problem) { console.error(problem); process.exit(1) }
const again = await askHidden('Type it again: ')
rl.close()
if (again !== password) { console.error("The two passwords don't match. Run it again."); process.exit(1) }

const q = (v) => (v == null || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
const hash = await hashPassword(password)
const title = args.title || (role === 'owner' ? 'Co-owner' : null)
const sql = `INSERT INTO staff (email, first_name, last_name, title, role, password_hash, active)
VALUES (${q(email)}, ${q(args.first)}, ${q(args.last || '')}, ${q(title)}, ${q(role)}, ${q(hash)}, 1)
ON CONFLICT (email) DO UPDATE SET password_hash = excluded.password_hash, first_name = excluded.first_name,
  last_name = excluded.last_name, title = excluded.title, role = excluded.role, active = 1,
  failed_logins = 0, locked_until = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
INSERT INTO audit_log (actor, action, entity, detail) VALUES ('set-password script', 'set_password', 'staff', ${q(JSON.stringify({ email, role }))});
`
mkdirSync('data', { recursive: true })
writeFileSync('data/set-password.sql', sql)
console.log(`Saved data/set-password.sql for ${email} (${role}). Now run:`)
console.log('  npx wrangler d1 execute hanna-clinic --remote --file data/set-password.sql')
