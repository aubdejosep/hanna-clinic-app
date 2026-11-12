# Week folder format (for the content session)

Give this sheet to the Claude session that makes the weekly posts. Each week, it should hand over
**one zip** that unzips to a folder like this:

```
week-2026-11-16/
  posts.json
  full/   slides at full size (JPG or PNG), e.g. s05-1.jpg
  img/    reel cover images, e.g. s04-reel.jpg
  vid/    reels (MP4), e.g. s04.mp4
```

An owner opens **Content ▸ Import Week** in the clinic app, picks the unzipped folder, checks the
preview and taps **Import**. Nothing is sent to the app any other way.

## posts.json

The same data as the weekly plan page: `{ "posts": [ … ] }`, one object per post.

| Field | Required | Example / notes |
|---|---|---|
| `id` | yes | `"s04"`. Letters, numbers, `-` or `_`. Unique and **stable**: importing the same id again updates that post (its slides are replaced; a Posted tick is kept). |
| `date` | yes | `"2026-11-16"` (Manila day) |
| `title` | yes | `"Cherry eye in dogs"` |
| `time` | | `"7:00 PM"` |
| `pillar` | | `Pet Care Tip`, `Service Spotlight`, `Client Feature`, `Promo`, `Nutrition` |
| `format` | | `Reel`, `Carousel`, `Single image`, `Story` |
| `caption` | | Full caption with the sign-off; line breaks as `\n` |
| `tags` | | `["#HannaPetWellness", "#MalateManila"]` |
| `note` | | Production note, e.g. "Have the vet check the medical points before posting." |
| `status` | | `ready`, `film` (to film), `info` (needs info), `placeholder` (waiting on client), `idea`. Default `ready`. |
| `shots` | | For `film`: `["Close-up of a puppy on the scale", …]` |
| `slides` | | `[{ "file": "s05-1.jpg", "save_as": "Nov-17_our-top-5-vaccines_slide-1.jpg" }, …]` in order; files in `full/` |
| `reel` | | `{ "file": "s04.mp4", "poster": "s04-reel.jpg", "save_as": "Nov-16_cherry-eye_reel.mp4", "silent": false }`; video in `vid/`, cover in `img/`. `silent: true` means no music yet (pick a sound in Meta). |

## Limits

- Up to 60 posts per import; each file up to 95 MB (export reels at 1080×1920, H.264 MP4).
- Slides: JPG, PNG or WebP. Reels: MP4 (MOV and WebM also accepted).
- The same content rules as the website apply (no prices, no pet lodging or PCR, no animal lists,
  client pets only with the owner's agreement, stock never presented as patients).
