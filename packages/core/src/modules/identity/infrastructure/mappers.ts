import type { DocumentData } from 'firebase-admin/firestore'

import type { StaffRole, StaffUserId } from '../../../shared'
import type { StaffMember } from '../domain/types'

export function staffFromFirestore(id: StaffUserId, d: DocumentData): StaffMember {
  return {
    id,
    displayName: (d.displayName as string | undefined) ?? (d.name as string | undefined) ?? '',
    role: (d.role as StaffRole | undefined) ?? 'receptionist',
    active: d.active !== false,
  }
}
