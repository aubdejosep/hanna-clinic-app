-- Screenshots and example images on Content comments and Team Notes (up to 4 per comment).
-- Files in R2 under content/comments/; served to logged-in staff only.
CREATE TABLE content_comment_images (
  id           INTEGER PRIMARY KEY,
  comment_id   INTEGER NOT NULL REFERENCES content_comments (id),
  sort         INTEGER NOT NULL DEFAULT 0,
  r2_key       TEXT NOT NULL,
  content_type TEXT NOT NULL,
  bytes        INTEGER,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at   TEXT
);
CREATE INDEX idx_content_comment_images ON content_comment_images (comment_id);
