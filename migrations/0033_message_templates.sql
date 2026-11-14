-- Account ▸ Settings ▸ Messages (owners and admins): the wording, and Text / Email on or off, for every
-- message sent to clients. Fill-ins in {curly brackets} are replaced when sending; default_* keep the
-- original wording for "Reset to Default". The website (hannapetwellnesscenter.com) reads the rows it sends
-- (booking, free_consult, booking_cancelled) through its read-only CLINIC binding; the rest of each email
-- (details, buttons, address) stays as designed.
--   booking ............ someone books on /book (website)
--   free_consult ....... someone signs up on /free-consult (website; the code itself goes by email only)
--   booking_cancelled .. a client cancels from their email link (website)
--   visit_reminder ..... the day before a visit (the inbox intake Worker, daily). Off until switched on.
--   due_reminder ....... vaccine or follow-up due (coming later: not sent yet)
-- Texts go out from the SMS sender name (HANNAPETVET, Semaphore) once it's approved and set up; until then
-- the Text switches stay off.

CREATE TABLE message_templates (
  key                    TEXT PRIMARY KEY,
  sms_enabled            INTEGER NOT NULL DEFAULT 0,
  email_enabled          INTEGER NOT NULL DEFAULT 1,
  sms_text               TEXT NOT NULL,
  email_subject          TEXT NOT NULL,
  email_intro            TEXT NOT NULL,
  default_sms_text       TEXT NOT NULL,
  default_email_subject  TEXT NOT NULL,
  default_email_intro    TEXT NOT NULL,
  fill_ins               TEXT NOT NULL DEFAULT '[]',   -- JSON list of the fill-ins this message can use
  sort                   INTEGER NOT NULL DEFAULT 0,
  updated_at             TEXT,
  updated_by             TEXT
);

INSERT INTO message_templates (key, sms_enabled, email_enabled, sms_text, email_subject, email_intro, default_sms_text, default_email_subject, default_email_intro, fill_ins, sort)
SELECT key, 0, email_on, sms, subject, intro, sms, subject, intro, fill_ins, sort FROM (
  SELECT 'booking' AS key, 1 AS email_on,
    'Hanna Pet: See you {date}, {window} with {pets}. Wait time may vary. Changes? m.me/HannaPetWellness or 0916 415 8426' AS sms,
    'You''re booked: {date} ({ref})' AS subject,
    'Thanks for booking with us! See you on {date}, {window}. Just come in and show this email at the front desk.' AS intro,
    '["first_name","pets","date","window","ref"]' AS fill_ins, 1 AS sort
  UNION ALL SELECT 'free_consult', 1,
    'Hanna Pet: Thanks for signing up {pets}! Your free consult code is in your email. Book at hannapetwellnesscenter.com/book or call 0916 415 8426',
    'Your free consultation: {codes}',
    'Thanks for signing up {pets}! Here are your free consultation details.',
    '["first_name","pets","codes","valid_until"]', 2
  UNION ALL SELECT 'booking_cancelled', 1,
    'Hanna Pet: Your booking {ref} for {date} is cancelled. Book again anytime at hannapetwellnesscenter.com/book or call 0916 415 8426',
    'Booking cancelled: {date} ({ref})',
    'Your booking {ref} for {pets} on {date}, {window} is cancelled. We hope to see you another time.',
    '["first_name","pets","date","window","ref"]', 3
  UNION ALL SELECT 'visit_reminder', 0,
    'Hanna Pet: See you tomorrow, {date}, {window} with {pets}. Wait time may vary. Changes? m.me/HannaPetWellness or 0916 415 8426',
    'See you tomorrow: {date}',
    'Just a reminder: we''ll see you and {pets} tomorrow, {date}, {window}. Come in any time in that window; waiting time depends on how busy the clinic is.',
    '["first_name","pets","date","window"]', 4
  UNION ALL SELECT 'due_reminder', 0,
    'Hanna Pet: {pet} is due for {what} on {due_date}. Book at hannapetwellnesscenter.com/book or call 0916 415 8426',
    '{pet} is due for {what}',
    '{pet} is due for {what} on {due_date}. Book a visit online, or drop by during clinic hours.',
    '["first_name","pet","what","due_date"]', 5
);

-- Every message the app sends to a client (texts in full, emails by subject), for the Inbox and the
-- owner's page later. ref: what it was for, e.g. "<owner id>:<day>" for a visit reminder (one each).
CREATE TABLE message_log (
  id            INTEGER PRIMARY KEY,
  template_key  TEXT,
  channel       TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  to_addr       TEXT NOT NULL,
  owner_id      INTEGER REFERENCES owners (id),
  ref           TEXT,
  body          TEXT,
  status        TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  provider_id   TEXT,
  error         TEXT,
  sent_by       TEXT,                   -- a staff name, or "Reminder" for automatic ones
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_message_log_owner ON message_log (owner_id, created_at);
CREATE UNIQUE INDEX idx_message_log_once ON message_log (template_key, channel, ref) WHERE ref IS NOT NULL AND status = 'sent';
