# Hanna Pet Wellness Center: clinic app

Staff-only app at app.hannapetwellnesscenter.com that replaces the clinic's paid veterinary system. Lean on purpose: only what the clinic uses. Plan and phases: `docs/PLAN.md`.

## Stack

- React + Vite screens in `src/`; Cloudflare Pages Functions in `functions/api/` (shared server code in `lib/`, outside `functions/` so it isn't a route).
- D1 database `hanna-clinic` (binding `DB`). Schema changes are new numbered files in `migrations/`; never edit one that has been applied.
- Login is the app's own: email + password, "Remember me" for 30 days (`lib/auth.js`, `functions/api/auth/`). `functions/api/_middleware.js` checks the session on every API call; only `/api/auth/login` and the kiosk's `/api/kiosk/config` and `/api/kiosk/register` are open (the kiosk checks its on/off switch, Cloudflare Turnstile and a per-network limit, and never shows client data). Never add another open route. Passwords are PBKDF2 hashes (`lib/password.js`); 5 wrong tries pause an account for 15 minutes. No Cloudflare Access, no 2FA, no location or device limits (owners' decision).

## Build principles

- **Familiar first.** The staff have used the old system for years. Keep its names, layouts and flows wherever they work (e.g. the appointment statuses, the 3-step booking panel, "Register Pet Owner/Pets"), and only trim what the clinic doesn't use. Intuitive, but never surprising.
- Menu and page names follow the old system: Clinic Operations ▸ (Clinic profile, Staff, Services), Client Portal ▸ Masterlist (owners and pets), Medical Records ▸ (Records list, Templates).
- Lean: only build what the clinic uses. Ask before adding features the old system had but nobody has mentioned.

## Data rules

- Client data never goes in git: exports, `data/`, `*.csv` and `.dev.vars` are ignored. Test with the local D1 (`.wrangler/`).
- Nothing is hard-deleted: set `deleted_at`/`deleted_by`. Log changes with `audit()`.
- Mobiles are stored as `+639XXXXXXXXX`, shown as `0917 123 4567`. Times are UTC ISO strings; calendar days are Manila `YYYY-MM-DD`.
- Every location-specific row has `branch_id` (one branch today).
- Imported owners keep their old customer numbers (`C` + 6 digits); new ones continue from the highest.
- The old system's placeholder emails (`vpnoemail…@gmail.com`) are dropped; never send to an owner without a real email.

## Brand (from the website's CLAUDE.md)

- Colours: navy `#132A6E`, deep teal `#0E7C78`, teal `#12A8A3`, apricot `#F2A65A` / `#B4610F` (sparingly), cream `#FBF7F0`.
- **TeX Gyre Heros** (free Helvetica-style font) for everything (headings and text), regular 400 and bold 700 only, self-hosted in `public/fonts/` with its licence. No other fonts. (Helvetica Neue may replace it once a web licence is bought.) Buttons uppercase, bold, pill-shaped.
- **Two text colours only:** `--heading` (navy) for titles, names and numbers; `--text` for everything else. No coloured words in headings, no teal or apricot text. Teal and apricot are for buttons, icons, badges and highlights. Red only for error messages.
- **Soft UI** look: plain cream page, white cards with a hairline border and a very soft low shadow, white fields with a border, solid teal buttons. Not neumorphic: no double shadows, nothing sunk in. Use the tokens in `src/styles.css`, not new shadows or colours.
- **Themes** (Account ▸ Settings, per person): "Hanna Pet - Brand Colors" (default, the tokens above), "High Contrast" and "Classic Navy" (like the old system: navy sidebar, white page), plus Text Size (Standard/Large/Larger). They work by overriding the tokens, so new screens must use the tokens, never fixed colours or sizes.
- Only the size tokens at the top of `src/styles.css`. Lucide line icons; dog and cat only.
- Copy: plain English, short, never blames the user, always says what to do next. Buttons start with a verb.
- **Title Case** for names and labels, like the old system: menu items, page and card titles, tabs, table headers, field labels, buttons and badges ("Clinic Operations", "Phone Number", "Save Changes"). Small words stay lowercase inside a label ("Records to Check", "Mark as Checked"). Sentences (hints, descriptions, messages, toasts) stay in normal sentence case.
- Must work on phones (the menu collapses; tables become stacked rows).

## Commands

```
npm install
npm run db:migrate:local                       # create the local database
npm run import:legacy -- --owners <csv> --pets <csv>
npx wrangler d1 execute hanna-clinic --local --file data/import.sql
npm run set-password -- --email <e> --first <name> --role owner   # make a login without the app
npm run preview                                # build + serve app and API on :8788
```

Local login: create a test login with `npm run set-password -- --email test@example.com --first Test --role owner`, then `npx wrangler d1 execute hanna-clinic --local --file data/set-password.sql`.
