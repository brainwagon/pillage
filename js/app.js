// UI and wiring. Reads and writes the domain through store.js.

import * as store from './store.js';
import {
  today, addDays, isFuture, daysEndingAt,
  formatDay, formatDayShort, formatTime, dayName,
} from './dates.js';

const $ = (id) => document.getElementById(id);
const STRIP_DAYS = 30;

const state = {
  day: today(),
  knownToday: today(), // what "today" was when the day was last chosen
  editing: null,        // medication being edited in the sheet
  editingNoteKey: null, // note whose inline editor is open
};

/* --- small DOM helpers ------------------------------------------------ */

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of [].concat(children)) {
    if (child != null) node.append(child);
  }
  return node;
}

function clear(node) {
  node.replaceChildren();
}

function parseLabels(value) {
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

/* --- day header and navigation ---------------------------------------- */

function renderDayHeader() {
  const name = dayName(state.day);
  $('day-title').textContent = name ?? formatDay(state.day);
  const picker = $('day-picker');
  picker.value = state.day;
  picker.max = today();
  $('next-day').disabled = isFuture(addDays(state.day, 1));
  // Only offered when there is somewhere to go back to.
  $('today-btn').hidden = state.day === today();
}

/* --- adherence strip -------------------------------------------------- */

async function renderStrip() {
  const days = daysEndingAt(state.day, STRIP_DAYS);
  const rows = await store.readAdherence(days);
  $('strip-heading').textContent = state.day === today()
    ? `Last ${STRIP_DAYS} days`
    : `${STRIP_DAYS} days to ${formatDayShort(state.day)}`;
  const strip = $('strip');
  clear(strip);
  for (const { day, total, done } of rows) {
    const level = total === 0 ? 'none' : String(Math.min(4, Math.ceil((done / total) * 4)));
    const label = total === 0
      ? `${formatDayShort(day)}: nothing scheduled`
      : `${formatDayShort(day)}: ${done} of ${total} taken`;
    const button = el('button', { type: 'button', title: label });
    button.dataset.level = level;
    button.dataset.day = day;
    button.setAttribute('aria-label', label);
    if (day === state.day) button.setAttribute('aria-current', 'true');
    strip.append(el('li', {}, button));
  }
}

/* --- the day's doses -------------------------------------------------- */

function renderDoses(view) {
  const list = $('med-list');
  clear(list);
  const empty = $('med-empty');
  const future = isFuture(state.day);

  if (view.rows.length === 0) {
    empty.hidden = false;
    empty.textContent = view.medications.length === 0
      ? 'No medications yet. Add one from the Medications button above.'
      : 'Nothing was being taken on this day.';
    $('day-progress').textContent = '';
    return;
  }
  empty.hidden = true;
  $('day-progress').textContent = `${view.done} of ${view.total}`;

  for (const { medication, slots, archived } of view.rows) {
    const slotNodes = slots.map(({ index, label, taken }) => {
      const input = el('input', { type: 'checkbox', checked: taken, disabled: future });
      input.dataset.medication = medication.id;
      input.dataset.slot = String(index);
      return el('label', { className: 'slot' }, [input, el('span', { textContent: label })]);
    });
    const name = el('div', { className: 'med-name' }, [
      el('span', { textContent: medication.name }),
      archived
        ? el('span', {
            className: 'chip',
            textContent: 'removed',
            title: 'Removed from the daily list. Still shown here because it was taken today.',
          })
        : null,
    ]);
    list.append(el('li', {}, el('div', { className: 'med' }, [
      name,
      el('div', { className: 'slots' }, slotNodes),
    ])));
  }
}

/* --- the day's notes -------------------------------------------------- */

function medicationName(view, id) {
  return view.medications.find((m) => m.id === id)?.name ?? null;
}

function renderNotes(view) {
  const list = $('note-list');
  clear(list);
  $('note-empty').hidden = view.notes.length > 0;

  for (const note of view.notes) {
    if (note.key === state.editingNoteKey) {
      list.append(el('li', {}, noteEditor(view, note)));
      continue;
    }
    const meta = [el('span', { textContent: formatTime(note.createdAt) })];
    const name = medicationName(view, note.medicationId);
    if (name) meta.push(el('span', { className: 'chip', textContent: name }));
    if (note.editedAt) meta.push(el('span', { textContent: 'edited' }));

    const edit = el('button', { type: 'button', className: 'ghost small', textContent: 'Edit' });
    edit.addEventListener('click', () => { state.editingNoteKey = note.key; refresh(); });
    const remove = el('button', { type: 'button', className: 'ghost small', textContent: 'Delete' });
    remove.addEventListener('click', async () => {
      if (!confirm('Delete this note?')) return;
      await store.deleteNote(note);
      refresh();
    });
    meta.push(el('div', { className: 'note-actions' }, [edit, remove]));

    list.append(el('li', {}, [
      el('div', { className: 'note-meta' }, meta),
      el('p', { className: 'note-text', textContent: note.text }),
    ]));
  }

  const select = $('note-med');
  const previous = select.value;
  clear(select);
  select.append(el('option', { value: '', textContent: 'No medication' }));
  for (const medication of view.medications) {
    select.append(el('option', { value: medication.id, textContent: medication.name }));
  }
  select.value = previous;

  const future = isFuture(state.day);
  $('note-text').disabled = future;
  $('note-form').querySelector('button[type="submit"]').disabled = future;
}

function noteEditor(view, note) {
  const text = el('textarea', { rows: 3, value: note.text });
  const select = el('select');
  select.append(el('option', { value: '', textContent: 'No medication' }));
  for (const medication of view.medications) {
    select.append(el('option', { value: medication.id, textContent: medication.name }));
  }
  select.value = note.medicationId ?? '';

  const save = el('button', { type: 'submit', className: 'small', textContent: 'Save' });
  const cancel = el('button', { type: 'button', className: 'ghost small', textContent: 'Cancel' });
  cancel.addEventListener('click', () => { state.editingNoteKey = null; refresh(); });

  const form = el('form', { className: 'note-form' }, [
    text,
    el('div', { className: 'note-form-row' }, [select, save, cancel]),
  ]);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!text.value.trim()) return;
    await store.updateNote(note, { text: text.value, medicationId: select.value || null });
    state.editingNoteKey = null;
    refresh();
  });
  return form;
}

