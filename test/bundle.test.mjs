import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("the bundled parser runs in a plugin worker without a DOM or Node globals", async () => {
  const context = vm.createContext({});
  vm.runInContext(await readFile(new URL("../dist/kanban-core.js", import.meta.url), "utf8"), context, { timeout: 3000 });
  const result = context.KanbanCore.parseBoard('# A &amp; B\n\n- [ ] Keep &#x1f9ea; &copy;\n');
  assert.equal(result.columns[1].title, "A & B");
  assert.equal(result.cards[0].title, "Keep 🧪 ©");
});
