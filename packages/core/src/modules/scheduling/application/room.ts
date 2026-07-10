import {
  newRoomId,
  type BranchId,
  type DomainError,
  type Result,
  type RoomId,
  type TenantContext,
} from '../../../shared'
import {
  decideCreateRoom,
  decideDeactivateRoom,
  decideReactivateRoom,
  decideUpdateRoom,
} from '../domain/decide'
import type { Room } from '../domain/types'
import { decideContext } from './service'
import type { SchedulingDeps } from './ports'

async function loadRoom(deps: SchedulingDeps, ctx: TenantContext, id: RoomId): Promise<Room> {
  const r = await deps.repo.getRoom(ctx, id)
  if (!r) throw new Error(`Room not found: ${id}`)
  return r
}

export interface CreateRoomInput {
  readonly branchId: BranchId
  readonly name: string
  readonly capacity: number
}

export async function createRoom(
  deps: SchedulingDeps,
  ctx: TenantContext,
  input: CreateRoomInput,
): Promise<Result<{ roomId: RoomId }, DomainError>> {
  const room: Room = {
    id: newRoomId(),
    studioId: ctx.studioId,
    branchId: input.branchId,
    name: input.name,
    capacity: input.capacity,
    active: true,
  }
  await deps.repo.saveRoom(ctx, room, decideCreateRoom(decideContext(deps, ctx), room))
  return { ok: true, value: { roomId: room.id } }
}

export async function updateRoom(
  deps: SchedulingDeps,
  ctx: TenantContext,
  input: { roomId: RoomId; name: string; capacity: number },
): Promise<Result<void, DomainError>> {
  const current = await loadRoom(deps, ctx, input.roomId)
  const next: Room = { ...current, name: input.name, capacity: input.capacity }
  await deps.repo.saveRoom(ctx, next, decideUpdateRoom(decideContext(deps, ctx), current, next))
  return { ok: true, value: undefined }
}

export async function deactivateRoom(
  deps: SchedulingDeps,
  ctx: TenantContext,
  input: { roomId: RoomId; reason: string },
): Promise<Result<void, DomainError>> {
  const current = await loadRoom(deps, ctx, input.roomId)
  const events = decideDeactivateRoom(decideContext(deps, ctx), current, input.reason)
  if (!events.ok) return events
  await deps.repo.saveRoom(ctx, { ...current, active: false }, events.value)
  return { ok: true, value: undefined }
}

export async function reactivateRoom(
  deps: SchedulingDeps,
  ctx: TenantContext,
  input: { roomId: RoomId },
): Promise<Result<void, DomainError>> {
  const current = await loadRoom(deps, ctx, input.roomId)
  await deps.repo.saveRoom(
    ctx,
    { ...current, active: true },
    decideReactivateRoom(decideContext(deps, ctx), current),
  )
  return { ok: true, value: undefined }
}
