# Medical records: what the scrape should capture

The old system only shows medical records one pet at a time, so they are being scraped. This is the format the phase 3 importer will read. JSON Lines (one record per line) is easiest; CSV is fine if attachments are listed in a separate file.

## One line per medical record

```json
{
  "legacy_pet_id": "…",            // the old system's internal pet id from the page URL, if visible
  "customer_no": "C000123",        // owner's customer number (always)
  "pet_name": "Bantay",             // as shown in the old system
  "record_date": "2026-09-28",     // YYYY-MM-DD
  "appointment_no": "2026A5181",   // without the #, or null for "Manual" records
  "created_by": "Staff Name",
  "entries": [
    {
      "type": "note",              // note | diagnosis | vaccination | treatment_plan | consent_form | prescription
      "title": "VACCINE",
      "description": "…",          // full text, keep line breaks
      "administered_by": "Staff Name",
      "time": "14:57",             // as shown on the entry, 24-hour
      "date_administered": null,   // vaccinations only, YYYY-MM-DD
      "items": [                   // "Services/Products Used"
        { "kind": "service", "name": "VACCINE", "variation": "ANTI RABIES", "qty": 1, "note": "Booked as part of the appointment scheduling" }
      ],
      "attachments": ["files/C000123/Bantay/2026-09-28/xray-1.jpg"]   // downloaded files, path relative to the export folder
    }
  ]
}
```

## How records are matched to pets

1. `legacy_pet_id`, when the scrape can get it: exact.
2. Otherwise `customer_no` + `pet_name` (case-insensitive). Four owners have two pets with the same name; those records go to a review list instead of being guessed.

## Also useful, if the scrape can reach them

- The vaccination card list per pet (vaccine, description, date administered, administered by).
- Pet statistics (temperature, weight) with dates.
- Appointment history: date, time, status, services, booked by. The appointments export may already cover this.

Download attachments and medical images as files: links from the old system will stop working when the subscription ends.
