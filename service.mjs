import { BoardError, parseBoard, applyEdits, assertFresh, validateWrite } from "./core.mjs";

const stableFields = ["uuid", "createdAt", "content", "completedAt", "dismissedAt", "startAt", "endAt", "deadline", "hideUntil", "urgent", "important", "isRepeating", "repeat", "victoryValue", "isParent"];
const value = (task, key) => task[key] ?? null;
const sameIdentity = (a, b) => a?.uuid === b?.uuid && a?.createdAt === b?.createdAt;
export const journalKey = uuid => `kanban.pending.${uuid}`;

async function readTasks(app, uuid) {
  const inventory = await app.getNoteTasks({ uuid }, { includeDone: true });
  if (!Array.isArray(inventory) || new Set(inventory.map(task => task.uuid)).size !== inventory.length) throw new BoardError("The task inventory is inconsistent. Refresh before saving.");
  const tasks = [];
  // Neither API alone proves that dates persisted. Require both to agree.
  for (let start = 0; start < inventory.length; start += 8) {
    const batch = await Promise.all(inventory.slice(start, start + 8).map(task => app.getTask(task.uuid)));
    for (const task of batch) {
      if (!task || task.noteUUID !== uuid) throw new BoardError("A task moved or disappeared while the board was loading.");
      tasks.push(JSON.parse(JSON.stringify(task)));
    }
  }
  assertTasksPreserved(inventory, tasks);
  return tasks;
}

function sourceTask(source, uuid) {
  return parseBoard(source).allTaskRecords.find(record => record.uuid === uuid)?.metadata;
}

function assertSourceDates(source, tasks) {
  const records = new Map(parseBoard(source).allTaskRecords.map(record => [record.uuid, record.metadata]));
  for (const task of tasks) {
    const metadata = records.get(task.uuid);
    if (!metadata || metadata.createdAt !== task.createdAt) throw new BoardError("The Markdown and task identities do not agree. Refresh the board.");
    for (const key of ["hideUntil", "startAt", "endAt", "deadline", "completedAt", "dismissedAt"]) {
      if (value(metadata, key) !== value(task, key)) throw new BoardError(`The saved Markdown does not confirm task ${task.uuid}'s ${key}.`);
    }
  }
}

export function prepareRewrite(markdown, tasks) {
  const board = parseBoard(validateWrite(markdown));
  const pending = [], edits = [];
  for (const task of tasks) {
    if (task.completedAt != null || task.dismissedAt != null || !(task.hideUntil > 0)) continue;
    const record = board.taskRecords.find(record => record.uuid === task.uuid);
    if (!record || record.checked || record.metadata.hideUntil !== task.hideUntil) throw new BoardError("A hidden task cannot be matched safely to its Markdown. Refresh the note before saving.");
    edits.push({ start: record.range[0], end: record.range[1], text: `<!-- ${JSON.stringify({ ...record.metadata, hideUntil: null })} -->` });
    pending.push({ uuid: task.uuid, createdAt: task.createdAt, hideUntil: task.hideUntil });
  }
  return { markdown: applyEdits(markdown, edits), pending };
}

export function assertTasksPreserved(before, after) {
  const index = new Map(after.map(task => [task.uuid, task]));
  for (const task of before) {
    const current = index.get(task.uuid);
    if (!current) throw new BoardError(`Task ${task.uuid} is missing after the save. Open the note's revision history.`);
    for (const field of stableFields) {
      if (value(task, field) !== value(current, field)) throw new BoardError(`Task ${task.uuid} changed its ${field} during the save. Review the note before continuing.`);
    }
  }
}

