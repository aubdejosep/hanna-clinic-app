// The Inbox notification sound: the one uploaded in Settings (served at /api/settings/inbox-sound,
// versioned so browsers cache immutably and refresh after a change), else the built-in default.
import { useSyncExternalStore } from 'react'

export const DEFAULT_INBOX_SOUND = '/sounds/inbox-notification.mp3'
let src = DEFAULT_INBOX_SOUND
const subs = new Set()
const emit = () => subs.forEach((f) => f())

export function setInboxSoundVersion(version) {
  const next = version ? `/api/settings/inbox-sound?v=${version}` : DEFAULT_INBOX_SOUND
  if (next !== src) { src = next; emit() }
}

export const useInboxSound = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f) }, () => src)
