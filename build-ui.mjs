import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const client = (await build({entryPoints:["ui/client.mjs"],bundle:true,write:false,platform:"browser",format:"iife",minify:true,target:"es2022",legalComments:"inline"})).outputFiles[0].text;
const style = (await readFile("ui/style.css","utf8")).replaceAll("\r\n","\n");
const shell = (await readFile("ui/shell.html","utf8")).replaceAll("\r\n","\n");
await mkdir("dist",{recursive:true});
await writeFile("dist/ui-client.js",client);
const preview=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>/*STYLE*/body{padding:20px}h1{font-size:20px;margin-bottom:16px}img{max-width:100%;height:auto;border-radius:8px}#preview-body{overflow-wrap:anywhere}#preview-source{display:inline-block;margin:14px 0;font-size:12px}pre{white-space:pre-wrap}</style></head><body><h1 id="preview-title"></h1><article id="preview-body"></article><a id="preview-source" target="_blank" rel="noopener noreferrer" hidden>Open link ↗</a><p id="preview-error" role="alert"></p><script id="preview-state" type="application/json">/*STATE*/</script><script>/*CLIENT*/</script></body></html>`;
const module = `const client=${JSON.stringify(client.replace(/<\/script/gi,"<\\/script"))};\nconst style=${JSON.stringify(style)};\nconst boardShell=${JSON.stringify(shell)};\nconst previewShell=${JSON.stringify(preview)};\nexport function renderPage(kind,state){return (kind==="preview"?previewShell:boardShell).replace("/*STYLE*/",()=>style).replace("/*CLIENT*/",()=>client).replace("/*STATE*/",()=>state);}\n`;
await writeFile("dist/ui-template.mjs",module);
console.log(`Built shared board/preview template (${Buffer.byteLength(module)} bytes).`);
