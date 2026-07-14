# UX backlog — the small things that made someone do the wrong thing

**This is not a wish list.** Nothing goes in here because it would be *nicer*. An entry earns its place
only when a real person, doing a real task, was **led astray** — and the product was the one that led
them.

They are collected rather than fixed one at a time because they are cheap together and expensive
apart: each is a few lines, and each needs a human to look at a screen and say *"yes, that is what I
meant."* We fix them in one sitting, with the owner, after the pilot has told us which ones actually
bite.

**Rule:** an entry names *who was misled, doing what, and what they believed instead.* If it cannot be
written that way, it is a preference, and it does not belong here.

---

## UX-1 — Placeholders that look exactly like filled-in values ⚠️ **cost us a live setup step**

**Found:** production setup, 2026-07-14 · **Screen:** Ayarlar → Rezervasyon kuralları

The owner filled in the studio settings, pressed **Kaydet**, saw *"Ayarlar kaydedildi"* — and three
rule-affecting numbers were still `null` in the database. She had not typed them. She did not need to:
the boxes **already showed 6, 2 and 20**, because those are the `placeholder` values.

A grey placeholder and a black value are one shade apart on a laptop screen in daylight. When the
placeholder happens to *be* the sensible answer, there is nothing left to distinguish "empty" from
"filled" except a colour nobody is looking for.

And it is not a harmless blank: **`defaultCancellationWindowHours: null` means a class cannot be
created at all** — the domain refuses with `cancellation_window_unresolved` rather than inventing a
number. So the setting looked done, the save said done, and the next step would have hit a wall for a
reason that pointed nowhere near the cause.

*(The product did tell the truth, and we both missed it: the preview said, in the same screenshot,
**"İptal penceresi tanımsız."** A warning nobody reads is a warning that does not exist.)*

**The fix is not a better placeholder.** Options, in order of honesty:
- Remove the placeholders from rule-affecting fields entirely, and mark them **required**.
- Or: show the field as *empty and incomplete* — a visible "gerekli" state — until it holds a value.
- And make the preview's *"tanımsız"* line **loud** (danger colour), not a sentence in a paragraph.

**It is not enough to fix this field.** The same trap exists wherever a placeholder names a plausible
default. Sweep them.

---

## UX-2 — "Kaydet" saves the form, but not the sections under it

**Found:** production setup, 2026-07-14 · **Screen:** Ayarlar

Ders Türleri, Salonlar and Kasalar sit **below** the settings form's **Kaydet** button and have their
own save paths (they write immediately, per row). Adding a ders türü feels like "saving the page" — so
the form above it, with unsaved edits in it, gets left behind.

Nothing was lost here, but only because we were reading the database rather than the screen.

**Fix:** either move the definitions above the form, or make it visually unmistakable that the button
belongs to the block above it — and warn on navigate-away when the form is dirty.

---

## How to add an entry

```markdown
## UX-n — <what the person believed, in one line>
**Found:** <when, where> · **Screen:** <screen>
<who was doing what, what the product showed, what they concluded, what was actually true>
**Fix:** <the smallest change that removes the misunderstanding — not the nicest one>
```
