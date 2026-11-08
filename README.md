# Hanna clinic app

The staff app for Hanna Pet Wellness Center at **app.hannapetwellnesscenter.com**: clients and pets now, with appointments, medical records and clinic operations to follow. See [docs/PLAN.md](docs/PLAN.md).

Built with React + Vite, hosted on Cloudflare Pages with a D1 database, and locked by Cloudflare Access, the same setup as the website's `/staff` page.

## What's built (phase 0)

- **Clients & pets:** search owners by name, mobile, customer number or pet; search pets by name, breed, microchip or owner; register an owner with their pets (warns when the mobile is already on file); edit owners and pets; allergies highlighted.
- **Records to check:** the 115 imported owners with a missing, odd or shared mobile, or a duplicate name, each with **Mark as checked**.
- **Dashboard:** owner and pet totals and new this month; the other cards are placeholders.
- **Legacy import:** `scripts/import-legacy.mjs` loads the old system's owner and pet exports, cleaning up phone numbers, placeholder emails, microchips and breed spellings (536 spellings → 293 breeds).

## Go live (one time, in Cloudflare)

Everything is in the same Cloudflare account as the website.

### 1. Create the database

**Storage & databases → D1 → Create**, name it `hanna-clinic`. Copy its **Database ID** into `wrangler.toml` (`database_id = "…"`) and commit.

### 2. Create the tables and load the clients

On a computer with Node.js, in this folder:

```
npm install
npx wrangler login
npx wrangler d1 migrations apply hanna-clinic --remote
npm run import:legacy -- --owners masterlist_owners.csv --pets masterlist_pets.csv
npx wrangler d1 execute hanna-clinic --remote --file data/import.sql
```

Run the last line **once**. `data/import-report.md` lists what was cleaned up. Don't share it: it contains client details.

### 3. Create the Pages project

1. **Workers & Pages → Create → Looking to deploy Pages? Get started → Import an existing Git repository** → `aubdejosep/hanna-clinic-app`.
2. Project name `hanna-clinic-app`, production branch `main`, framework preset **None**, build command `npm run build`, output directory `dist`.
3. **Save and Deploy.** The database connection comes from `wrangler.toml`.
4. **Custom domains → Set up a custom domain** → `app.hannapetwellnesscenter.com`.

### 4. Lock it with Cloudflare Access

1. **Zero Trust → Access → Applications → Add an application → Self-hosted.**
2. Application domain: `app.hannapetwellnesscenter.com`. Add a second one for preview links: `*.hanna-clinic-app.pages.dev`.
3. Policy: **Allow**, include **Emails**: the owner and each staff member. Login method: **One-time PIN**.
4. Copy the **Application Audience (AUD) Tag**.
5. In the Pages project, go to **Settings → Variables and Secrets** and add:

| Name | Value |
|---|---|
| `ACCESS_TEAM_DOMAIN` | your team domain, e.g. `hanna.cloudflareaccess.com` (Zero Trust → Settings) |
| `ACCESS_AUD` | the AUD tag from step 4 |
| `ADMIN_EMAILS` | the owner's email (comma-separate several) |

6. Redeploy (**Deployments → … → Retry deployment**) so the settings take effect.

Staff added in Access also need a staff record in the app. Until phase 1 adds the Staff screen, only `ADMIN_EMAILS` can get in.

## Working on it locally

```
npm install
npm run db:migrate:local
npm run import:legacy -- --owners <owners.csv> --pets <pets.csv>
npx wrangler d1 execute hanna-clinic --local --file data/import.sql
echo "DEV_LOGIN_EMAIL=you@example.com" > .dev.vars
echo "ADMIN_EMAILS=you@example.com" >> .dev.vars
npm run preview      # http://localhost:8788
```

For live reload while editing screens, run `npm run dev:api` and `npm run dev` side by side and open http://localhost:5173.

`DEV_LOGIN_EMAIL` only works on `localhost`. Anywhere else the API requires a Cloudflare Access login.
