-- Content ▸ Calendar: the clinic's social media posts, their slides and reels, comments from the
-- team, and clinic events (promos) shown on the same calendar. Plan: docs/CONTENT-PLAN.md.
-- Posts come in with Import Week (a week folder made in the content session); media live in R2
-- (the PHOTOS bucket under content/), served to logged-in staff only.

CREATE TABLE content_posts (
  id          INTEGER PRIMARY KEY,
  branch_id   INTEGER NOT NULL DEFAULT 1,
  ref         TEXT NOT NULL,                 -- the content session's post id, e.g. s04; re-imports update by it
  day         TEXT NOT NULL,                 -- Manila YYYY-MM-DD
  time        TEXT,                          -- "7:00 PM" as planned
  pillar      TEXT,                          -- Pet Care Tip, Service Spotlight, Client Feature, Promo, …
  format      TEXT,                          -- Reel, Carousel, Single image, Story
  title       TEXT NOT NULL,
  caption     TEXT,
  hashtags    TEXT,                          -- space separated
  note        TEXT,                          -- production note from the content session
  shot_list   TEXT,                          -- JSON array of shots, for posts still to film
  status      TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'film', 'info', 'placeholder', 'idea')),
  posted_at   TEXT,                          -- ticked Posted (shown as Posted whatever the status)
  posted_by   TEXT,
  post_url    TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by  TEXT,
  updated_at  TEXT,
  updated_by  TEXT,
  deleted_at  TEXT,
  deleted_by  TEXT
);
CREATE UNIQUE INDEX idx_content_posts_ref ON content_posts (branch_id, ref);
CREATE INDEX idx_content_posts_day ON content_posts (day);

CREATE TABLE content_media (
  id           INTEGER PRIMARY KEY,
  post_id      INTEGER NOT NULL REFERENCES content_posts (id),
  kind         TEXT NOT NULL CHECK (kind IN ('slide', 'reel', 'poster')),
  sort         INTEGER NOT NULL DEFAULT 0,
  r2_key       TEXT NOT NULL,
  content_type TEXT NOT NULL,
  bytes        INTEGER,
  save_as      TEXT,                         -- file name for Save, e.g. Nov-16_cherry-eye_slide-1.jpg
  silent       INTEGER NOT NULL DEFAULT 0,   -- a reel without music: pick a sound in Meta
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by   TEXT,
  deleted_at   TEXT,
  deleted_by   TEXT
);
CREATE INDEX idx_content_media_post ON content_media (post_id);

-- Comments: on a post (post_id), or general Team Notes for the calendar (post_id NULL).
CREATE TABLE content_comments (
  id          INTEGER PRIMARY KEY,
  post_id     INTEGER REFERENCES content_posts (id),
  body        TEXT NOT NULL,
  staff_id    INTEGER,
  author      TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT,
  deleted_at  TEXT,
  deleted_by  TEXT
);
CREATE INDEX idx_content_comments_post ON content_comments (post_id, created_at);

-- Clinic events on the content calendar: promos and other dates (closed dates come from Clinic Profile).
CREATE TABLE content_events (
  id          INTEGER PRIMARY KEY,
  branch_id   INTEGER NOT NULL DEFAULT 1,
  kind        TEXT NOT NULL DEFAULT 'promo' CHECK (kind IN ('promo', 'event')),
  title       TEXT NOT NULL,
  start_day   TEXT NOT NULL,
  end_day     TEXT NOT NULL,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by  TEXT,
  updated_at  TEXT,
  updated_by  TEXT,
  deleted_at  TEXT,
  deleted_by  TEXT
);
CREATE INDEX idx_content_events_days ON content_events (start_day, end_day);