export function createBoardService() {
  const busy = new Set(), localJournal = new Map();
  const readJournal = (app, uuid) => {
    const raw = localJournal.has(uuid) ? localJournal.get(uuid) : app.settings?.[journalKey(uuid)];
    if (!raw) return null;
    let journal;
    try { journal = JSON.parse(raw); } catch { throw new BoardError("The recovery record is invalid. Keep the note unchanged and inspect plugin settings."); }
    if (journal === null) return null;
    if (typeof journal !== "object" || journal.version !== 1 || journal.noteUUID !== uuid || !Array.isArray(journal.pending)) throw new BoardError("The recovery record does not match this note.");
    return journal;
  };
  const saveJournal = async (app, uuid, journal) => {
    const raw = journal ? JSON.stringify(journal) : null;
    await app.setSetting(journalKey(uuid), raw);
    localJournal.set(uuid, raw);
  };
  const lock = async (uuid, action) => {
    if (busy.has(uuid)) throw new BoardError("A save for this note is already running.");
    busy.add(uuid);
    try { return await action(); } finally { busy.delete(uuid); }
  };
  async function restoreHidden(app, noteUUID, journal) {
    const failures = [];
    for (const original of journal.pending) {
      try {
        let source = await app.getNoteContent({ uuid: noteUUID });
        const persisted = sourceTask(source, original.uuid);
        if (!sameIdentity(persisted, original)) throw new BoardError("The task moved or its identity changed.");
        const collection = await app.getNoteTasks({ uuid: noteUUID }, { includeDone: true });
        let task = collection.find(task => task.uuid === original.uuid);
        if (!sameIdentity(task, original) || task.noteUUID !== noteUUID || value(task, "hideUntil") !== value(persisted, "hideUntil")) throw new BoardError("The note and task inventory disagree about the hidden task.");
        if (task.hideUntil === original.hideUntil) {
          const individual = await app.getTask(original.uuid);
          if (!sameIdentity(individual, original) || individual.hideUntil !== original.hideUntil) throw new BoardError("The individual task readback is inconsistent.");
          continue;
        }
        // A non-null value belongs to a newer edit; never overwrite it during recovery.
        if (task.hideUntil != null) throw new BoardError("The hidden date was changed by another edit.");
        if (task.completedAt != null || task.dismissedAt != null) throw new BoardError("The task was completed or dismissed during the save.");
        // After a document replacement getTask/updateTask may still see the old
        // cached hidden value. Explicitly clearing it forces the native updater
        // to apply the subsequent restore instead of treating it as a no-op.
        if (await app.updateTask(original.uuid, { hideUntil: null }) !== true) throw new BoardError("The task date could not be prepared for restoration.");
        if (await app.updateTask(original.uuid, { hideUntil: original.hideUntil }) !== true) throw new BoardError("The task could not be updated.");
        task = await app.getTask(original.uuid);
        if (!sameIdentity(task, original) || task.hideUntil !== original.hideUntil) throw new BoardError("The restored date was not confirmed.");
        source = await app.getNoteContent({ uuid: noteUUID });
        if (sourceTask(source, original.uuid)?.hideUntil !== original.hideUntil) throw new BoardError("The restored date was not present in saved Markdown.");
        const finalTask = (await app.getNoteTasks({ uuid: noteUUID }, { includeDone: true })).find(task => task.uuid === original.uuid);
        if (!sameIdentity(finalTask, original) || finalTask.hideUntil !== original.hideUntil) throw new BoardError("The task inventory did not confirm the restored date.");
      } catch (error) {
        failures.push({ uuid: original.uuid, message: error?.message ?? String(error) });
      }
    }
    return failures;
  }
  async function snapshot(app, uuid) {
    const note = await app.notes.find(uuid);
    if (!note) throw new BoardError("This note no longer exists.");
    const pending = readJournal(app, note.uuid);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const source = await app.getNoteContent({ uuid: note.uuid });
        const tasks = await readTasks(app, note.uuid);
        assertFresh(source, await app.getNoteContent({ uuid: note.uuid }));
        assertSourceDates(source, tasks);
        return { note: { uuid: note.uuid, name: note.name }, source, board: parseBoard(source), tasks, pending };
      } catch (error) {
        // A native insertion can finish while its Markdown projection is still
        // settling. Retry coherent reads only; never retry a mutation here.
        if (!(error instanceof BoardError) || attempt === 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
  }
  async function rewrite(app, uuid, expected, transform) {
    if (!uuid || uuid.startsWith("local-")) throw new BoardError("Wait for this new note to finish saving, then refresh the board.");
    return lock(uuid, async () => {
      if (readJournal(app, uuid)) throw new BoardError("This note has an unfinished save. Restore pending task dates before editing again.");
      const before = await snapshot(app, uuid);
      assertFresh(expected, before.source);
      const desired = validateWrite(transform(before.source, before.tasks));
      if (desired === before.source) return before;
      const plan = prepareRewrite(desired, before.tasks);
      const journal = { version: 1, noteUUID: uuid, startedAt: new Date().toISOString(), phase: "prepared", pending: plan.pending };
      // The journal contains task IDs and dates, not private note bodies. Persist it
      // before the first note mutation, so a reloaded client can finish restoration.
      await saveJournal(app, uuid, journal);
      let writeStarted = false;
      try {
        assertFresh(expected, await app.getNoteContent({ uuid }));
        writeStarted = true;
        if (await app.replaceNoteContent({ uuid }, plan.markdown, { includeCompletedTasks: false, includeHiddenTasks: false }) !== true) throw new BoardError("Amplenote did not confirm the note replacement.");
        journal.phase = "restoring";
        const failures = await restoreHidden(app, uuid, journal);
        if (failures.length) throw new BoardError("Some hidden dates still need restoration: " + failures.map(item => item.uuid).join(", "));
        const afterTasks = await readTasks(app, uuid);
        assertTasksPreserved(before.tasks, afterTasks);
        assertSourceDates(await app.getNoteContent({ uuid }), afterTasks);
        await saveJournal(app, uuid, null);
        return snapshot(app, uuid);
      } catch (error) {
        if (!writeStarted) {
          await saveJournal(app, uuid, null);
          throw error;
        }
        // A failed RPC may still have changed the note. Restore dates even then,
        // but do not replay the write or roll back over a newer note edit.
        journal.phase = "needs-review";
        journal.error = error?.message ?? String(error);
        journal.restoreFailures = await restoreHidden(app, uuid, journal);
        try { await saveJournal(app, uuid, journal); } catch { /* The prepared journal remains durable. */ }
        throw new BoardError("The save needs review. " + journal.error);
      }
    });
  }
  async function recover(app, uuid) {
    return lock(uuid, async () => {
      const journal = readJournal(app, uuid);
      if (!journal) return { restored: true, needsReview: false };
      const failures = await restoreHidden(app, uuid, journal);
      if (failures.length) {
        journal.restoreFailures = failures;
        await saveJournal(app, uuid, journal);
        return { restored: false, needsReview: true, failures };
      }
      // Recovery only restores hidden dates. It never repeats a move or completes
      // a repeating task, and an uncertain write remains visible for user review.
      journal.phase = "restored-needs-review";
      await saveJournal(app, uuid, journal);
      return { restored: true, needsReview: true, journal };
    });
  }
  async function acknowledgeRecovery(app, uuid) {
    return lock(uuid, async () => {
      const journal = readJournal(app, uuid);
      if (journal && (await restoreHidden(app, uuid, journal)).length) throw new BoardError("Pending hidden dates could not be restored.");
      await saveJournal(app, uuid, null);
      return snapshot(app, uuid);
    });
  }
  return { snapshot, rewrite, recover, acknowledgeRecovery, pending: readJournal };
}
