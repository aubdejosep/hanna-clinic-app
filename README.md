# Hanna clinic app

The staff app for Hanna Pet Wellness Center at **app.hannapetwellnesscenter.com**: clients and pets, clinic operations and appointments, with medical records to follow. See [docs/PLAN.md](docs/PLAN.md).

Built with React + Vite and hosted on Cloudflare Pages with a D1 database. Staff log in on the app's own page with email and password; **Remember me** keeps a device logged in for 30 days.

## What's built (phases 0–5)

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
- **Medical records (read-only):** the history from the old system on each pet's page (**Medical History** with a filter by Notes, Vaccinations, Diagnoses and Treatment Plans; **Vaccinations**), the visit's record on its appointment page, and **Medical Records → Records List** with search. Staff don't write new records in the app yet. Photos come with a later upload.
- **Dashboard:** owners open on **Overview** (counts only, no money): Visits, Services Rendered, Vaccinations, New Pet Owners and New Pets against the period before, Visits per Day, Services by Category, Appointment Outcomes, Returning vs New Clients, Busiest Days and Busiest Hours, for Month to Date, Last 7 or 30 Days, Last Month or Year to Date. Everyone else opens on the **Clinic Board** (owners have it as a tab).
- **Clinic Board:** today's visits station by station: Waiting (the queue, in arrival order, emergencies first) → With Vet → Inpatient → Dispense → Done Today. **Call Next** takes the first pet in the queue and assigns the vet who pressed it. Each card shows its unfinished steps until they're done.
- **Reminders bell** (beside the logo; top bar on phones): follow-up ticked but not booked, Dispense with no medicines, a visit checked out with no services or no vet, and pets missing breed or weight or owners missing mobile or email (added in the app, or at the clinic today). Each clears itself once done, or with **Not Needed**. Vets see their own visits and unassigned ones.
- **Website bookings:** every booking made on hannapetwellnesscenter.com/book lands in Appointments, one per pet, Accepted, Booked By "Website" (within a minute, while the app is open). Owners are matched by mobile, pets by name; new clients are created and flagged for a check (bell: "New online client"). Morning = opening time, Afternoon = 1 PM; the preference, the owner's note and travel plans are on the visit. Free consult codes become a FREE CONSULTATION item. Cancelling on the website (staff on /staff, or the client from their email) cancels it here; a client's change becomes a linked reschedule. Weight in kg and an estimated birthdate (from the age given) fill in the pet. The website reads the app's opening hours, Closed Dates and Online Booking Limits.
- **On a visit:** **Weight Today** (also the pet's latest weight), **Needs a Follow-Up** (in N days, with a reason, and **Book Follow-Up**), and **Medicine or Product** under Add Items.
- **Quick Add** (Add Items, Book Appointment, Walk In): one search for services and medicines (Enter adds the top match); **Same as Last Visit**; **Usually Goes With These**, learned from the clinic's own visits per species (e.g. Deworm → Anti Rabies, 6 in 1, Bravecto for dogs); sizes by weight picked automatically from the pet's weight (Deworm, Bravecto, Proheart, spay…). Medicines come from the old system's inventory list (names only, no stock), and a medicine typed in once is on the list next time.
- **Take Payment** (Clinic Board at Dispense, Status Control, Not Checked Out): "Anything else given?", the total from the price list, and Paid With (Cash, GCash, Maya, Card, Bank Transfer, No Charge), with change for cash. A different amount needs a reason. **Mark as Paid**, then the pet taps out; or **Paid & Check Out**. A visit tapped out unpaid gets a **Take Payment** reminder that can't be dismissed. Owners can **Void Payment** with a reason.
- **Inventory** (Inventory ▸ Product List, Stock Movements, Stock Count): stock in the smallest unit given. A visit's medicines and the stock its services use (**Uses from Stock** in Services) come off only when the visit is both paid and checked out; undo, a voided payment or a removed item puts them back. **Sell Items** for over-the-counter sales, **Receive Stock** (by the box, with expiry), **Adjust** (expired, damaged, used in clinic, lost…, with a reason). Every change is in **Stock Movements** with who, when and why, and can't be edited. **Stock Count**: the first is the baseline; later counts are blind (the app's number is hidden) and show what's missing at cost. Bell: low stock and expiring within 60 days.
- **Search everything** (beside the bell; press `/`): owners (name, customer number, mobile, email), pets (name, breed, microchip), medicines and products (price per unit, stock) and services (every variation with its price). Arrows and Enter open a result; on phones it's the magnifier in the top bar.
- **Customer Analytics** (Client Portal, owners only): New Clients and Clients Seen against the period before, Returning Clients, Repeat Rate, Spend per Client (from payments in the app), Active Clients; Client Retention Cohorts (share of each month's new clients seen again 1–12 months later, from the medical records and visits); Client Acquisition; Where New Clients Came From; Top Clients; Clients to Win Back (regulars not seen in 6–18 months, with their mobile).
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

### 16. Photos on the medical records

The 8,520 photos (paper records, prescriptions, vaccine cards) are inside the downloaded PDFs. They go to a private Cloudflare R2 bucket and show on each record; only logged-in staff can see them.

1. Create the photo storage (once), then update the app:
   ```
   npx wrangler r2 bucket create hanna-clinic-photos
   git pull
   npm run db:migrate:remote
   ```
2. Take the photos out of the PDFs (on the PC with `output\zips`; about 10–20 minutes, no internet needed):
   ```
   cd tools\medical-records-download
   npm install
   npm run photos-test
   npm run photos
   ```
   They land in `tools\medical-records-download\output-photos` (about 2 GB). Running it again carries on; `npm run photos -- --redo` reads every record again (after an update to the tool). Most photos are JPEGs, copied unchanged; a few are stored as raw pixels and are saved as PNG, with the same pixels.
3. Upload them (from the app folder; uses your wrangler login; about an hour; safe to stop and start):
   ```
   cd ..\..
   npm run upload:photos -- --dir tools\medical-records-download\output-photos
   ```
4. Link them to the records:
   ```
   npm run import:photos -- --dir tools\medical-records-download\output-photos
   npx wrangler d1 execute hanna-clinic --remote --file data/import-photos.sql
   ```
If the medical records import is ever run again, run step 4 again after it.

### 15. Medical records: keep the services lists

The first records import left out the old system's "Auto-generated note record", which holds each visit's **Services and Products**. Re-run it (same files as step 8; it replaces the earlier import):
```
git pull
npm run db:migrate:remote
npm run import:records -- --records data\records.jsonl.gz --owners data\masterlist_owners_2026-11-06.csv --pets data\masterlist_pets_2026-11-06.csv
npx wrangler d1 execute hanna-clinic --remote --file data/import-records.sql
```
Records with nothing but booked services are marked "booked services only": shown in the history with whether the visit happened, but not counted as visits.

### 14. Deceased pets from the old system

`git pull`, then (the CSV is in `data/`, which git ignores):
```
npm run import:deceased -- --csv data/deceased_2026-11-11.csv
npx wrangler d1 execute hanna-clinic --remote --file data/import-deceased.sql
```
Marks the 55 pets as passed away (matched by customer number and pet name) and cancels their upcoming bookings. The old export has no date of death, so the date is the export date (Nov 11, 2026); correct it on the pet's page if you know it.

### 13. Inventory and payments

1. `git pull`, then `npm run db:migrate:remote`.
2. Load prices and costs into the Product List (safe to run again; it only fills prices that are empty):
   ```
   npm run import:products -- --csv data/inventory_2026-11-07_20-23-59_products.csv
   npx wrangler d1 execute hanna-clinic --remote --file data/import-products.sql
   ```
3. **Baseline count:** an owner opens **Inventory → Stock Count → Start the Baseline Count**. Staff count each shelf from their phones, in the smallest unit given (tablets, ml, vials), setting the unit as they go. The owner presses **Finish Count**: that is the opening stock.
4. **Check each product's price and cost per unit** (Product List → the product → Edit). The old system's prices are per item as it sold them; after setting a product to tablets, set the price per tablet. Add **Reorder Level** for the ones that must never run out.
5. **Link services to the stock they use** (Clinic Operations → Services → a service → **Uses from Stock**), e.g. VACCINE · ANTI RABIES uses 1 vial of the rabies vaccine, DEWORM sizes use their tablets. Add the vaccines as products first (Product List → Add Product): the import leaves them out.

### 12. Quick Add and the medicines list

1. `git pull`, then `npm run db:migrate:remote`.
2. Load the medicines list from the old system's inventory export (the `…_products.csv` file; vaccines in it are left out, they're under Services):
   ```
   npm run import:products -- --csv path/to/inventory_..._products.csv
   npx wrangler d1 execute hanna-clinic --remote --file data/import-products.sql
   ```
   Suggestions ("Usually Goes With These") are worked out from the visit history once a day; nothing to set up.

### 11. Closed dates and online booking limits

`git pull`, then `npm run db:migrate:remote`. Then in **Clinic Profile → Business Availability**: add holidays under **Closed Dates** (closed all day, or special hours, with a reason clients see) and, if you like, **Online Booking Limits**. The website's /book reads both within 5 minutes.

### 10. Website bookings (phase 5)

1. Find the website database's ID: `npx wrangler d1 list` and copy the ID next to **hanna-leads**. Send it to Claude, who adds it to `wrangler.toml` as the `LEADS` binding (or add it yourself, below the `DB` block):
   ```
   [[d1_databases]]
   binding = "LEADS"
   database_name = "hanna-leads"
   database_id = "<the ID>"
   ```
2. `git pull`, then `npm run db:migrate:remote`.
3. Wait for the deployment, then open **Appointments**: upcoming website bookings appear within a minute.

### 9. Dashboard and reminders (phase 4)

`git pull`, then `npm run db:migrate:remote` (adds weights, follow-ups and reminder settings). Nothing to import.

### 8. Medical records (phase 3)

Run after step 7 (the appointments import). In PowerShell, in the `hanna-clinic-app` folder:

1. `git pull`, then `npm run db:migrate:remote` (adds the medical records tables).
2. Put `records.jsonl.gz` (from `tools\medical-records-download\output-records`) and both masterlist CSVs in `data\`, then:
   ```
   npm run import:records -- --records data\records.jsonl.gz --owners data\masterlist_owners_2026-11-06.csv --pets data\masterlist_pets_2026-11-06.csv
   npx wrangler d1 execute hanna-clinic --remote --file data/import-records.sql
   ```
   Read `data\import-records-report.md`. It also settles the bookings the old system left open (Completed when the pet has a record that day, otherwise No Show) and fills in missing birthdates and owner addresses.

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
