
## Program templates (Plus, pilot)

A `ProgramTemplate` ("Program A") is a reusable programme skeleton the studio assigns to members. It is
**CONFIG, not event-sourced** — the same posture as notification templates and room notes (DEBT-030):
editing a template changes no credit/money/attendance, so it appends no event. Stored at
`studios/{sid}/programTemplates/{id}`. **Assigning** a template to a member IS event-sourced —
`instantiateTemplate` calls the existing `createProgram` + `publishProgramVersion`, so the member's
programme snapshots the library at assign time and a later template edit never rewrites it.
