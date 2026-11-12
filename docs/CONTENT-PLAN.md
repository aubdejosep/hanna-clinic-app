# Content menu: plan

A **Content** menu in the clinic app that shows the clinic's social media calendar: what goes out when, what's
ready, what still needs filming or info, and what's posted. It replaces passing the weekly plan page around
(the "This week's posts" page with captions, slides, reels and Posted ticks) with one place inside the app.

Status: **plan only, not built.**

## What a post is (from the weekly plan page)

| Field | Example |
|---|---|
| Day and time | Mon, Nov 16 · 7:00 PM (default 7:00 PM) |
| Pillar | Pet Care Tip, Service Spotlight, Client Feature, Promo, Nutrition (Royal Canin) |
| Format | Reel, Carousel, Single Image, Story |
| Title | "Cherry eye in dogs" |
| Media | Slides (images, in order) and/or one reel (video + cover image); each with its save-as file name |
| Caption | Full caption text with the standard sign-off |
| Hashtags | #HannaPetWellness #MalateManila … |
| Note | Production notes: "Have the vet check the medical points", "No music: pick a sound in Meta" |
| Status | Idea → To Film / Needs Info / Waiting on Client → Ready → Posted |
| Shot list | For To Film posts: the clips to shoot |
| Posted | Who ticked it and when; optional link to the live post |

## Screens

**Content ▸ Calendar** (the main page)
- Top strip: **Next to Post** (title, day, time, status, Open Post) and counts: Ready, To Film, Needs Info,
  Waiting on Client, Posted, with a progress bar for the month.
- Month view (default) and Week view, like Appointments ▸ Calendar: each day shows its posts as pills, coloured by
  status, with a small Reel mark. Phones get a stacked list by day.
- Filters: Status, Pillar, Format (Reels only, Promos only, Not Posted Yet).

**Post window** (opens from any pill, like the medical record window)
- Slides and reel preview with a full-screen viewer (swipe through slides, play the reel).
- Caption with **Copy Caption** (caption + hashtags in one tap) and **Show Full Caption**.
- **Save** per slide, **Save All Slides**, **Save Video**, using the save-as file names, ready for Meta Business Suite.
- Note and shot list.
- **Mark as Posted** (records who and when), optional post link, and **Undo** for a wrong tick.

**Content ▸ House Style** (read only)
- The brand rules from the weekly plan page: colours, type, slide rules, caption sign-off, "never in posts" list
  (prices, pet lodging, PCR, Japan travel steps, vets' names until they agree), logos to download.

## Where posts come from

Phase 1 keeps today's way of working: content is made in a Claude session, as now. Instead of a separate page,
the session produces a **week folder** (posts JSON + images + videos) and the owner loads it with one command:

```
npm run import:content -- --week path/to/week-folder
```

The script uploads media to R2 and the posts to D1. Re-running it for the same week updates those posts
(matched by post id, e.g. s04) without touching Posted ticks.

Phase 2 adds editing in the app (owners): new post, edit caption/status/date (drag to another day),
upload or reorder slides.

## Data (new migration)

- `content_posts`: id, branch_id, ref (e.g. s04), day (Manila), time, pillar, format, title, caption, hashtags,
  note, shot_list, status, posted_at, posted_by, post_url, created_at/by, updated_at/by, deleted_at/by.
- `content_media`: id, post_id, kind (image | video | poster), r2_key, sort, save_as, width, height, bytes.
- Media in R2 (the existing photos bucket under `content/`, or its own bucket), served through an
  authenticated `/api/content/media/:id` like medical photos. Nothing in git.
- Nothing hard-deleted; changes logged with `audit()`.

## Rules carried over

- Client pets only with the owner's agreement, first name + last initial. Phase 3 can link a Client Feature post
  to the pet and record the date the owner agreed.
- Stock photos and footage are never presented as patients, clients or staff.
- No prices in posts; pet travel / Blood Titer only named, questions to Viber.

## Who sees what (to confirm)

- Proposed: every staff member can view the calendar and posts; owners and admins create, edit and mark as posted.

## Phases

1. **Calendar and post window, read only + Mark as Posted**, plus the week import. About the size of the
   Medical Records screens.
2. **Editing in the app**: new/edit post, status changes, drag to reschedule, upload and reorder media.
3. **Extras**: feedback per slide ("Wed, slide 2: …") as comments on the post; Client Feature consent linked to
   the pet; simple results per post (reach, messages, bookings typed in from Meta).

Out of scope for now: posting or scheduling to Facebook/Instagram from the app (needs a Meta app review);
the Copy/Save buttons cover Meta Business Suite by hand.

## Questions for the owners

1. Who should see Content: all staff, or owners/admins only?
2. Phase 1 import from Claude sessions (as now), or start with typing posts in the app?
3. Keep the shared weekly plan page as well, or move fully into the app?
4. Should the clinic's own events (closed dates, promos like the November 50% off) show on the content calendar?
