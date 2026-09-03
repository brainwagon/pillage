// The domain: medications, regimens, doses and notes.
// Speaks the vocabulary in CONTEXT.md; the storage details live in db.js.

import * as db from './db.js';
import { today, formatTime } from './dates.js';

export const EXPORT_FORMAT = 'pillage-export';
export const EXPORT_VERSION = 1;

/* --- keys ------------------------------------------------------------- */

export function doseKey(day, medicationId, slot) {
  return `${day}|${medicationId}|${slot}`;
}

// Padded so that epoch millis sort lexicographically alongside each other.
function noteKey(day, createdAt, id) {
  return `${day}|${String(createdAt).padStart(14, '0')}|${id}`;
}

/* --- regimens --------------------------------------------------------- */

// The regimen in effect on `day`: the latest one starting on or before it.
// Null when the medication was not yet being taken. Regimens are kept sorted
// by effectiveFrom and are never edited in place — see docs/adr/0001.
export function regimenOn(medication, day) {
  let found = null;
  for (const regimen of medication.regimens) {
    if (regimen.effectiveFrom > day) break;
    found = regimen;
  }
  return found;
}

// Archiving takes effect immediately, so the daily list visibly changes the
// moment the user asks for it.
export function isActiveOn(medication, day) {
  if (!regimenOn(medication, day)) return false;
  return !medication.archivedOn || day < medication.archivedOn;
}

// An archived medication still appears on any day it was actually taken, so
// archiving one you have already taken today never hides that evidence.
export function isVisibleOn(medication, day, hasRecord) {
  if (!regimenOn(medication, day)) return false;
  return isActiveOn(medication, day) || hasRecord;
}

export function isArchived(medication) {
  return Boolean(medication.archivedOn);
}

export function slotLabel(regimen, index) {
  const label = regimen.labels?.[index]?.trim();
  if (label) return label;
  return regimen.dosesPerDay === 1 ? 'Taken' : `Dose ${index + 1}`;
}

