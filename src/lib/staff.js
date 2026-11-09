import { createContext, useContext } from 'react'

// The logged-in staff member, for any screen that needs to know who is using the app.
export const StaffContext = createContext(null)
export const useStaff = () => useContext(StaffContext)

// Removing and restoring records is for the clinic owners (and admins). The server checks this too.
export function canManage(staff) {
  return staff?.role === 'owner' || staff?.role === 'admin'
}

export const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', vet: 'Veterinarian', front_desk: 'Front Desk', groomer: 'Groomer' }
