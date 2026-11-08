# Hanna Pet Wellness Center: clinic app

Staff-only app at app.hannapetwellnesscenter.com that replaces the clinic's paid veterinary system. Lean on purpose: only what the clinic uses. Plan and phases: `docs/PLAN.md`.

## Stack

- React + Vite screens in `src/`; Cloudflare Pages Functions in `functions/api/` (shared server code in `lib/`, outside `functions/` so it isn't a route).
- D1 database `hanna-clinic` (binding `DB`). Schema changes are new numbered files in `migrations/`; never edit one that has been applied.
- Login is Cloudflare Access (email PIN). `functions/api/_middleware.js` checks the Access token on every API call and the caller must be an active row in `staff` (or in `ADMIN_EMAILS`). Never add an API route that skips it.

## Data rules

- Client data never goes in git: exports, `data/`, `*.csv` and `.dev.vars` are ignored. Test with the local D1 (`.wrangler/`).
- Nothing is hard-deleted: set `deleted_at`/`deleted_by`. Log changes with `audit()`.
- Mobiles are stored as `+639XXXXXXXXX`, shown as `0917 123 4567`. Times are UTC ISO strings; calendar days are Manila `YYYY-MM-DD`.
- Every location-specific row has `branch_id` (one branch today).
- Imported owners keep their old customer numbers (`C` + 6 digits); new ones continue from the highest.
- The old system's placeholder emails (`vpnoemail…@gmail.com`) are dropped; never send to an owner without a real email.

## Brand (from the website's CLAUDE.md)

- Colours: navy `#132A6E`, deep teal `#0E7C78`, teal `#12A8A3`, apricot `#F2A65A` / `#B4610F` (sparingly), cream `#FBF7F0`.
- Fraunces 600 for headings, with one or two words in italic deep teal ("Clinic *dashboard*"). Montserrat for everything else; buttons uppercase, bold, pill-shaped.
- Only the size tokens at the top of `src/styles.css`. White cards, soft shadow, rounded corners. Lucide line icons; dog and cat only.
- Copy: plain English, short, never blames the user, always says what to do next. Buttons start with a verb.
- Must work on phones (the menu collapses; tables become stacked rows).

## Commands

```
npm install
npm run db:migrate:local                       # create the local database
npm run import:legacy -- --owners <csv> --pets <csv>
npx wrangler d1 execute hanna-clinic --local --file data/import.sql
npm run preview                                # build + serve app and API on :8788
```

Local login: `.dev.vars` with `DEV_LOGIN_EMAIL=you@example.com` and `ADMIN_EMAILS=you@example.com` (only honoured on localhost).
