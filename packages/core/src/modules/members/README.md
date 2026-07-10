# members

The person: identity and PII. PII lives here and nowhere else.

## Public API (`index.ts`)

- `Member`, `MemberStatus`, `MemberStats`, `EmergencyContact`, `PhoneE164`, `Email`
- `registerMember`, `updateMember`, `deactivateMember` (application use-cases)
- `MemberRepository`, `MembersDeps`, `FirestoreMemberRepository`
- `normalizePhone`; event type constants + payloads

## Invariants this module owns

- **I-13** — no PII in any event payload. `member.registered` carries no name;
  `member.profile_updated` carries changed field **names** only (AD-25).
- **I-21** — every stored phone is valid E.164, and no two **active** members of a
  studio share one. Enforced atomically by `/members_by_phone/{normalizedPhone}` in
  the same transaction as `/members` (decision #1); a collision is reported
  (`phone_already_registered`), never merged (AD-40). On phone change the uniqueness
  document is swapped (delete old, create new) in one transaction.
- **AD-22** — `member.deactivated` requires a non-empty `reason` (enforced in the
  domain).

## Notes

- The domain never sees a Firestore document id; the repository maps
  `MemberId ↔ document id` (decision #2).
- A deactivated member keeps its uniqueness document (phone stays reserved) until a
  future hard erasure.
- `member.stats` is denormalised and rebuildable; its trigger arrives with the
  events that feed it (attendance, entitlements).
