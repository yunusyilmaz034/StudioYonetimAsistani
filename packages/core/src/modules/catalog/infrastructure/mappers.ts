import { FieldValue, Timestamp, type DocumentData } from 'firebase-admin/firestore'

import {
  newEventId,
  type Category,
  type EventId,
  type NewEvent,
  type ProductId,
  type ServiceId,
  type StudioId,
} from '../../../shared'
import type { Product, ProductType } from '../domain/types'

export function productToFirestore(p: Product): DocumentData {
  return {
    studioId: p.studioId,
    name: p.name,
    category: p.category,
    serviceIds: p.serviceIds,
    type: p.type,
    durationDays: p.durationDays,
    creditCount: p.creditCount,
    priceInKurus: p.priceInKurus,
    freezeAllowanceDays: p.freezeAllowanceDays,
    dailyReservationLimit: p.dailyReservationLimit,
    cancellationAllowanceCount: p.cancellationAllowanceCount,
    activeReservationLimit: p.activeReservationLimit,
    description: p.description,
    active: p.active,
    updatedAt: FieldValue.serverTimestamp(),
  }
}

export function productFromFirestore(id: ProductId, d: DocumentData): Product {
  return {
    id,
    studioId: d.studioId as StudioId,
    name: d.name as string,
    category: d.category as Category,
    serviceIds: (d.serviceIds as ServiceId[] | undefined) ?? [],
    type: d.type as ProductType,
    durationDays: d.durationDays as number,
    creditCount: (d.creditCount as number | null) ?? null,
    priceInKurus: d.priceInKurus as number,
    freezeAllowanceDays: (d.freezeAllowanceDays as number | undefined) ?? 0,
    dailyReservationLimit: (d.dailyReservationLimit as number | null) ?? null,
    cancellationAllowanceCount: (d.cancellationAllowanceCount as number | null) ?? null,
    activeReservationLimit: (d.activeReservationLimit as number | null) ?? null,
    description: (d.description as string | undefined) ?? '',
    active: d.active !== false,
  }
}

export function eventToFirestore(e: NewEvent): { id: EventId; data: DocumentData } {
  const id = newEventId()
  return {
    id,
    data: { ...e, occurredAt: Timestamp.fromMillis(e.occurredAt), recordedAt: FieldValue.serverTimestamp() },
  }
}
