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

// ── A typo is a different surname, and every other tier drops it (owner, 2026-07-30) ─────────
describe('matchMember — near spellings', () => {
  const ZUHRE: MatchCandidate = {
    memberId: 'mem_zuhre' as MemberId,
    fullName: 'ZÜHRE HİLAL KUŞ',
    phoneNormalized: '905325555555',
  }

  it('proposes the member the file misspelled by one letter', () => {
    // The studio has ZÜHRE HİLAL KUŞ; the file says KAŞ. Same woman, one keystroke apart — and
    // the surname tiers all miss her, because to them the surname is simply wrong.
    const out = matchMember(null, 'ZÜHRE HİLAL KAŞ', [ZUHRE])
    expect(out).toMatchObject({ kind: 'proposal', candidates: [{ memberId: 'mem_zuhre', reason: 'near_spelling' }] })
  })

  it('ranks a near spelling BELOW every real match', () => {
    const exact = m('mem_exact', 'ZÜHRE HİLAL KAŞ', '905321111111')
    const out = matchMember(null, 'ZÜHRE HİLAL KAŞ', [ZUHRE, exact])
    if (out.kind !== 'proposal') throw new Error('unreachable')
    expect(out.candidates[0]).toMatchObject({ memberId: 'mem_exact', reason: 'exact_name' })
    expect(out.candidates[1]).toMatchObject({ memberId: 'mem_zuhre', reason: 'near_spelling' })
  })

  it('offers the sisters as the WEAK tier, not as a typo', () => {
    // ESRA and ELİF SAHINCI are both in this studio. They share a surname, so an existing tier
    // already offers them — and it must stay that tier, clearly labelled, rather than being dressed
    // up as "you probably misspelled this", which is a much stronger claim than we can make.
    const esra = m('mem_esra', 'ESRA SAHINCI', '905321111111')
    const out = matchMember(null, 'ELİF SAHINCI', [esra])
    expect(out).toMatchObject({ kind: 'proposal', candidates: [{ reason: 'same_surname_and_initial' }] })
  })

  it('refuses to guess on a SHORT name — one edit there is a different woman', () => {
    // `ELA KUS` / `ELA KAS` is seven letters and one edit, and they are not the same person.
    const ela = m('mem_ela', 'ELA KUŞ', '905321111111')
    expect(matchMember(null, 'ELA KAŞ', [ela]).kind).toBe('none')
  })

  it('allows ONE edit at eight letters and TWO only from twelve', () => {
    const kar = m('mem_kar', 'AYŞE KARA', '905321111111')
    expect(matchMember(null, 'AYŞE KORA', [kar]).kind).toBe('proposal') // 9 letters, one edit
    expect(matchMember(null, 'AYŞE KORE', [kar]).kind).toBe('none') // 9 letters, two edits
    const uzun = m('mem_uzun', 'ZÜHRE HİLAL KUŞ', '905322222222')
    expect(matchMember(null, 'ZÜHRA HİLAL KAŞ', [uzun]).kind).toBe('proposal') // 15 letters, two
  })

  it('tolerates a missing letter, not just a swapped one', () => {
    const gulnare = m('mem_g', 'GÜLNARE YILMAZ', '905321111111')
    const out = matchMember(null, 'GÜLNAR YILMAZ', [gulnare])
    // Same surname, same first initial — an existing tier catches this one, which is the point:
    // the new tier only has to cover what the others cannot.
    expect(out.kind).toBe('proposal')
  })
})