/* --- refresh ---------------------------------------------------------- */

// Ticking a dose must not rebuild the list it came from: replacing the
// checkbox destroys keyboard focus and can swallow a second quick tap. The
// browser has already flipped the box, so only the tallies need redrawing.
async function refreshTallies() {
  const view = await store.readDay(state.day);
  $('day-progress').textContent = view.rows.length ? `${view.done} of ${view.total}` : '';
  await renderStrip();
}

async function refresh() {
  renderDayHeader();
  const view = await store.readDay(state.day);
  renderDoses(view);
  renderNotes(view);
  await renderStrip();
  if ($('med-dialog').open) await renderManage();
  return view;
}

function goTo(day) {
  if (isFuture(day)) {
    renderDayHeader(); // snap the date picker back to the day we are still on
    return;
  }
  state.day = day;
  state.knownToday = today();
  state.editingNoteKey = null;
  refresh();
}

/* --- medications sheet ------------------------------------------------ */

function showPane(name) {
  const dialog = $('med-dialog');
  for (const pane of dialog.querySelectorAll('[data-pane]')) {
    pane.hidden = pane.dataset.pane !== name;
  }
}

async function renderManage() {
  const medications = await store.listMedications();
  const list = $('manage-list');
  clear(list);

  if (medications.length === 0) {
    list.append(el('li', {}, el('p', { className: 'empty', textContent: 'Nothing here yet.' })));
    return;
  }

  const active = medications.filter((m) => !store.isArchived(m));
  for (const medication of medications) {
    const archived = store.isArchived(medication);
    const regimen = medication.regimens[medication.regimens.length - 1];
    const detail = archived
      ? `Archived ${formatDayShort(medication.archivedOn)} — still shown on earlier days`
      : `${regimen.dosesPerDay} ${regimen.dosesPerDay === 1 ? 'dose' : 'doses'} a day`;

    const name = el('div', { className: `manage-name${archived ? ' archived' : ''}` }, [
      el('span', { textContent: medication.name }),
      el('small', { textContent: detail }),
    ]);

    const actions = [];
    if (!archived && active.length > 1) {
      const index = active.findIndex((m) => m.id === medication.id);
      const up = el('button', { type: 'button', className: 'ghost small', textContent: '↑', title: 'Move up' });
      up.disabled = index === 0;
      up.addEventListener('click', async () => { await store.reorderMedication(medication, -1); refresh(); });
      const down = el('button', { type: 'button', className: 'ghost small', textContent: '↓', title: 'Move down' });
      down.disabled = index === active.length - 1;
      down.addEventListener('click', async () => { await store.reorderMedication(medication, 1); refresh(); });
      actions.push(up, down);
    }
    const edit = el('button', { type: 'button', className: 'ghost small', textContent: 'Edit' });
    edit.addEventListener('click', () => openEditor(medication));
    actions.push(edit);

    list.append(el('li', {}, [name, ...actions]));
  }
}

