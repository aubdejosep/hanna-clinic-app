# Download the medical records from the old system

The old system (VetAssist) has no export for medical records, but each pet's page has a
**Download All PDFs** button. This script clicks it for every pet, about 2,670 of them, and
saves one zip per pet. The PDFs inside name the pet, the owner, their phone and the record IDs,
so the new app can put every record back on the right pet later.

It runs on your PC in its own Chrome window. **You log in yourself**; the script never sees your
password.

## What you need

- This PC with **Google Chrome** and **Node.js** (the same Node you use for `wrangler`).
- Roughly **3 to 6 hours** for the full download. Leave it running, overnight is ideal.
- Enough free disk space. Records with photos are big, so expect several GB. The
  `output` folder can be on another drive with `--out` (see below).

## 1. One-time setup

In PowerShell, from the `hanna-clinic-app` folder:

```
git pull
cd tools\medical-records-download
npm install
```

## 2. Test run: 3 pets

```
npm run test-run
```

1. A Chrome window opens on the VetAssist login page. **Log in.**
2. Wait until you see the **Pets with Medical Records** list.
3. Go back to PowerShell and press **Enter**.

The script switches the list to 100 rows, sorts it by pet name, and downloads 3 pets. Check:

- `output\zips` has 3 zip files, each with that pet's PDFs inside.
- PowerShell ends with `Downloaded: 3 pets` and `Failed: 0`.

If anything looks wrong, send Claude the PowerShell text and the `output\debug` folder
(screenshots of what the script saw).

## 3. The full download

```
npm start
```

Log in again if asked, press Enter, and leave it running. It carries on from the 3 test pets.

**While it runs:**

- Use other apps freely. The script controls its own Chrome window, not your mouse or keyboard.
- Don't click inside that Chrome window, and leave it open behind other windows rather than
  minimised.
- Keep the PC awake: **Settings → System → Power → Screen and sleep → When plugged in, put my
  device to sleep after → Never**. The screen turning off is fine. Change it back afterwards.

**If it stops** (internet drop, PC restarted, window closed): run `npm start` again. It jumps back
to the page it was on and skips every pet already downloaded. A half-finished zip is thrown away
and downloaded again. If Chrome crashes, the script reopens it by itself.

**If the old system logs you out,** the script pauses and asks you to log in again in its Chrome
window, then press Enter.

**At the end** it goes through the list once more to catch anything missed, then prints a
summary, for example:

```
 Downloaded: 2668 pets
 No PDFs:    0
 Failed:     0
```

Pets that failed 3 times are listed in `output\progress.json` under `"failed"`. Run `npm start`
again to retry them.

## 4. When it's finished

1. Send the `output\zips` folder to Claude (zip it up, or put it on Google Drive). The zips
   contain client and medical details, so share it privately.
2. **Delete `output\login-state.json`.** It holds your VetAssist login so Chrome could reopen
   without asking. You won't need it again.

## Options

| Option | What it does |
|---|---|
| `--out D:\HannaRecords` | Saves everything to another folder or drive (use the same one every time) |
| `--start-page 5` | Starts from page 5 instead of where it left off |
| `--limit 50` | Stops after 50 pets in total |
| `--rows 25` | Rows per page on the old list (default 100) |
| `--browser-path "C:\Program Files\Google\Chrome\Application\chrome.exe"` | Use this if it says it can't find Chrome |

Add options after `npm start --`, for example: `npm start -- --out D:\HannaRecords`

---

# Read the appointments list

`appointments.mjs` reads the old system's **Appointments** list, every row on every page, **without opening any appointment**. That makes it quick: about 72 pages at 100 rows. For each appointment it saves pet, owner, booked by, date, time, status and services, including what's behind **+1 more**, plus any hint on the row (e.g. a reschedule note). The clinical details of past visits come from the medical record PDFs instead.

It can run **while the medical records download is running**. It uses its own Chrome window and its own `output-appointments` folder. You log in once more in its window.

## 1. Test run: first page only

In this folder (`tools\medical-records-download`):

```
git pull
npm run appointments-test
```

1. A Chrome window opens. **Log in** to VetAssist.
2. Go to **Appointments** and make sure the **Table** view and the **All** tab are showing.
3. Back in PowerShell, press **Enter**.

It sets 100 rows per page, reads page 1 and stops. Open `output-appointments\appointments.csv` in Excel and check the rows look right.

## 2. Everything

```
npm run appointments
```

It reads every page, then does a quick checking pass for anything that moved while it ran (e.g. a new booking). Running it again resumes where it stopped. It never saves the same appointment twice.

You can open `appointments.csv` in Excel while it runs. Excel locks the file, so the script stops updating it until you close Excel, then catches up. Nothing is lost: every row is saved to `appointments.jsonl` first.

## 3. When it's finished

Send Claude `output-appointments\appointments.csv` and `appointments.jsonl` privately. They contain client details. Then delete `output-appointments\login-state.json`.

---

# Read the services list

`services.mjs` opens each service's **Edit** panel on the old system's **Services** page, reads it and closes it with **Cancel**. It never clicks **Update Service** and never adds a variation, so nothing changes in the old system. About 49 services: a few minutes.

## 1. Test run: 3 services

In this folder (`tools\medical-records-download`):

```
git pull
npm run services-test
```

1. A Chrome window opens. **Log in** to VetAssist.
2. Go to **Services** and wait for the list.
3. Back in PowerShell, press **Enter**.

Open `output-services\services.csv` in Excel: one line per service (or per variation), with description, price, category, Active and Featured for online booking.

## 2. Everything

```
npm run services
```

It carries on after the 3 test services. If a service's variations don't match the count on the list, it says so and saves a screenshot in `output-services\debug`.

## 3. When it's finished

Send Claude `output-services\services.json`. Then delete `output-services\login-state.json`.
