'use client'

import { useAuth } from './use-auth'
import { useFamilies, type FamilyRole } from './use-family'

// The signed-in user's role in the currently selected family (useFamilies()
// puts the selected family first). Guests are limited to calendar and tasks;
// the server enforces that, this only drives what the UI shows.
export function useMyRole() {
  const { user } = useAuth()
  const { families, isLoading } = useFamilies()
  const family = families[0]
  const role: FamilyRole | null =
    family?.currentUserRole ||
    family?.userRole ||
    family?.members?.find((m) => user && String(m.userId) === String(user.id))?.role ||
    null

  return {
    role,
    familyId: family?.id ?? null,
    isLoading,
    isParent: role === 'PARENT',
    isGuardian: role === 'GUARDIAN',
    isAdult: role === 'ADULT',
    isChild: role === 'CHILD',
    isGuest: role === 'GUEST',
    /** Parents and guardians: may act and approve for children. */
    isSupervisor: role === 'PARENT' || role === 'GUARDIAN',
  }
}