function openEditor(medication) {
  state.editing = medication;
  $('edit-title').textContent = medication.name;
  $('edit-name').value = medication.name;
  $('edit-since').value = medication.regimens[0].effectiveFrom;
  $('edit-since').max = today();

  const latest = medication.regimens[medication.regimens.length - 1];
  $('regimen-doses').value = String(latest.dosesPerDay);
  $('regimen-from').value = today();
  $('regimen-labels').value = (latest.labels ?? []).join(', ');

  const archived = store.isArchived(medication);
  $('archive-btn').textContent = archived ? 'Restore to daily list' : 'Remove from daily list';
  $('archive-hint').textContent = archived
    ? 'Restoring puts it back on today’s list and reconnects it to its full history.'
    : 'It stays on every day it was active for, and can be restored later.';

  renderRegimens(medication);
  showPane('edit');
}

function renderRegimens(medication) {
  const list = $('regimen-list');
  clear(list);
  for (const regimen of medication.regimens) {
    const labels = (regimen.labels ?? []).filter(Boolean).join(', ');
    const text = `${regimen.dosesPerDay} a day${labels ? ` (${labels})` : ''}`;
    const row = [
      el('span', { className: 'when', textContent: `from ${formatDayShort(regimen.effectiveFrom)}` }),
      el('span', { textContent: text }),
    ];
    if (medication.regimens.length > 1) {
      const remove = el('button', {
        type: 'button', className: 'ghost small', textContent: 'Remove',
        title: 'Remove this dose change',
      });
      remove.style.marginLeft = 'auto';
      remove.addEventListener('click', async () => {
        await store.removeRegimen(medication, regimen.effectiveFrom);
        await reopenEditor(medication.id);
      });
      row.push(remove);
    }
    list.append(el('li', {}, row));
  }
}

async function reopenEditor(id) {
  const medications = await store.listMedications();
  const fresh = medications.find((m) => m.id === id);
  await refresh();
  if (fresh) openEditor(fresh);
  else showPane('list');
}

/* --- data sheet ------------------------------------------------------- */

function showDataMessage(text, tone = 'info') {
  const node = $('data-message');
  node.textContent = text;
  node.dataset.tone = tone;
  node.hidden = false;
}

async function renderStorageStatus() {
  const node = $('storage-status');
  if (!navigator.storage?.estimate) { node.textContent = ''; return; }
  try {
    const { usage } = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    const kb = Math.max(1, Math.round((usage ?? 0) / 1024));
    node.textContent = persisted
      ? `Using about ${kb} KB. This browser has marked your data as persistent.`
      : `Using about ${kb} KB. This browser has not granted persistent storage, so clearing site data will erase it.`;
  } catch {
    node.textContent = '';
  }
}

