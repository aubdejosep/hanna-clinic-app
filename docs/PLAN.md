# Build plan

The clinic app replaces the paid veterinary system with a lean app that has only what Hanna Pet Wellness Center uses. It lives at **app.hannapetwellnesscenter.com**, next to the website (`aubdejosep/hanna-pet-wellness-website`) on the same Cloudflare account.

## Decisions

| Area | Choice | Why |
|---|---|---|
| Screens | React + Vite | Same as the gym app |
| Hosting, API | Cloudflare Pages + Pages Functions | Same as the website; one account, one domain |
| Database | Cloudflare D1 `hanna-clinic` | Separate from the website's `hanna-leads`; the app reads website bookings from there (phase 5) |
| Files | Cloudflare R2 | Pet photos, medical images, PDFs (phase 3) |
| Staff login | The app's own email + password page, Remember me for 30 days | Familiar to staff (like the old system); no Cloudflare PIN page. Owners chose no 2FA and no location limits |
| Email out | Resend, from hello@hannapetwellnesscenter.com | Already set up and trusted |
| Email in | Cloudflare Email Routing → Email Worker | Saves a copy in the app and still forwards to hannapetwellnesscenter@atomicmail.io |
| SMS | PromoTexter or Semaphore, behind one `sendSms()` | Provider can change without a rebuild. SMS is the main reminder channel: only 5 of 1,447 imported owners have a real email |
| NFC check-in | The gym app's `bridge.py` (USB reader → `ws://localhost:8765`) | Reused nearly as-is; the tag identifies a **pet** |
| Branches | One branch; every row carries `branch_id` | A second branch becomes a settings change |
| Roles | Fixed roles: owner (the two co-owners), admin, vet, front desk, groomer | Replaces the old system's 112 separate permissions |

## Phases

| # | Phase | Status |
|---|---|---|
| 0 | Foundation: project, database, legacy import of owners and pets, house style, own login page, Clients & pets | **Built** |
| 1 | Clinic operations: staff, clinic profile with hours and social links, services price list, kiosk QR sign-up | **Built**; the services list itself is still to be entered |
| 2 | Appointments: table and calendar (day/week/month), booking, walk-in, admit inpatient, appointment page with status steps, reschedule/cancel, staff notes, NFC tag check-in | |
| 3 | Medical records: per-pet records with notes, diagnoses, vaccinations, treatment plans, consent forms and prescriptions; templates; PDF export and email to owner; import of the scraped history | Waiting on the scrape |
| 4 | Dashboard: real numbers for what the clinic uses; redesigned once the lean app is in use | Placeholders now |
| 5 | Online booking: website `/book` bookings become appointments (match owner by mobile, else create), confirmation and reminders by email | |
| 6 | SMS: confirmations and reminders (3 days before, day before, morning of) once the provider is approved | Waiting on provider |
| 7 | Inbox: hello@ mail read and answered in the app | |
| 8 | Cutover: run side by side, final data top-up, cancel the old subscription | |

The app is usable for day-to-day work after phase 3.

## NFC check-in (phase 2)

1. The front-desk PC runs the gym's `bridge.py`, with `https://app.hannapetwellnesscenter.com` added to its allowed origins.
2. The app keeps one connection to `ws://localhost:8765`. A tap sends `{type: "fob_scan", uid}`.
3. The app looks the UID up in `pet_tags`:
   - the pet has an appointment today → it is marked **Arrived**;
   - no appointment → a one-tap **Walk in** for that pet;
   - unknown tag → "Assign this tag" (search for the pet).
4. Assigning a tag is a button on the pet's page that captures the next tap (the gym's Assign Fob pattern).

## Medical records import (phase 3)

The old system can't export medical records in bulk. `tools/medical-records-download/` (run on the owner's PC) clicks each pet's **Download All PDFs** and saves one zip per pet. The PDFs identify the pet and owner (name, phone), the record ID, appointment number, visit date, each entry (type, title, description, services/products used) and its photos, so the importer reads the PDFs and matches by owner phone + pet name. Not in the PDFs: who created each entry and vaccination "date administered".

## Admin Settings (later, owners only)

A settings screen for the clinic owners, built when it's needed. Parked here so nothing is forgotten:

- **Tidy expired logins:** clear old login records (expired or logged-out sessions, and failed-login notes older than a day). Harmless to leave for now at the clinic's size.
- Merge duplicate owners (like the gym app's Merge Members), for the "Same mobile as another owner" checks.
- Change history viewer (the audit log already records who changed what).

## Out of scope for now

Inventory, finances/billing, quotations, suppliers, client portal, certificates, smart prescription, tasks, kiosk QR registration, staff attendance, device management. The inventory export (109 products) is kept for later.