function sortRegimens(regimens) {
  return [...regimens].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

/* --- medications ------------------------------------------------------ */

export async function listMedications() {
  const medications = await db.getAll(db.MEDICATIONS);
  return medications.sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function addMedication({ name, dosesPerDay = 1, labels = [], since = today() }) {
  const existing = await listMedications();
  const medication = {
    id: db.uuid(),
    name: name.trim(),
    regimens: [{ effectiveFrom: since, dosesPerDay, labels }],
    archivedOn: null,
    sortOrder: existing.length ? Math.max(...existing.map((m) => m.sortOrder)) + 1 : 0,
    createdAt: Date.now(),
  };
  await db.put(db.MEDICATIONS, medication);
  return medication;
}

export async function saveMedication(medication) {
  await db.put(db.MEDICATIONS, { ...medication, regimens: sortRegimens(medication.regimens) });
}

// Appends a regimen, or replaces the one starting on the same day. Earlier
// regimens are left untouched so past days keep rendering the doses that
// actually applied at the time.
export async function setRegimen(medication, { effectiveFrom, dosesPerDay, labels }) {
  const regimens = medication.regimens.filter((r) => r.effectiveFrom !== effectiveFrom);
  regimens.push({ effectiveFrom, dosesPerDay, labels });
  await saveMedication({ ...medication, regimens });
}

export async function removeRegimen(medication, effectiveFrom) {
  if (medication.regimens.length <= 1) throw new Error('A medication needs at least one regimen');
  const regimens = medication.regimens.filter((r) => r.effectiveFrom !== effectiveFrom);
  await saveMedication({ ...medication, regimens });
}

// Deleting a medication archives it: it leaves today's checklist but stays on
// every day it was active for. Reversible.
export async function archiveMedication(medication) {
  await saveMedication({ ...medication, archivedOn: today() });
}

export async function restoreMedication(medication) {
  await saveMedication({ ...medication, archivedOn: null });
}

// The escape hatch: destroys the medication and every trace of it. Notes that
// referenced it survive, with the reference dropped.
export async function deleteMedicationForever(medication) {
  const [doses, notes] = await Promise.all([
    db.getAll(db.DOSES),
    db.getAll(db.NOTES),
  ]);
  const orphanedDoses = doses.filter((d) => d.medicationId === medication.id);
  const taggedNotes = notes.filter((n) => n.medicationId === medication.id);
  await db.withTx(db.ALL_STORES, 'readwrite', (tx) => {
    tx.objectStore(db.MEDICATIONS).delete(medication.id);
    const doseStore = tx.objectStore(db.DOSES);
    for (const dose of orphanedDoses) doseStore.delete(dose.key);
    const noteStore = tx.objectStore(db.NOTES);
    for (const note of taggedNotes) noteStore.put({ ...note, medicationId: null });
  });
  return { doses: orphanedDoses.length, notes: taggedNotes.length };
}

export async function reorderMedication(medication, delta) {
  const medications = (await listMedications()).filter((m) => !isArchived(m));
  const index = medications.findIndex((m) => m.id === medication.id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= medications.length) return;
  const [moved] = medications.splice(index, 1);
  medications.splice(target, 0, moved);
  await db.withTx(db.MEDICATIONS, 'readwrite', (tx) => {
    const store = tx.objectStore(db.MEDICATIONS);
    medications.forEach((m, i) => store.put({ ...m, sortOrder: i }));
  });
}

/* --- doses ------------------------------------------------------------ */

// Only taken doses are stored. The absence of a record means the dose was not
// taken, which is why unticking is a delete.
export async function setDose(day, medicationId, slot, taken) {
  const key = doseKey(day, medicationId, slot);
  if (!taken) {
    await db.del(db.DOSES, key);
    return;
  }
  await db.put(db.DOSES, {
    key,
    day,
    medicationId,
    slot,
    recordedAt: Date.now(), // distinguishes a backfilled tick from a live one
  });
}

/* --- notes ------------------------------------------------------------ */

export async function addNote(day, text, medicationId = null) {
  const createdAt = Date.now();
  const id = db.uuid();
  const note = { key: noteKey(day, createdAt, id), id, day, createdAt, text: text.trim(), medicationId };
  await db.put(db.NOTES, note);
  return note;
}

export async function updateNote(note, { text, medicationId }) {
  await db.put(db.NOTES, {
    ...note,
    text: text.trim(),
    medicationId: medicationId ?? null,
    editedAt: Date.now(),
  });
}

export async function deleteNote(note) {
  await db.del(db.NOTES, note.key);
}

/* --- reading a day ---------------------------------------------------- */

export async function readDay(day) {
  const [medications, doses, notes] = await Promise.all([
    listMedications(),
    db.getAll(db.DOSES, db.prefixRange(`${day}|`)),
    db.getAll(db.NOTES, db.prefixRange(`${day}|`)),
  ]);
  const taken = new Set(doses.map((d) => d.key));
  const recorded = new Set(doses.map((d) => d.medicationId));
  const rows = [];
  for (const medication of medications) {
    if (!isVisibleOn(medication, day, recorded.has(medication.id))) continue;
    const regimen = regimenOn(medication, day);
    const slots = [];
    for (let i = 0; i < regimen.dosesPerDay; i++) {
      slots.push({ index: i, label: slotLabel(regimen, i), taken: taken.has(doseKey(day, medication.id, i)) });
    }
    rows.push({
      medication,
      regimen,
      slots,
      // Shown only because it was taken today, after being archived.
      archived: !isActiveOn(medication, day),
    });
  }
  const total = rows.reduce((n, row) => n + row.slots.length, 0);
  const done = rows.reduce((n, row) => n + row.slots.filter((s) => s.taken).length, 0);
  return {
    day,
    rows,
    notes: notes.sort((a, b) => a.createdAt - b.createdAt),
    medications,
    total,
    done,
  };
}

/* --- adherence over a span -------------------------------------------- */

// One range scan over the whole span, rather than a query per day.
export async function readAdherence(days) {
  const first = days[0];
  const last = days[days.length - 1];
  const [medications, doses] = await Promise.all([
    listMedications(),
    db.getAll(db.DOSES, IDBKeyRange.bound(`${first}|`, `${last}|\uffff`)),
  ]);
  const countByDay = new Map();
  const recordedByDay = new Map();
  for (const dose of doses) {
    countByDay.set(dose.day, (countByDay.get(dose.day) ?? 0) + 1);
    if (!recordedByDay.has(dose.day)) recordedByDay.set(dose.day, new Set());
    recordedByDay.get(dose.day).add(dose.medicationId);
  }
  return days.map((day) => {
    const recorded = recordedByDay.get(day) ?? new Set();
    let total = 0;
    for (const medication of medications) {
      if (isVisibleOn(medication, day, recorded.has(medication.id))) {
        total += regimenOn(medication, day).dosesPerDay;
      }
    }
    return { day, total, done: Math.min(countByDay.get(day) ?? 0, total) };
  });
}

/* --- export / import -------------------------------------------------- */

export async function exportAll() {
  const [medications, doses, notes] = await Promise.all([
    db.getAll(db.MEDICATIONS),
    db.getAll(db.DOSES),
    db.getAll(db.NOTES),
  ]);
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    medications,
    doses,
    notes,
  };
}

export function summarise(data) {
  return {
    medications: data.medications?.length ?? 0,
    doses: data.doses?.length ?? 0,
    notes: data.notes?.length ?? 0,
  };
}

// Replace, not merge: this is a backup, not a sync. Merging would need a
// per-record clock we do not keep, and deletes cannot be merged at all when
// an absent dose record is how "not taken" is represented.
export async function importAll(data) {
  if (data?.format !== EXPORT_FORMAT) throw new Error('Not a pillage export file.');
  if (data.version > EXPORT_VERSION) {
    throw new Error(`That file was written by a newer version of pillage (v${data.version}).`);
  }
  for (const key of ['medications', 'doses', 'notes']) {
    if (!Array.isArray(data[key])) throw new Error(`Export file is missing its "${key}".`);
  }
  await db.replaceAll(data);
}

export { formatTime };