async function doExport() {
  const data = await store.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: `pillage-backup-${today()}.json` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  const counts = store.summarise(data);
  showDataMessage(`Exported ${counts.medications} medications, ${counts.doses} dose records and ${counts.notes} notes.`);
}

async function doImport(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    showDataMessage('That file is not valid JSON.', 'error');
    return;
  }
  let incoming;
  try {
    incoming = store.summarise(data);
    if (data?.format !== store.EXPORT_FORMAT) throw new Error('Not a pillage export file.');
  } catch (err) {
    showDataMessage(err.message, 'error');
    return;
  }
  const current = store.summarise(await store.exportAll());
  const message = [
    'Restoring replaces everything stored in this browser.',
    '',
    `Discard: ${current.medications} medications, ${current.doses} dose records, ${current.notes} notes.`,
    `Restore: ${incoming.medications} medications, ${incoming.doses} dose records, ${incoming.notes} notes.`,
    '',
    'Continue?',
  ].join('\n');
  if (!confirm(message)) return;
  try {
    await store.importAll(data);
  } catch (err) {
    showDataMessage(err.message, 'error');
    return;
  }
  state.day = today();
  await refresh();
  await renderStorageStatus();
  showDataMessage(`Restored ${incoming.medications} medications, ${incoming.doses} dose records and ${incoming.notes} notes.`);
}

/* --- storage warning -------------------------------------------------- */

// WebKit deletes all script-writable storage for a site after seven days of
// Safari use without a visit, which would take the whole log with it.
//
// Detection is by feature, never by user agent: every desktop browser's user
// agent string contains the word "WebKit", so matching on it flags Chrome and
// Edge too. GestureEvent is a WebKit-only interface, and navigator.vendor
// catches the browsers on iOS and iPadOS, which are all WebKit underneath
// whatever name is on the icon.
function isWebKitEngine() {
  if (typeof window.GestureEvent !== 'undefined') return true;
  return navigator.vendor === 'Apple Computer, Inc.';
}

// A web app added to the Home Screen is exempt from the seven-day rule, so
// warning there would be false.
function isInstalled() {
  if (navigator.standalone === true) return true;
  return window.matchMedia?.('(display-mode: standalone)').matches === true;
}

function renderStorageWarning() {
  $('storage-warning').hidden = !isWebKitEngine() || isInstalled();
}

/* --- wiring ----------------------------------------------------------- */

