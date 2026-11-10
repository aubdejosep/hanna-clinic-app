# Hanna clinic app

The staff app for Hanna Pet Wellness Center at **app.hannapetwellnesscenter.com**: clients and pets, clinic operations and appointments, with medical records to follow. See [docs/PLAN.md](docs/PLAN.md).

Built with React + Vite and hosted on Cloudflare Pages with a D1 database. Staff log in on the app's own page with email and password; **Remember me** keeps a device logged in for 30 days.

## What's built (phases 0–2)

- **Masterlist:** search owners by name, mobile, customer number or pet; search pets by name, breed, microchip or owner; register an owner with their pets (warns when the mobile is already on file); edit owners and pets; allergies highlighted.
- **Records to check:** the 115 imported owners with a missing, odd or shared mobile, or a duplicate name, each with **Mark as checked**.
- **Login:** email + password, Remember me, Log out. 5 wrong passwords pause an account for 15 minutes. **My account** (click your name in the menu) changes your own password and logs out your other devices.
- **Remove and restore (owners only):** remove an owner (with their pets) or a pet added by mistake; bring them back from **Masterlist → Removed**. A pet that has passed away is marked, not removed, so its history stays. Nothing is ever erased.
- **Staff (Clinic operations → Staff, owners only):** add and edit staff with role, job title, licence/PTR/S2 numbers, signature, photo, address, weekly shift hours and leave days; set a staff member's password; switch someone off when they leave (logged out at once). The clinic always keeps at least one owner.
- **Clinic profile (Clinic operations → Clinic profile):** laid out like the old system's page. Basic Information tab: Business Information (with email brand colour), Social Media, Branches, Invoice Settings (tax rate), Notification Settings (CC business email), Kiosk QR Code with its agreement. Business Availability tab: opening hours with breaks. Filled in from the website; owners click Edit info on each card.
- **Menu** follows the old system: Dashboard, Clinic Operations ▸, Appointments, Client Portal ▸ Masterlist, Medical Records ▸.
- **Services (Clinic operations → Services):** the price list with categories, variations (e.g. by weight), active and "featured for online booking". Owners add, edit and remove; everyone can view.
- **Kiosk sign-up (`/kiosk`, no login):** clients scan the QR code and register themselves and up to 5 pets, in the old kiosk's steps. Protected by Cloudflare Turnstile and a limit per network; new sign-ups show under **Masterlist → Needs a check**.
- **Appointments:** the old system's table (tabs per status with counts, search, dates, staff filter, rows per page) and calendar (day, week, month); **Book Appointment** in the old 3 steps (Pet → Services → Schedule); **Walk In**; the appointment page with Status Control, Mark as Emergency, Reschedule (linked both ways), Cancel with a reason, Staff Assignment, Staff Notes, Services & Products and the visit history. **In Clinic Now** lists every pet tapped in, with how long they've been there.
- **The visit loop:** Accepted → tap in (Arrived) → Start Consultation (Started) → Admit as Inpatient or Send to Dispense if needed → tap out (Completed). Bookings nobody tapped in for become **No Show** after their day; visits never tapped out are listed under **Not Checked Out** the next day. **Undo Last Step** for mistakes.
- **NFC tags:** one tag per pet (**Assign Tag** on the pet's page). The front-desk PC runs the gym's tag bridge; turn on **Tag Reader** on the Appointments page of that PC once. A tap checks the pet in or out, offers **Walk In** when there's no booking today, and **Assign Tag** for a new tag. A second tap within 5 minutes is ignored.
- **Dashboard:** owner and pet totals and new this month, and today's appointments; the other cards are placeholders.
- **Legacy import:** `scripts/import-legacy.mjs` loads the old system's owner and pet exports, cleaning up phone numbers, placeholder emails, microchips and breed spellings (536 spellings → 293 breeds). `scripts/import-appointments.mjs` loads the scraped appointments list (see step 7).

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

### 4. Create the owner logins

Nobody can log in until a login exists. On the computer from step 2, in this folder:

```
git pull
npx wrangler d1 migrations apply hanna-clinic --remote
npm run set-password -- --email you@example.com --first YourFirstName --last YourSurname --role owner
npx wrangler d1 execute hanna-clinic --remote --file data/set-password.sql
```

The third line asks for the password twice (what you type isn't shown). Use at least 10 characters; a short sentence works well. Repeat the last two lines for the other co-owner with their email and name. Run the same two lines again any time an owner needs a new password.

Staff logins come with the Staff screen in phase 1.

### 5. Remove Cloudflare Access (if it was set up earlier)

The app has its own login now, so the Cloudflare PIN page isn't needed:

1. **Zero Trust → Access controls → Applications** → the `app.hannapetwellnesscenter.com` application → **⋯ → Delete**.
2. Optional tidy-up: **Workers & Pages → hanna-clinic-app → Settings → Variables and Secrets**: delete `ACCESS_AUD`, `ACCESS_TEAM_DOMAIN` and `ADMIN_EMAILS`. The app no longer reads them.

### 6. Kiosk sign-up ("I'm human" check)

The kiosk page is the only page clients use without logging in, so it uses Cloudflare Turnstile, the same check as the website's booking form. Until this is done, the kiosk shows "please ask the front desk".

1. **Cloudflare → Turnstile.** Open the widget the website uses and add `app.hannapetwellnesscenter.com` to its **Hostnames**, or **Add widget** for the app on its own (mode: Managed).
2. Copy its **Site Key** and **Secret Key**.
3. **Workers & Pages → hanna-clinic-app → Settings → Variables and Secrets**: add `TURNSTILE_SITE_KEY` (text) and `TURNSTILE_SECRET_KEY` (type **Secret**).
4. **Deployments → ⋯ → Retry deployment.**

Then print the QR code from **Clinic operations → Clinic profile → Kiosk QR code**.

### 7. Appointments (phase 2)

1. In PowerShell, in the `hanna-clinic-app` folder: `git pull`, then `npm run db:migrate:remote` (adds the appointments tables).
2. Load the old appointments. Put `appointments.jsonl` (from the appointments download) and the pets masterlist CSV in `data\`, then:
   ```
   npm run import:appointments -- --appointments data\appointments.jsonl --pets data\masterlist_pets_2026-11-06.csv
   npx wrangler d1 execute hanna-clinic --remote --file data/import-appointments.sql
   ```
   Read `data\import-appointments-report.md` for the few rows it couldn't match. Running it again replaces the earlier import and never touches appointments booked in the app.
3. **Tag reader on the front-desk PC.** Install the gym's fob bridge there the same way as at the gym (its README: download, unzip to e.g. `C:\HannaClinic\bridge\`, run `install-startup.bat`). Next to `bridge.exe`, create `allowed_origins.txt` with this one line: `https://app.hannapetwellnesscenter.com`, then restart the bridge. In the app on that PC: **Appointments → Tag Reader Off** (turns it on; the button then says **Tag Reader Ready**).
4. Give each pet its tag: pet's page → **NFC Tag → Assign Tag** → tap the tag.

## Working on it locally

```
npm install
npm run db:migrate:local
npm run import:legacy -- --owners <owners.csv> --pets <pets.csv>
npx wrangler d1 execute hanna-clinic --local --file data/import.sql
npm run set-password -- --email test@example.com --first Test --role owner
npx wrangler d1 execute hanna-clinic --local --file data/set-password.sql
npm run preview      # http://localhost:8788, log in as test@example.com
```

For live reload while editing screens, run `npm run dev:api` and `npm run dev` side by side and open http://localhost:5173.
