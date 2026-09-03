# 1. Regimen history instead of a mutable dose count

Date: 2026-09-03

## Status

Accepted

## Context

A Medication is taken some number of times per Day. The obvious model is a
mutable `dosesPerDay` field on the Medication, edited when a prescription
changes.

That model corrupts history. Suppose Lisinopril is taken once daily for three
months and the prescription is then doubled. Every past Day is rendered from
the Medication's *current* dose count, so re-opening any Day in those three
months now shows two Doses with only one DoseRecord against it — ninety days
of history reporting missed medication that was never missed.

This is the worst class of defect this application can have. Its whole purpose
is to answer "have I been taking this?", and the failure is silent: nothing
errors, the log simply lies.

The damage is also unrecoverable. Once the field is overwritten, the fact that
the regimen used to be one dose a day is gone. No later migration can
reconstruct it, so this decision cannot be deferred to the point where the
problem is first observed — by then the data is already lost.

## Decision

A Medication holds a list of Regimens rather than a dose count. Each Regimen
carries an `effectiveFrom` Day, a dose count, and optional per-dose labels.
The Regimen in effect on a given Day is the latest one whose `effectiveFrom`
is on or before it.

Changing a prescription appends a new Regimen. Existing Regimens are never
edited, so every Day renders the Doses that actually applied at the time.

## Consequences

Rendering a Day requires resolving the applicable Regimen — a reverse scan of
a list that will hold two or three entries in practice. Every read path for
Doses goes through that resolution rather than reading a field.

Regimens nest inside the Medication record rather than forming their own
object store; they are always loaded with their parent and never queried
independently.

Per-dose labels ("Morning", "Evening") live on the Regimen, so they version
alongside the count for free.

Editing a past prescription change, as opposed to appending a new one, is not
supported. Correcting a mis-entered `effectiveFrom` would require editing the
Regimen list directly. This is accepted as rare.

## Alternatives considered

**Mutable `dosesPerDay`.** Simplest, and rejected for the reasons above.

**Snapshot the dose count onto each Day when first touched.** Fixes Days the
user has opened, but a Day never opened has no snapshot and falls back to the
current value — so the corruption remains, now applying to an arbitrary and
invisible subset of history.

**Treat a dose change as archiving the old Medication and creating a new one.**
Correct, and avoids the resolution logic entirely. Rejected because it
fragments one medication into several rows that share a name, cluttering every
history view, and it collides with the ability to restore an archived
Medication and reconnect it to its history.
