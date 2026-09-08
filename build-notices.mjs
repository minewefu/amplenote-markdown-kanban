import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";

const root=process.cwd();
const lock=JSON.parse(await readFile("package-lock.json","utf8"));
const groups=new Map(),rows=[];
for(const [relative,record] of Object.entries(lock.packages)){
  if(!relative || record.dev || !relative.startsWith("node_modules/"))continue;
  const dir=path.resolve(root,relative);
  if(!dir.toLowerCase().startsWith((path.join(root,"node_modules")+path.sep).toLowerCase()))throw Error("Unexpected dependency path");
  const metadata=JSON.parse(await readFile(path.join(dir,"package.json"),"utf8"));
  const files=(await readdir(dir,{withFileTypes:true})).filter(entry=>entry.isFile()&&/^licen[sc]e(?:[.-].*)?$/i.test(entry.name));
  if(!files.length)throw Error("License file missing: "+metadata.name);
  rows.push(`| ${metadata.name} | ${metadata.version} | ${metadata.license || record.license || "See notice"} |`);
  for(const file of files){
    const contents=(await readFile(path.join(dir,file.name),"utf8")).replaceAll("\r\n","\n").replace(/[ \t]+$/gm,"").trim();
    if(!groups.has(contents))groups.set(contents,[]);
    groups.get(contents).push(metadata.name+"@"+metadata.version+" / "+file.name);
  }
}
let notices="# Third-party notices\n\nOriginal plugin code uses the MIT license. Dependency packages retain the following upstream licenses. This list includes runtime dependency packages in the source dependency graph; unused portions can be omitted by the bundler.\n\n| Package | Version | Declared license |\n| --- | --- | --- |\n"+rows.sort().join("\n")+"\n";
for(const [contents,names] of groups)notices+="\n## "+names.join(", ")+"\n\n```text\n"+contents+"\n```\n";
await writeFile("THIRD_PARTY_NOTICES.md",notices);
