# comments — Instagram comments on the studio's posts (IG-3)

**Purpose.** Every 10 minutes the functions poll the studio's last 25 posts for new comments. The AI sorts
each (question · praise · complaint · spam · other) and drafts a reply in the studio's voice. **A person
sends it.** A complaint goes to the owner's dashboard in red and to her e-mail.

**State.** `studios/{sid}/igComments/{instagram comment id}` — server-only. The comment text, the username,
the draft and the reply live HERE only.

**Events** (v1, golden): `ig_comment.received | replied | hidden | dismissed`. No text, no username (#6).

## Invariants this module owns

1. **The AI never sends.** `replied` is written only after a person pressed "Gönder" and Instagram accepted.
2. **Complaints: the owner only** (reply and "Geç"). **Hiding: the owner only.** Questions/praise: owner or
   reception. A trainer does not answer in the studio's name.
3. **No price in a public reply** (`containsPrice` → `comment_invalid: price`), checked before Meta is called.
4. **A comment is recorded once** (`createIfAbsent`, a transaction; Instagram's id is the document id).
5. **First run:** comments older than 7 days arrive `closed` — history, not work.
6. A refused send changes no status (no event); the reason is shown on the card (`lastFailure`).
7. A double press by two people at once could post two replies (no lock — owner-approved event set has
   none); the UI disables the button while sending. Accepted risk, written down.
