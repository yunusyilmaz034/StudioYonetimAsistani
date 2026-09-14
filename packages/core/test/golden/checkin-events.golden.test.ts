import { describe, expect, it } from 'vitest'

import {
  decideAutoCheckOut,
  decideRequestDeviceRestart,
  decideCheckIn,
  decideCloseBranch,
  decideOpenBranch,
  decideRefuseEntry,
} from '../../src/modules/checkin/domain/decide'
import type { DecideContext } from '../../src/modules/checkin/domain/decide'
import type { BranchOccupancy, Presence } from '../../src/modules/checkin/domain/types'
import {
  instant,
  type BranchId,
  type DeviceId,
  type CheckInId,
  type CorrelationId,
  type MemberId,
  type StaffUserId,
  type StudioId,
} from '../../src/shared'
import branchClosed from './branch.closed.v1.json'
import branchOpened from './branch.opened.v1.json'
import autoCheckedOut from './member.auto_checked_out.v1.json'
import checkedIn from './member.checked_in.v1.json'
import checkedOut from './member.checked_out.v1.json'
import entryRefused from './member.entry_refused.v1.json'
import exitUnobserved from './member.exit_unobserved.v1.json'
import exitedWithoutEntry from './member.exited_without_entry.v1.json'
import turnstileReopened from './turnstile.reopened.v1.json'
import restartRequested from './device.restart_requested.v1.json'
import { decideTurnstileReopen } from '../../src/modules/checkin/domain/reopen'

const NOW = instant(1_700_000_000_000)
const H = 3_600_000
const ctx: DecideContext = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'receptionist', id: 'usr_1' as StaffUserId },
  now: NOW,
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web',
}
const BR = 'brn_1' as BranchId
const MEM = 'mem_1' as MemberId
const openBranch: BranchOccupancy = { branchId: BR, isOpen: true, openedAt: instant(NOW - 3 * H) }
const input = { checkInId: 'chk_1' as CheckInId, memberId: MEM, branchId: BR, method: 'qr' as const }

describe('check-in event payloads match golden fixtures (AD-33)', () => {
  it('branch.opened', () => {
    expect(decideOpenBranch(ctx, BR, null).events[0]?.payload).toEqual(branchOpened)
  })
  it('branch.closed', () => {
    expect(decideCloseBranch(ctx, BR, openBranch, 5).events[0]?.payload).toEqual(branchClosed)
  })
  it('member.checked_in', () => {
    const r = decideCheckIn(ctx, input, null, 4, openBranch)
    expect(r.ok && r.value.events[0]?.payload).toEqual(checkedIn)
  })
  it('member.checked_out', () => {
    const presence: Presence = { memberId: MEM, branchId: BR, checkedInAt: instant(NOW - 90 * 60_000) }
    const r = decideCheckIn(ctx, input, presence, 5, openBranch)
    expect(r.ok && r.value.events[0]?.payload).toEqual(checkedOut)
  })
  // Kapıda kalan üye. PII yok: ödeme yok, isim yok, sebep kapalı enum.
  it('member.entry_refused', () => {
    const e = decideRefuseEntry(ctx, MEM, 'dev_giris' as DeviceId, BR, 'no_active_membership')
    expect(e[0]?.payload).toEqual(entryRefused)
    expect(e[0]?.subject).toEqual({ kind: 'member', id: MEM })
  })
  it('member.auto_checked_out', () => {
    const presence: Presence = { memberId: MEM, branchId: BR, checkedInAt: instant(NOW - 5 * H) }
    expect(decideAutoCheckOut(ctx, presence, 4)[0]?.payload).toEqual(autoCheckedOut)
  })
  // OR-75. İkisinde de süre YOK ve giriş uydurulmaz: görülmeyen şey yazılmaz (#11).
  it('member.exited_without_entry', () => {
    const r = decideCheckIn(ctx, { ...input, direction: 'out', atTurnstile: true }, null, 4, openBranch)
    expect(r.ok && r.value.events[0]?.payload).toEqual(exitedWithoutEntry)
    expect(r.ok && r.value.events[0]?.subject).toEqual({ kind: 'member', id: MEM })
  })
  it('member.exit_unobserved', () => {
    const presence: Presence = { memberId: MEM, branchId: BR, checkedInAt: instant(NOW - 5 * H) }
    const r = decideCheckIn(ctx, { ...input, direction: 'in', atTurnstile: true }, presence, 5, openBranch)
    expect(r.ok && r.value.events[0]?.payload).toEqual(exitUnobserved)
  })
})

// OR-79. Kol yeniden açıldı: kimlik, kapı, yön ve ilk geçişten geçen süre — isim yok, yeni giriş yok.
describe('turnstile.reopened', () => {
  it('payload', () => {
    const son = { id: 'chk_1' as CheckInId, studioId: 'std_1' as StudioId, memberId: MEM, branchId: BR, direction: 'in' as const, method: 'device' as const, occurredAt: instant(NOW - 20_000), actor: ctx.actor }
    const r = decideTurnstileReopen(ctx, { memberId: MEM, branchId: BR, deviceId: 'dev_giris' as DeviceId, direction: 'in' }, [son])
    expect(r?.events[0]?.payload).toEqual(turnstileReopened)
    expect(r?.checkIn.reopenedAt).toBe(NOW)
  })
})

// Firmware v1.4 — uzaktan yeniden başlatma. Sebep zorunlu; devre dışı cihaza komut yok.
describe('device.restart_requested', () => {
  const cihaz = {
    id: 'dev_1' as DeviceId,
    studioId: 'std_1' as StudioId,
    branchId: BR,
    name: 'Giriş turnikesi',
    secretHash: 'x',
    active: true,
    lastSeenAt: null,
    createdAt: NOW,
  }
  it('payload', () => {
    const r = decideRequestDeviceRestart(ctx, cihaz, '  Kol tepki vermiyor ')
    expect(r.ok && r.value.events[0]?.payload).toEqual(restartRequested)
  })
  it('REDDEDER: sebepsiz; devre dışı cihaz', () => {
    expect(decideRequestDeviceRestart(ctx, cihaz, ' ')).toEqual({ ok: false, error: { code: 'reason_required' } })
    expect(decideRequestDeviceRestart(ctx, { ...cihaz, active: false }, 'x')).toEqual({ ok: false, error: { code: 'operation_not_applicable' } })
  })
})
