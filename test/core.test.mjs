import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBoard, moveCard, renameColumn, addColumn, deleteColumn, reorderColumns, assertFresh, applyEdits, validateWrite } from "../core.mjs";

const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const taskA = `- [ ] Keep **format**, C:\\work\\file [detail][^1] <!-- {"uuid":"${A}","startAt":1788958800,"extra":{"value":"opaque"}} -->`;
const taskB = `- [x] Finished <!-- {"uuid":"${B}","completedAt":1788861600} -->`;
const footer = '[^1]: [Rich **detail**](https://example.com)\n\n# A footnote heading\n\n- [ ] Footnote text\n\n![Image](https://example.com/image.png)\n';
const source = `Intro stays.\n\n# Backlog <!-- {"collapsed":true} -->\n\n${taskA}\n\nParagraph after tasks.\n\n# Done\n\n${taskB}\n\n${footer}`;
const heading = (md, title) => parseBoard(md).columns.find(column => column.title === title).id;

test("headings and top-level tasks preserve exact raw text and opaque metadata", () => {
  const board = parseBoard(source);
  assert.deepEqual(board.columns.map(column => column.title), ["Unassigned", "Backlog", "Done"]);
  assert.equal(board.cards.length, 2);
  assert.equal(board.cards[0].raw, taskA);
  assert.deepEqual(board.cards[0].metadata.extra, { value: "opaque" });
  assert.equal(board.footer, footer);
});
test("a card move retains UUID, schedule, footnotes, backslashes and unrelated prose", () => {
  const moved = moveCard(source, A, heading(source, "Done"));
  const after = parseBoard(moved);
  assert.equal(after.columns.at(-1).cards.at(-1).uuid, A);
  assert.equal(after.cards.find(card => card.uuid === A).raw, taskA);
  assert.equal(after.footer, footer);
  assert.ok(moved.includes("Paragraph after tasks."));
  assert.ok(moved.startsWith("Intro stays."));
});
test("reordering in a column uses a card target without dropping either task", () => {
  const first = moveCard(source, A, heading(source, "Done"));
  const reordered = moveCard(first, A, heading(first, "Done"), { beforeCardId: B });
  assert.deepEqual(parseBoard(reordered).columns.at(-1).cards.map(card => card.uuid), [A, B]);
  assert.equal(moveCard(reordered, A, heading(reordered, "Done"), { beforeCardId: A }), reordered);
});
test("no cards are created from fenced code, quotes, nested examples or footnote content", () => {
  const md = '# Work\n\n```md\n# False\n- [ ] false\n```\n\n> # Quoted\n> - [ ] quoted\n\n- Ordinary list\n  - [ ] Nested ordinary example\n\n- [ ] Parent\n  - [ ] Child\n';
  const board = parseBoard(md);
  assert.equal(board.cards.length, 1);
  assert.equal(board.cards[0].hasNestedList, true);
  assert.deepEqual(board.columns.map(column => column.title), ["Unassigned", "Work"]);
});
test("parent movement keeps its child task block attached", () => {
  const md = '# A\n\n- [ ] Parent\n  - [ ] Child\n\n# B\n';
  const board = parseBoard(md);
  assert.ok(moveCard(md, board.cards[0].id, heading(md, "B")).includes('- [ ] Parent\n  - [ ] Child'));
});
test("duplicate heading names remain independently addressable", () => {
  const md = '# Same\n\n- [ ] First\n\n# Same\n\n- [ ] Second\n';
  const board = parseBoard(md);
  const result = moveCard(md, board.cards[0].id, board.columns[2].id);
  assert.equal(parseBoard(result).columns[1].cards.length, 0);
  assert.equal(parseBoard(result).columns[2].cards.length, 2);
});
test("CRLF is retained when moving a card", () => {
  const md = source.replaceAll('\n', '\r\n');
  const result = moveCard(md, A, heading(md, "Done"));
  assert.equal(result.replaceAll('\r\n', '').includes('\n'), false);
  assert.equal(parseBoard(result).footer, footer.replaceAll('\n', '\r\n'));
});
test("renaming retains heading metadata and escapes heading syntax", () => {
  const renamed = renameColumn(source, heading(source, "Backlog"), "*Next* [work]");
  assert.ok(renamed.includes('# \\*Next\\* \\[work\\] <!-- {"collapsed":true} -->'));
  assert.equal(parseBoard(renamed).cards[0].raw, taskA);
  assert.throws(() => renameColumn(source, "unassigned", "X"));
  assert.throws(() => renameColumn(source, heading(source, "Backlog"), "X\n# Inject"));
});
test("adding a column occurs before rich-footnote definitions", () => {
  const added = addColumn(source, "Review");
  assert.equal(parseBoard(added).columns.at(-1).title, "Review");
  assert.equal(parseBoard(added).footer, footer);
});
for (const title of ["Backlog", "Done"]) test(`deleting ${title} promotes its tasks without losing prose or footnotes`, () => {
  const result = deleteColumn(source, heading(source, title));
  const board = parseBoard(result);
  assert.equal(board.columns[0].cards.length, 1);
  assert.equal(board.cards.length, 2);
  assert.equal(board.footer, footer);
  assert.ok(result.includes('Paragraph after tasks.'));
  assert.ok(!board.columns.some(column => column.title === title));
});
test("column reordering keeps each body with its heading and the footer at the end", () => {
  const board = parseBoard(source);
  const result = reorderColumns(source, [board.columns[2].id, board.columns[1].id]);
  const after = parseBoard(result);
  assert.deepEqual(after.columns.slice(1).map(column => column.title), ["Done", "Backlog"]);
  assert.equal(after.columns[1].cards[0].uuid, B);
  assert.equal(after.columns[2].cards[0].uuid, A);
  assert.equal(after.footer, footer);
  assert.throws(() => reorderColumns(source, [board.columns[1].id, board.columns[1].id]));
});
test("end-of-file task without newline remains distinct after a column reorder", () => {
  const md = '# A\n\n- [ ] first\n\n# B\n\n- [ ] last';
  const board = parseBoard(md);
  const result = reorderColumns(md, [board.columns[2].id, board.columns[1].id]);
  assert.equal(parseBoard(result).cards.length, 2);
  assert.equal(parseBoard(result).columns[2].title, "A");
});
test("open-card limits reject a full destination without counting completed cards", () => {
  const filled = moveCard(source, A, heading(source, "Done"), { limit: 1 });
  const md = filled.replace('# Done', '- [ ] Another\n\n# Done');
  const other = parseBoard(md).cards.find(card => card.title === "Another");
  assert.throws(() => moveCard(md, other.id, heading(md, "Done"), { limit: 1 }), /limit/);
});
test("stale content, duplicate identities, oversized writes and overlapping edits fail closed", () => {
  assert.doesNotThrow(() => assertFresh(source, source));
  assert.throws(() => assertFresh(source, source + 'external edit'));
  assert.throws(() => parseBoard(source.replace(taskB, taskA)), /Duplicate/);
  assert.throws(() => validateWrite(source, 10), /too large/);
  assert.throws(() => applyEdits('abc', [{start: 0, end: 2, text: ''}, {start: 1, end: 3, text: ''}]), /Overlapping/);
});