function wire() {
  $('prev-day').addEventListener('click', () => goTo(addDays(state.day, -1)));
  $('next-day').addEventListener('click', () => goTo(addDays(state.day, 1)));
  $('today-btn').addEventListener('click', () => goTo(today()));
  $('day-picker').addEventListener('change', (event) => {
    if (event.target.value) goTo(event.target.value);
    else renderDayHeader(); // cleared picker: put the current day back
  });

  $('strip').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-day]');
    if (button) goTo(button.dataset.day);
  });

  document.addEventListener('keydown', (event) => {
    if (event.target.matches('input, textarea, select') || document.querySelector('dialog[open]')) return;
    if (event.key === 'ArrowLeft') goTo(addDays(state.day, -1));
    if (event.key === 'ArrowRight') goTo(addDays(state.day, 1));
  });

  $('med-list').addEventListener('change', async (event) => {
    const input = event.target.closest('input[type="checkbox"]');
    if (!input) return;
    await store.setDose(state.day, input.dataset.medication, Number(input.dataset.slot), input.checked);
    await refreshTallies();
  });

  $('note-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = $('note-text').value;
    if (!text.trim()) return;
    await store.addNote(state.day, text, $('note-med').value || null);
    $('note-text').value = '';
    $('note-med').value = '';
    refresh();
  });

  /* medications sheet */

  $('manage-btn').addEventListener('click', async () => {
    showPane('list');
    $('add-since').value = today();
    $('add-since').max = today();
    await renderManage();
    $('med-dialog').showModal();
  });

  $('edit-back').addEventListener('click', () => { state.editing = null; showPane('list'); });

  for (const button of document.querySelectorAll('[data-close]')) {
    button.addEventListener('click', () => button.closest('dialog').close());
  }

  // Adding a name that matches an archived medication offers a restore, so a
  // deleted medication is never silently duplicated.
  $('add-name').addEventListener('input', async () => {
    const hint = $('add-restore');
    const typed = $('add-name').value.trim().toLowerCase();
    hint.hidden = true;
    clear(hint);
    if (!typed) return;
    const match = (await store.listMedications())
      .find((m) => store.isArchived(m) && m.name.toLowerCase() === typed);
    if (!match) return;
    const button = el('button', {
      type: 'button', className: 'ghost small',
      textContent: `Restore ${match.name} (archived ${formatDayShort(match.archivedOn)})`,
    });
    button.addEventListener('click', async () => {
      await store.restoreMedication(match);
      $('add-name').value = '';
      hint.hidden = true;
      await refresh();
    });
    hint.append(button);
    hint.hidden = false;
  });

  $('add-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    await store.addMedication({
      name: $('add-name').value,
      dosesPerDay: Number($('add-doses').value),
      labels: parseLabels($('add-labels').value),
      since: $('add-since').value || today(),
    });
    event.target.reset();
    $('add-doses').value = '1';
    $('add-since').value = today();
    $('add-restore').hidden = true;
    await refresh();
  });

  $('edit-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const medication = state.editing;
    const regimens = [...medication.regimens];
    regimens[0] = { ...regimens[0], effectiveFrom: $('edit-since').value };
    await store.saveMedication({ ...medication, name: $('edit-name').value, regimens });
    await reopenEditor(medication.id);
  });

  $('regimen-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const medication = state.editing;
    await store.setRegimen(medication, {
      effectiveFrom: $('regimen-from').value,
      dosesPerDay: Number($('regimen-doses').value),
      labels: parseLabels($('regimen-labels').value),
    });
    await reopenEditor(medication.id);
  });

  $('archive-btn').addEventListener('click', async () => {
    const medication = state.editing;
    if (store.isArchived(medication)) await store.restoreMedication(medication);
    else await store.archiveMedication(medication);
    await reopenEditor(medication.id);
  });

  $('destroy-btn').addEventListener('click', async () => {
    const medication = state.editing;
    const warning = `Permanently delete ${medication.name} and every record of taking it?\n\n`
      + 'This cannot be undone and will change your history. Removing it from the '
      + 'daily list keeps the history intact instead.';
    if (!confirm(warning)) return;
    await store.deleteMedicationForever(medication);
    state.editing = null;
    await refresh();
    showPane('list');
  });

  /* data sheet */

  $('data-btn').addEventListener('click', async () => {
    $('data-message').hidden = true;
    await renderStorageStatus();
    $('data-dialog').showModal();
  });
  $('export-btn').addEventListener('click', doExport);
  $('import-btn').addEventListener('click', () => $('import-input').click());
  $('import-input').addEventListener('change', async (event) => {
    const [file] = event.target.files;
    event.target.value = '';
    if (file) await doImport(file);
  });
}

/* --- boot ------------------------------------------------------------- */

async function main() {
  wire();
  renderStorageWarning();
  await refresh();

  // Ask the browser not to evict us. Chrome decides silently, Firefox may
  // prompt, and a home-screen web app on iOS is exempt from WebKit's
  // seven-day cap on script-writable storage regardless.
  navigator.storage?.persist?.().catch(() => {});

  // Not on localhost: a worker caching your own edits back at you is a
  // miserable way to spend an afternoon.
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !isLocal) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // The day can roll over while the tab is left open overnight. Follow it
  // only if the user was sitting on today, not on some day they navigated to.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const now = today();
    if (now !== state.knownToday && state.day === state.knownToday) goTo(now);
    else state.knownToday = now;
  });
}

main();
