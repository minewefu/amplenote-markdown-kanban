import { test } from "node:test";
import assert from "node:assert/strict";
import { createBoardService, prepareRewrite, assertTasksPreserved, journalKey, canonicalTaskContent } from "../service.mjs";
import { parseBoard, moveCard, applyEdits } from "../core.mjs";

const noteUUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const active = { uuid: "11111111-1111-4111-8111-111111111111", noteUUID, createdAt: 100, content: "Active", startAt: 300, hideUntil: null };
const hidden = { uuid: "22222222-2222-4222-8222-222222222222", noteUUID, createdAt: 101, content: "Hidden", hideUntil: 1893456000 };
const completed = { uuid: "33333333-3333-4333-8333-333333333333", noteUUID, createdAt: 102, content: "Completed", completedAt: 500 };
const initial = `# Backlog\n\n- [ ] Active<!-- ${JSON.stringify(active)} -->\n\n- [ ] Hidden<!-- ${JSON.stringify(hidden)} -->\n\n# Done\n\n# Completed tasks<!-- {"omit":true} -->\n\n- [x] Completed<!-- ${JSON.stringify(completed)} -->\n`;
const copy = obj => JSON.parse(JSON.stringify(obj));
function host(options = {}) {
  let markdown = initial, tasks = [active, hidden, completed].map(copy), writeCount = 0;
  const settings = {}, calls = [];
  const app = {
    settings, calls, notes: { find: async uuid => ({ uuid, name: "Board" }) },
    getNoteContent: async () => { if (options.onRead) markdown = options.onRead(markdown); return markdown; },
    getNoteTasks: async () => copy(tasks), getTask: async uuid => copy(tasks.find(task => task.uuid === uuid) ?? null),
    setSetting: async (key, val) => { calls.push(["journal", val]); if (options.failJournal && val) throw Error("storage failed"); settings[key] = val; },
    replaceNoteContent: async (note, content, flags) => {
      calls.push(["write", content, flags]); writeCount++;
      assert.ok(settings[journalKey(noteUUID)]);
      markdown = content;
      const board = parseBoard(content);
      // This deliberate host double models the loss observed in native probes:
      // a hidden-date-bearing task in the replacement is dropped by the parser.
      tasks = tasks.filter(task => task.completedAt || board.taskRecords.some(record => record.uuid === task.uuid && !record.metadata.hideUntil));
      tasks = tasks.map(task => {
        const metadata = board.taskRecords.find(record => record.uuid === task.uuid)?.metadata;
        return metadata ? { ...task, hideUntil: metadata.hideUntil ?? null } : task;
      });
      if (options.afterWrite) await options.afterWrite(app, tasks);
      if (options.throwAfterWrite) throw Error("response lost");
      return true;
    },
    updateTask: async (uuid, updates) => {
      calls.push(["update", uuid, updates]);
      if (options.failRestore) return false;
      const task = tasks.find(task => task.uuid === uuid);
      if (!task) return false;
      Object.assign(task, updates);
      const record = parseBoard(markdown).allTaskRecords.find(record => record.uuid === uuid);
      if (record && !options.ignorePersistedUpdates) markdown = applyEdits(markdown, [{start:record.range[0],end:record.range[1],text:`<!-- ${JSON.stringify({...record.metadata,...updates})} -->`}]);
      return true;
    },
    writes: () => writeCount
  };
  return app;
}
const move = md => moveCard(md, active.uuid, parseBoard(md).columns.at(-1).id);

