# Context: pillage

A personal medication-adherence log. Runs entirely in the browser; no data
leaves the device.

## Glossary

### Medication

A thing the user takes. Has a name and a [Regimen](#regimen) history.

A Medication is never destroyed. Deleting one **archives** it: it leaves the
daily list immediately, but remains visible on every Day it was active for,
and on any later Day a [Dose](#dose) of it was actually recorded — archiving
one you have already taken today never hides that evidence. Archiving is
reversible: restoring an archived Medication reconnects it to its entire
history, gap included.

Preferred over "drug", which carries recreational connotations and reads
oddly in the UI. "pillage" remains the product name.

### Regimen

A dated period describing how one Medication is taken: how many
[Doses](#dose) per Day, and optionally a label for each.

A Medication holds a *list* of Regimens, each with an `effectiveFrom` Day.
The Regimen in effect on a given Day is the latest one starting on or before
it. Changing a prescription appends a Regimen; it never edits the previous
one, so a Day always renders the Doses that genuinely applied at the time.

### Dose

One slot on one Day for one Medication — the second of two daily doses of
Lisinopril on 2026-09-03. A Dose exists whether or not it was taken; the
Regimen in effect determines how many exist.

### DoseRecord

Evidence that a [Dose](#dose) was taken. Distinct from the Dose itself: a
Dose with no DoseRecord was not taken. This distinction is what lets a past
Day be rendered honestly.

### Note

Timestamped free text belonging to a [Day](#day). A Day may hold any number
of them, shown newest first. A Note may optionally reference one
[Medication](#medication), which is what turns "I felt sick that week" into
"Metformin makes me sick".

Notes may be edited or deleted at any time, on any Day.

### Day

A local calendar date — the unit the app is organised around. Days roll over
at local midnight; there is no "reset" action, because a new Day simply has
no DoseRecords yet.

Identified by its local `YYYY-MM-DD` date, never by an instant in time, so
that history does not shift when the user travels between timezones.

Any past Day may be viewed and edited — retroactively ticking a Dose is
expected, not exceptional. Future Days cannot be recorded against.
