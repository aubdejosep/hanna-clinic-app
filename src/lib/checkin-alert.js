// When a pet is checked in (tag tap, Walk-In Check In, Admit, or Arrived on a booking), the screen says so here,
// and the Layout's BalanceCheckInAlert pops up if the owner still owes money.
import { useEffect } from 'react'

const EVENT = 'hanna:checked-in'
export function announceCheckIn(appointment) {
  const ownerId = appointment?.owner?.id
  if (ownerId) window.dispatchEvent(new CustomEvent(EVENT, { detail: { ownerId, ownerName: appointment.owner.name, petName: appointment.pet?.name } }))
}
export function useCheckIns(fn) {
  useEffect(() => {
    const on = (e) => fn(e.detail)
    window.addEventListener(EVENT, on)
    return () => window.removeEventListener(EVENT, on)
  }, [fn])
}