test("rewrite preparation neutralizes only hidden metadata and retains opaque fields", () => {
  const plan = prepareRewrite(initial, [active, hidden, completed]);
  assert.equal(parseBoard(plan.markdown).taskRecords.find(task => task.uuid === hidden.uuid).metadata.hideUntil, null);
  assert.deepEqual(plan.pending, [{uuid:hidden.uuid,createdAt:101,hideUntil:1893456000}]);
  assert.ok(plan.markdown.includes(JSON.stringify(active)));
  assert.ok(plan.markdown.includes(JSON.stringify(completed)));
});
test("hidden descendants are included even when their parent is the visible card", () => {
  const md = `# Board\n\n- [ ] Parent\n  - [ ] Hidden<!-- ${JSON.stringify(hidden)} -->\n`;
  const plan = prepareRewrite(md, [hidden]);
  assert.equal(plan.pending.length, 1);
  assert.equal(parseBoard(plan.markdown).taskRecords[0].metadata.hideUntil, null);
});
test("missing hidden metadata rejects the write before any mutation", () => {
  assert.throws(() => prepareRewrite('# Board\n', [hidden]), /hidden task/);
});
test("a move journals first, preserves all tasks and restores the hidden date", async () => {
  const app = host(), service = createBoardService();
  await service.rewrite(app, noteUUID, initial, move);
  assert.equal(app.writes(), 1);
  assert.equal(app.calls[0][0], "journal");
  assert.equal((await app.getTask(hidden.uuid)).hideUntil, hidden.hideUntil);
  assertTasksPreserved([active, hidden, completed], await app.getNoteTasks());
  assert.equal(app.settings[journalKey(noteUUID)], null);
  assert.deepEqual(app.calls.find(call => call[0] === "write")[2], {includeCompletedTasks:false,includeHiddenTasks:false});
});
test("stale source is rejected without a journal or a write", async () => {
  const app = host();
  await assert.rejects(createBoardService().rewrite(app, noteUUID, initial + 'stale', move), /changed/);
  assert.equal(app.calls.length, 0);
});
test("journal persistence failure leaves note content unchanged", async () => {
  const app = host({ failJournal: true });
  await assert.rejects(createBoardService().rewrite(app, noteUUID, initial, move), /storage failed/);
  assert.equal(app.writes(), 0);
});
test("an edit that arrives while persisting the journal cancels the write", async () => {
  let reads = 0;
  const app = host({ onRead: md => ++reads >= 3 ? md + '\nExternal' : md });
  await assert.rejects(createBoardService().rewrite(app, noteUUID, initial, move), /changed/);
  assert.equal(app.writes(), 0);
  assert.equal(app.settings[journalKey(noteUUID)], null);
});
test("a lost response restores dates but never retries the uncertain note replacement", async () => {
  const app = host({ throwAfterWrite: true });
  const service = createBoardService();
  await assert.rejects(service.rewrite(app, noteUUID, initial, move), /needs review/);
  assert.equal(app.writes(), 1);
  assert.equal((await app.getTask(hidden.uuid)).hideUntil, hidden.hideUntil);
  assert.equal(JSON.parse(app.settings[journalKey(noteUUID)]).phase, "needs-review");
  await assert.rejects(service.rewrite(app, noteUUID, await app.getNoteContent(), move), /unfinished save/);
});
test("a fresh service recovers a failed restoration using the durable journal", async () => {
  const options = { failRestore: true }, app = host(options);
  await assert.rejects(createBoardService().rewrite(app, noteUUID, initial, move), /needs review/);
  assert.equal((await app.getTask(hidden.uuid)).hideUntil, null);
  options.failRestore = false;
  const freshService = createBoardService();
  assert.equal((await freshService.recover(app, noteUUID)).restored, true);
  assert.equal((await app.getTask(hidden.uuid)).hideUntil, hidden.hideUntil);
  await freshService.acknowledgeRecovery(app, noteUUID);
  assert.equal(app.settings[journalKey(noteUUID)], null);
});
test("recovery does not overwrite a newer hidden date", async () => {
  const app = host({ afterWrite: async (app, tasks) => { tasks.find(task => task.uuid === hidden.uuid).hideUntil = 1893459999; } });
  await assert.rejects(createBoardService().rewrite(app, noteUUID, initial, move), /needs review/);
  const recovered = await createBoardService().recover(app, noteUUID);
  assert.equal(recovered.restored, false);
  assert.equal((await app.getTask(hidden.uuid)).hideUntil, 1893459999);
});
test("simultaneous commands for one note cannot start two writes", async () => {
  let release;
  const paused = new Promise(resolve => { release = resolve; });
  const app = host({ afterWrite: () => paused }), service = createBoardService();
  const pending = service.rewrite(app, noteUUID, initial, move);
  await assert.rejects(service.rewrite(app, noteUUID, initial, move), /already running/);
  release();
  await pending;
  assert.equal(app.writes(), 1);
});
test("new local-only notes and changed task metadata are not accepted as verified", async () => {
  await assert.rejects(createBoardService().rewrite(host(), 'local-new', initial, move), /finish saving/);
  assert.throws(() => assertTasksPreserved([active], [{...active,startAt:400}]), /startAt/);
  assert.throws(() => assertTasksPreserved([active], []), /missing/);
});

