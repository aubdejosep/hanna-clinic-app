// The clinic's email to a client, for messages the app sends itself (visit reminders, tests from
// Settings ▸ Messages): "Hi Maria," + the editable opening line + details + the clinic's footer,
// in the website's style. -> { subject, text, html } for lib/email.js sendEmail.

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const CLINIC = {
  name: 'Hanna Pet Wellness Center',
  address: '1266 Unit B Marian Townhouse, Pablo Ocampo St. cor. G. Del Pilar St., Malate, Manila 1004',
  phones: '(02) 8899-8194 · 0968 661 0021 · 0916 415 8426',
  website: 'https://hannapetwellnesscenter.com',
  messenger: 'https://m.me/HannaPetWellness',
}

export function clientEmail({ subject, intro, firstName, details = [], note = '' }) {
  const hi = firstName ? `Hi ${firstName},` : 'Hi,'
  const rows = details.filter(([, v]) => v)
  const text = [hi, '', intro, ...(note ? ['', note] : []), ...(rows.length ? ['', ...rows.map(([k, v]) => `${k}: ${v}`)] : []),
    '', `Questions or changes? Message us on Messenger (${CLINIC.messenger}) or call ${CLINIC.phones}.`, '', CLINIC.name, CLINIC.address, CLINIC.website].join('\n')
  const html = `<!doctype html><html><body style="margin:0;background:#FBF7F0;font-family:Montserrat,Arial,sans-serif;color:#132A6E;">
<div style="max-width:560px;margin:0 auto;padding:24px 16px;">
<div style="background:#ffffff;border-radius:24px;padding:28px 26px;font-size:16px;line-height:1.55;">
<p style="margin:0 0 12px;">${esc(hi)}</p>
<p style="margin:0 0 16px;">${esc(intro)}</p>
${note ? `<p style="margin:0 0 16px;color:#46527A;font-size:14px;">${esc(note)}</p>` : ''}
${rows.length ? `<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 18px;font-size:15px;">${rows.map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#46527A;vertical-align:top;white-space:nowrap;">${esc(k)}</td><td style="padding:6px 0;font-weight:700;">${esc(v)}</td></tr>`).join('')}</table>` : ''}
<p style="margin:0;text-align:center;"><a href="${CLINIC.messenger}" style="display:inline-block;background:#12A8A3;color:#ffffff;text-decoration:none;font-weight:700;text-transform:uppercase;font-size:14px;letter-spacing:.5px;padding:12px 22px;border-radius:999px;">Send message</a></p>
</div>
<p style="margin:18px 8px 0;font-size:13px;line-height:1.5;color:#46527A;text-align:center;">${esc(CLINIC.name)}<br>${esc(CLINIC.address)}<br>${esc(CLINIC.phones)}<br><a href="${CLINIC.website}" style="color:#0E7C78;">hannapetwellnesscenter.com</a></p>
</div></body></html>`
  return { subject, text, html }
}
