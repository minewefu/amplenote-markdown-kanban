import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { JSDOM } from "jsdom";

test("the bundled parser uses the documented iframe DOM without Node globals", async () => {
  const dom=new JSDOM("");
  const context = vm.createContext({document:dom.window.document});
  vm.runInContext(await readFile(new URL("../dist/kanban-core.js", import.meta.url), "utf8"), context, { timeout: 3000 });
  const result = context.KanbanCore.parseBoard('# A &amp; B\n\n- [ ] Keep &#x1f9ea; &copy;\n');
  assert.equal(result.columns[1].title, "A & B");
  assert.equal(result.cards[0].title, "Keep 🧪 ©");
  dom.window.close();
});