test("a collection/individual disagreement is rejected instead of choosing a convenient result", async () => {
  const app = host();
  const nativeCollection = app.getNoteTasks;
  app.getNoteTasks = async (...args) => (await nativeCollection(...args)).map(task => task.uuid === hidden.uuid ? { ...task, hideUntil: null } : task);
  await assert.rejects(createBoardService().rewrite(app, noteUUID, initial, move), /hideUntil/);
  assert.equal(app.writes(), 0);
  assert.equal((await app.getTask(hidden.uuid)).hideUntil, hidden.hideUntil);
  assert.equal(app.settings[journalKey(noteUUID)], undefined);
});

test("successful task RPCs cannot hide a failed Markdown persistence update", async () => {
  const app = host({ ignorePersistedUpdates: true });
  await assert.rejects(createBoardService().rewrite(app, noteUUID, initial, move), /needs review/);
  assert.notEqual(app.settings[journalKey(noteUUID)], null);
});

test("the native hidden-date updater is forced through null before restoring an old cached value", async () => {
  const app = host();
  const originalGet = app.getTask;
  let stale = false;
  const originalWrite = app.replaceNoteContent;
  app.replaceNoteContent = async (...args) => { const result = await originalWrite(...args); stale = true; return result; };
  app.getTask = async uuid => { const task = await originalGet(uuid); return stale && uuid === hidden.uuid ? {...task,hideUntil:hidden.hideUntil} : task; };
  const originalUpdate = app.updateTask;
  app.updateTask = async (uuid, update) => {
    if (stale && update.hideUntil === hidden.hideUntil) return true;
    if (update.hideUntil === null) stale = false;
    return originalUpdate(uuid, update);
  };
  await createBoardService().rewrite(app, noteUUID, initial, move);
  assert.equal(sourceTaskDate(await app.getNoteContent()), hidden.hideUntil);
  assert.equal(app.settings[journalKey(noteUUID)], null);
});
function sourceTaskDate(markdown) { return parseBoard(markdown).allTaskRecords.find(record => record.uuid === hidden.uuid).metadata.hideUntil; }

test("a native string-valued null setting is treated as a cleared journal", async () => {
  const app = host();
  app.settings[journalKey(noteUUID)] = "null";
  const result = await createBoardService().rewrite(app, noteUUID, initial, move);
  assert.equal(result.pending,null);
  assert.equal(app.writes(),1);
});

test("a transient Markdown projection settles with read retries and no writes", async () => {
  let reads=0;
  const app=host({onRead:markdown=>++reads===2?'\n'+markdown:markdown});
  const snapshot=await createBoardService().snapshot(app,noteUUID);
  assert.ok(snapshot.source.startsWith('\n# Backlog'));
  assert.equal(app.writes(),0);
  assert.equal(snapshot.tasks.length,3);
});

test("resolved local links compare by confirmed identity without changing labels or code",async()=>{
  const local='local-44444444-4444-4444-8444-444444444444',real='55555555-5555-4555-8555-555555555555';
  const url='https://www.amplenote.com/notes/'+local,target='https://www.amplenote.com/notes/'+real;
  const app={notes:{find:async id=>id===local?{uuid:real}:null}};
  const content=`[${url}](${url} "${url}") and \`${url}\``;
  assert.equal(await canonicalTaskContent(app,content),`[${url}](${target} "${url}") and \`${url}\``);
  assert.equal(await canonicalTaskContent({notes:{find:async()=>null}},content),content);
});

test("a stale task cache's local link does not hide actual text edits",async()=>{
  const local='local-44444444-4444-4444-8444-444444444444',real='55555555-5555-4555-8555-555555555555';
  const localContent=`Active [Note](https://www.amplenote.com/notes/${local})`,realContent=`Active [Note](https://www.amplenote.com/notes/${real})`;
  const app=host({onRead:md=>md.replace('- [ ] Active<!--','- [ ] '+realContent+'<!--')});
  const getMany=app.getNoteTasks,getOne=app.getTask,find=app.notes.find;
  app.notes.find=async id=>id===local?{uuid:real}:find(id);
  app.getNoteTasks=async()=> (await getMany()).map(task=>task.uuid===active.uuid?{...task,content:realContent}:task);
  app.getTask=async id=>{const task=await getOne(id);return id===active.uuid?{...task,content:localContent}:task;};
  const result=await createBoardService().snapshot(app,noteUUID);
  assert.equal(result.tasks.find(task=>task.uuid===active.uuid).content,realContent);
  app.getTask=async id=>{const task=await getOne(id);return id===active.uuid?{...task,content:localContent+' changed'}:task;};
  await assert.rejects(createBoardService().snapshot(app,noteUUID),/content/);
});
