import { describe, expect, it } from 'vitest'

import type { MemberId } from '../../../shared'
import { foldName, isAmbiguous, matchMember, type MatchCandidate } from './match'

const m = (id: string, fullName: string, phone: string): MatchCandidate => ({
  memberId: id as MemberId,
  fullName,
  phoneNormalized: phone,
})

const AYSE = m('mem_ayse', 'AYŞE YILMAZ', '905321111111')
const AYSE2 = m('mem_ayse2', 'Ayşe Yılmaz', '905322222222')
const ARZU = m('mem_arzu', 'ARZU YILMAZ', '905323333333')
const IREM = m('mem_irem', 'İREM KAYA', '905324444444')

describe('foldName', () => {
  it('folds İ and I to the same letter — otherwise no Turkish first name ever matches', () => {
    // JS lower-cases İ to an i with a combining dot. Left alone, "İREM" and "irem" are different
    // strings that look identical on screen, which is the worst kind of non-match to debug.
    expect(foldName('İREM')).toBe(foldName('irem'))
    expect(foldName('IŞIL')).toBe(foldName('ışıl'))
  })

  it('folds the rest of the Turkish alphabet and collapses whitespace', () => {
    expect(foldName('  Ayşe   Gül  ÖZTÜRK ')).toBe('ayse gul ozturk')
  })

  it('drops the non-breaking space spreadsheets leave behind', () => {
    expect(foldName('AYŞE\u00a0YILMAZ')).toBe('ayse yilmaz')
  })
})

describe('matchMember — by phone', () => {
  it('is certain and needs no confirmation', () => {
    expect(matchMember('905321111111', 'HERHANGİ BİR AD', [AYSE, ARZU])).toEqual({
      kind: 'phone',
      memberId: 'mem_ayse',
    })
  })

  it('beats the name: the phone is the unique key, the name is decoration', () => {
    // The file says AYŞE but the phone belongs to ARZU. The phone wins — and this is the case where
    // trusting the name would silently give one woman another's package.
    expect(matchMember('905323333333', 'AYŞE YILMAZ', [AYSE, ARZU])).toEqual({
      kind: 'phone',
      memberId: 'mem_arzu',
    })
  })

  it('a phone matching nobody is a NEW member, never softened into a name search', () => {
    // The file gave us the unique key and it said "not her". Falling back to the name here would
    // turn an unambiguous "no" into a guess.
    expect(matchMember('905329999999', 'AYŞE YILMAZ', [AYSE])).toEqual({ kind: 'none' })
  })
})

describe('matchMember — by name', () => {
  it('proposes an exact name FIRST, and never applies it', () => {
    // ARZU is offered too — same surname, same initial. That is the weak tier doing its job, and it
    // must sit below the woman whose name actually matches.
    const out = matchMember(null, 'ayşe yılmaz', [ARZU, AYSE])
    if (out.kind !== 'proposal') throw new Error('unreachable')
    expect(out.candidates[0]).toEqual({ memberId: 'mem_ayse', fullName: 'AYŞE YILMAZ', reason: 'exact_name' })
    expect(out.candidates[1]).toMatchObject({ memberId: 'mem_arzu', reason: 'same_surname_and_initial' })
    // The shape itself is the guarantee: there is no outcome that attaches a package from a name.
    expect(out.kind).not.toBe('phone')
  })

  it('reports BOTH when two members share a name — and flags it ambiguous', () => {
    const out = matchMember(null, 'AYŞE YILMAZ', [AYSE, AYSE2])
    expect(out.kind).toBe('proposal')
    expect(isAmbiguous(out)).toBe(true)
    // This is the row a "confirm all" button must refuse. Getting it wrong means the package lands
    // on the wrong woman and surfaces weeks later, at the door, as classes she never had.
  })

  it('ranks a shared FIRST NAME above a merely shared initial', () => {
    // "AYŞE GÜL YILMAZ" against ARZU YILMAZ and AYŞE YILMAZ: both share the surname, both start
    // with A. Only AYŞE shares the first name, and in a studio of 120 Turkish women that is the
    // difference between an answer and a coin toss — an operator scanning seventy rows clicks the
    // first plausible line.
    const out = matchMember(null, 'AYŞE GÜL YILMAZ', [ARZU, AYSE])
    if (out.kind !== 'proposal') throw new Error('unreachable')
    expect(out.candidates[0]).toMatchObject({ memberId: 'mem_ayse', reason: 'same_surname_and_first_name' })
    expect(out.candidates[1]).toMatchObject({ memberId: 'mem_arzu', reason: 'same_surname_and_initial' })
  })

  it('does not offer a different surname at all', () => {
    expect(matchMember(null, 'AYŞE KAYA', [ARZU, AYSE])).toEqual({ kind: 'none' })
  })

  it('returns none when nothing is plausible', () => {
    expect(matchMember(null, 'ZEYNEP DEMİR', [AYSE, IREM])).toEqual({ kind: 'none' })
  })

  it('returns none for an empty name rather than proposing everybody', () => {
    expect(matchMember(null, '   ', [AYSE, ARZU])).toEqual({ kind: 'none' })
  })

  it('matches across case and Turkish accents', () => {
    const out = matchMember(null, 'irem kaya', [IREM])
    expect(out).toMatchObject({ kind: 'proposal', candidates: [{ memberId: 'mem_irem' }] })
  })
})

describe('isAmbiguous', () => {
  it('is false for a phone hit and for a single proposal', () => {
    expect(isAmbiguous({ kind: 'phone', memberId: 'mem_ayse' as MemberId })).toBe(false)
    expect(isAmbiguous(matchMember(null, 'AYŞE YILMAZ', [AYSE]))).toBe(false)
    expect(isAmbiguous({ kind: 'none' })).toBe(false)
  })
})
