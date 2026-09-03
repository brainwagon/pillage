# pillage

A medication log that runs entirely in your browser. No account, no server, no
network traffic. Everything you enter is stored in IndexedDB on the device you
typed it on.

**[Open pillage →](https://mvandewettering.com/pillage/)**

![The pillage day view: a doctor mascot in the masthead, a Doses card with
Lisinopril and Vitamin D checked off, a Notes card, and a 30-day adherence
strip.](docs/screenshot.png)

## What it does

- **Track doses per day.** A medication can have any number of daily doses,
  optionally labelled (Morning, Noon, Evening).
- **Backfill the past.** Any earlier day can be opened and ticked — recording a
  dose you took but forgot to log is the normal case, not an exception.
- **Keep notes.** Any number of timestamped notes per day, each optionally
  about a particular medication.
- **Read them back.** **All notes** shows every note across every day,
  searchable and filterable by medication. A day heading opens that day.
  Notes read newest first everywhere.
- **See your adherence** at a glance in a 30-day strip that doubles as
  navigation.
- **Work offline**, and install to your phone's home screen.

## Running it locally

It is a folder of static files with no build step and no dependencies. Serve it
from anywhere:

```sh
python3 -m http.server 8000     # then open http://localhost:8000
```

Opening `index.html` directly over `file://` mostly works, but the service
worker will not register.

## Deploying it yourself

Push to a repository and enable Pages for the branch and root folder. There is
nothing to build, and `.nojekyll` keeps Pages from processing the files.

Two things worth knowing:

- **`<you>.github.io` is a single origin** shared by every Pages project on the
  account. The database is named `pillage-v1` so it will not collide with a
  neighbour, but clearing site data for any of those projects clears this one
  too.
- **`sw.js` caches the app for offline use**, using stale-while-revalidate: a
  returning user gets the cached copy instantly and the new one on their next
  reload. It deliberately does not register on `localhost`, so your own edits
  are never served back at you during development.

## How it works

| File | Responsibility |
| --- | --- |
| `js/dates.js` | Local calendar dates as `YYYY-MM-DD` strings |
| `js/db.js` | IndexedDB: stores, keys, transactions |
| `js/store.js` | The domain: medications, regimens, doses, notes |
| `js/app.js` | Rendering and event wiring |

`CONTEXT.md` defines the vocabulary. Three decisions are worth knowing before
reading the code:

**Regimen history, not a dose count.** Changing a prescription appends a
regimen with an `effectiveFrom` date rather than editing a number, so a day
always renders the doses that actually applied at the time. Without this,
doubling a dose would make every previous day report missed medication that was
never missed. See [`docs/adr/0001-regimen-history.md`](docs/adr/0001-regimen-history.md).

**Only taken doses are stored.** The absence of a record means the dose was not
taken, so unticking a box is a delete. The consequence is that a deliberate
skip and a day you never opened the app look identical.

**Deleting a medication archives it.** It leaves the daily list but stays on
every day it was active for, and restoring it reconnects the whole history.
There is a permanent delete in the editor's danger zone if you really want it.

## Your data

There is no copy of your data anywhere but this browser. It does not sync, and
it will not follow you to another device, another browser, or a reinstall.

**Data → Export** writes a JSON file; that file is your only backup and your
only way to move to a new device. Restoring **replaces** everything currently
stored, because merging two divergent copies would need a per-record clock this
app does not keep.

The app calls `navigator.storage.persist()` on first run, which asks the
browser not to evict the data. Chromium and Firefox only evict under real disk
pressure.

**Safari and every browser on iOS are a different matter.** WebKit deletes a
site's script-writable storage after seven days of Safari use without a visit,
which would take the whole log with it. pillage detects those browsers and
shows a warning saying so. Adding the app to the Home Screen exempts it from
that rule, and the warning hides itself when you have.

The warning can be dismissed. The dismissal is kept in `localStorage`, which
WebKit erases along with everything else — so if the eviction it warns about
ever happens, the warning comes back, which is exactly when it should.

Detection is by feature, not by user agent — every desktop browser's user agent
string contains the word "WebKit", so matching on that would flag Chrome and
Edge too. `js/app.js` uses the WebKit-only `GestureEvent` interface plus
`navigator.vendor`, which the HTML specification pins to `"Apple Computer, Inc."`
for WebKit.

This is a personal log, not a medical device. It will not remind you, and it
cannot tell you whether a dose was safe to take or to skip.

## Licence

[CC0 1.0 Universal](LICENSE) — public domain dedication. Do whatever you like
with it.

The masthead illustration is included under the same dedication.