test("native generated completed section is protected and is not a user column", () => {
  const archive = `# Completed tasks<!-- {"omit":true} -->\n\n${taskB}\n\n`;
  const md = `# Backlog\n\n${taskA}\n\n# Done\n\n${archive}${footer}`;
  const board = parseBoard(md);
  assert.equal(board.cards.length, 1);
  assert.deepEqual(board.columns.map(column => column.title), ["Unassigned", "Backlog", "Done"]);
  assert.equal(board.archive, archive);
  for (const result of [moveCard(md, A, heading(md, "Done")), addColumn(md, "Review"), deleteColumn(md, heading(md, "Backlog")), reorderColumns(md, [board.columns[2].id, board.columns[1].id])]) {
    assert.equal(parseBoard(result).suffix, archive + footer);
  }
});

test("native multiline task metadata at the end of a hard-break paragraph is recognized", () => {
  const md = `# Work\n\n- [ ] First line\\\nSecond paragraph.<!-- {"uuid":"${A}","startAt":1788958800} -->\n\n# Next\n`;
  const board = parseBoard(md);
  assert.equal(board.cards[0].uuid, A);
  assert.equal(parseBoard(moveCard(md, A, heading(md, "Next"))).cards[0].raw, board.cards[0].raw);
});

test("dropping onto a completed card appends in the final heading without moving the archive", () => {
  const archive=`# Completed tasks<!-- {"omit":true} -->\n\n${taskB}\n\n`;
  const md=`# Backlog\n\n${taskA}\n\n# Done\n\n${archive}${footer}`;
  const result=moveCard(md,A,heading(md,"Done"),{beforeCardId:B});
  assert.equal(parseBoard(result).columns.at(-1).cards[0].uuid,A);
  assert.equal(parseBoard(result).suffix,archive+footer);
  assert.throws(()=>moveCard(md,A,"unassigned",{beforeCardId:B}),/changed/);
});
