import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

await mkdir("dist", { recursive: true });
// A development core bundle, not an installable Kanban plugin yet.
await build({ entryPoints: ["core.mjs"], outfile: "dist/kanban-core.js", bundle: true,
  platform: "browser", conditions: ["worker"], format: "iife", globalName: "KanbanCore", minify: true,
  target: "es2022", legalComments: "external" });
const bytes = await readFile("dist/kanban-core.js");
await writeFile("dist/core-manifest.json", JSON.stringify({ version: "0.1.0", bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"), installablePlugin: false,
  hostWritesVerified: false }, null, 2) + "\n");
console.log(`Built development core: ${bytes.length} bytes. Full interface host validation remains in progress.`);
