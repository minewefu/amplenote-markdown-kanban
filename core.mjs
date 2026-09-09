import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";

// Use the same GFM parser directly, without bundling a Markdown serializer.
const parser = { parse: source => fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }) };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class BoardError extends Error {}
const offset = node => [node.position.start.offset, node.position.end.offset];
const textOf = node => node.type === "html" ? "" : node.value ?? node.children?.map(textOf).join("") ?? "";
const newlineOf = source => source.includes("\r\n") ? "\r\n" : "\n";

function isGeneratedHeading(node) {
  if (node.type !== "heading") return false;
  return node.children.some(child => {
    if (child.type !== "html") return false;
    try { return JSON.parse(child.value.replace(/^<!--\s*/, "").replace(/\s*-->$/, "")).omit === true; }
    catch { return false; }
  });
}

function taskIdentity(item, source) {
  const paragraph = item.children.find(child => child.type === "paragraph");
  const identities = [];
  for (const child of paragraph?.children ?? []) {
    if (child.type !== "html") continue;
    const comment = child.value.match(/^<!--\s*([\s\S]*?)\s*-->$/);
    if (!comment) continue;
    let metadata;
    try { metadata = JSON.parse(comment[1]); } catch { continue; }
    if (!metadata || typeof metadata !== "object" || !Object.hasOwn(metadata, "uuid")) continue;
    if (typeof metadata.uuid !== "string" || !UUID.test(metadata.uuid)) throw new BoardError("A task has an invalid UUID. Open it in the note before moving it.");
    identities.push({ uuid: metadata.uuid, metadata, range: offset(child), raw: source.slice(...offset(child)) });
  }
  if (identities.length > 1) throw new BoardError("A task contains multiple identity comments.");
  return identities[0] ?? null;
}

/** Use parser positions only. Never serialize the tree back over the original note. */
export function parseBoard(source) {
  if (typeof source !== "string") throw new BoardError("The note did not return Markdown.");
  const tree = parser.parse(source);
  // Amplenote appends rich-footnote definitions, including unindented blocks.
  // Keep that entire suffix opaque, so headings/tasks inside a footnote are not cards.
  const firstFootnote = tree.children.find(node => node.type === "footnoteDefinition");
  const footerStart = firstFootnote?.position.start.offset ?? source.length;
  const generated = tree.children.find(isGeneratedHeading);
  const contentEnd = Math.min(footerStart, generated?.position.start.offset ?? source.length);
  const archive = source.slice(contentEnd, footerStart);
  const nodes = tree.children.filter(node => node.position.start.offset < contentEnd);
  const headings = nodes.filter(node => node.type === "heading");
  const columns = [{ id: "unassigned", title: "Unassigned", start: 0, contentStart: 0, end: headings[0]?.position.start.offset ?? contentEnd, implicit: true, cards: [] }];
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const [start, headingEnd] = offset(heading);
    columns.push({ id: `column:${start}`, title: textOf(heading).trim(), depth: heading.depth,
      start, headingEnd, contentStart: headingEnd, end: headings[i + 1]?.position.start.offset ?? contentEnd, implicit: false, cards: [],
      rawHeading: source.slice(start, headingEnd) });
  }
  const cards = [];
  const taskRecords = [];
  const recordIds = new Set();
  const collect = node => {
    if (node.type === "listItem" && typeof node.checked === "boolean") {
      const identity = taskIdentity(node, source);
      if (identity) {
        if (recordIds.has(identity.uuid)) throw new BoardError("Duplicate task UUIDs were found.");
        recordIds.add(identity.uuid);
        taskRecords.push({ ...identity, checked: node.checked });
      }
    }
    for (const child of node.children ?? []) collect(child);
  };
  for (const node of nodes) if (node.type === "list") collect(node);
  const mainTaskRecords = taskRecords.slice();
  for (const node of tree.children) {
    if (node.type === "list" && node.position.start.offset >= contentEnd && node.position.start.offset < footerStart) collect(node);
  }
  const seen = new Set();
  for (const list of nodes.filter(node => node.type === "list")) {
    for (const item of list.children) {
      if (typeof item.checked !== "boolean") continue;
      const [start, end] = offset(item);
      const identity = taskIdentity(item, source);
      const id = identity?.uuid ?? `card:${start}`;
      if (seen.has(id)) throw new BoardError("Duplicate task UUIDs were found. Refresh or fix the note before editing.");
      seen.add(id);
      const column = columns.find(column => start >= column.contentStart && start < column.end);
      if (!column) throw new BoardError("A task has no unambiguous heading location.");
      const card = { id, uuid: identity?.uuid ?? null, metadata: identity?.metadata ?? null, identity,
        start, end, raw: source.slice(start, end), checked: item.checked, columnId: column.id,
        title: textOf(item.children[0]).trim(), hasNestedList: item.children.some(child => child.type === "list") };
      column.cards.push(card);
      cards.push(card);
    }
  }
  return { source, newline: newlineOf(source), contentEnd, archive, suffix: source.slice(contentEnd), footerStart, footer: source.slice(footerStart), columns, cards, taskRecords: mainTaskRecords, allTaskRecords: taskRecords };
}

function requireColumn(board, id) {
  const column = board.columns.find(column => column.id === id);
  if (!column) throw new BoardError("This column changed. Refresh the board.");
  return column;
}
function requireCard(board, id) {
  const card = board.cards.find(card => card.id === id);
  if (!card) throw new BoardError("This card changed. Refresh the board.");
  return card;
}
export function applyEdits(source, edits) {
  let result = source, nextStart = source.length;
  for (const edit of [...edits].sort((a, b) => b.start - a.start || b.end - a.end)) {
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end) || edit.start < 0 || edit.end < edit.start || edit.end > nextStart || typeof edit.text !== "string") {
      throw new BoardError("Overlapping or invalid Markdown edits.");
    }
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    nextStart = edit.start;
  }
  return result;
}
function endOfLine(source, end) {
  if (source.slice(end, end + 2) === "\r\n") return end + 2;
  return source[end] === "\n" ? end + 1 : end;
}
function insertion(source, at, raw, newline) {
  const before = source.slice(0, at);
  const prefix = !before.length || before.endsWith(newline + newline) ? "" : before.endsWith(newline) ? newline : newline + newline;
  const after = source.slice(at);
  const suffix = after.startsWith(newline + newline) ? "" : after.startsWith(newline) ? newline : newline + newline;
  return prefix + raw.replace(/(?:\r?\n)+$/, "") + suffix;
}
function validateLimits(column, card, limit) {
  if (limit == null || limit === 0) return;
  if (!Number.isInteger(limit) || limit < 1) throw new BoardError("Column limit must be a positive whole number or zero for unlimited.");
  if (!card.checked && card.columnId !== column.id && column.cards.filter(task => !task.checked).length >= limit) throw new BoardError("The destination column has reached its open-card limit.");
}

/** Relocate an exact task block; completion is a separate native task-API operation. */
export function moveCard(source, cardId, columnId, { beforeCardId = null, limit = 0 } = {}) {
  const board = parseBoard(source), card = requireCard(board, cardId), column = requireColumn(board, columnId);
  validateLimits(column, card, limit);
  if (beforeCardId === cardId) return source;
  let before = beforeCardId == null ? null : board.cards.find(card => card.id === beforeCardId);
  if (beforeCardId && !before) {
    const archived = board.allTaskRecords.find(record => record.uuid === beforeCardId && record.metadata.completedAt != null);
    if (!(column.id === board.columns.at(-1).id && archived)) throw new BoardError("This card changed. Refresh the board.");
    // Completed cards are rendered in the final lane, but their actual storage
    // is the generated archive. A drop over one means append and complete.
    before = null;
  }
  if (before && before.columnId !== columnId) throw new BoardError("The drop position is in another column.");
  const destination = before?.start ?? column.end;
  const end = endOfLine(source, card.end);
  if (destination >= card.start && destination <= end) return source;
  const output = applyEdits(source, [
    { start: card.start, end, text: "" },
    { start: destination, end: destination, text: insertion(source, destination, card.raw, board.newline) }
  ]);
  const after = parseBoard(output);
  if (after.cards.length !== board.cards.length || after.suffix !== board.suffix) throw new BoardError("The move would change the note structure unexpectedly.");
  return output;
}

export function renameColumn(source, columnId, title) {
  if (typeof title !== "string" || !title.trim() || /[\r\n]/.test(title)) throw new BoardError("Enter a column name on one line.");
  const board = parseBoard(source), column = requireColumn(board, columnId);
  if (column.implicit) throw new BoardError("Unassigned is not a note heading.");
  // Preserve opaque heading metadata, including Amplenote's collapsed state.
  const comments = [...column.rawHeading.matchAll(/<!--[^]*?-->/g)].map(match => match[0]);
  const escaped = title.trim().replace(/[\\`*_{}\[\]<>#!|]/g, "\\$&");
  return applyEdits(source, [{ start: column.start, end: column.headingEnd,
    text: "#".repeat(column.depth) + " " + escaped + (comments.length ? " " + comments.join(" ") : "") }]);
}

export function addColumn(source, title) {
  const board = parseBoard(source), placeholder = "# New column";
  const result = applyEdits(source, [{ start: board.contentEnd, end: board.contentEnd, text: insertion(source, board.contentEnd, placeholder, board.newline) }]);
  const added = parseBoard(result).columns.at(-1);
  return renameColumn(result, added.id, title);
}

export function deleteColumn(source, columnId) {
  const board = parseBoard(source), column = requireColumn(board, columnId);
  if (column.implicit) throw new BoardError("Unassigned cannot be removed.");
  const first = board.columns[0];
  const body = source.slice(column.headingEnd, column.end).replace(/^(?:\r?\n)+/, "");
  const removed = applyEdits(source, [{ start: column.start, end: column.end, text: "" }]);
  // Preserve the removed column's prose as well as its tasks in Unassigned.
  const result = applyEdits(removed, [{ start: first.end, end: first.end, text: insertion(removed, first.end, body, board.newline) }]);
  if (parseBoard(result).cards.length !== board.cards.length) throw new BoardError("Removing this column would change its tasks.");
  return result;
}

export function reorderColumns(source, orderedIds) {
  const board = parseBoard(source), actual = board.columns.filter(column => !column.implicit);
  if (!Array.isArray(orderedIds) || orderedIds.length !== actual.length || new Set(orderedIds).size !== actual.length || orderedIds.some(id => !actual.some(column => column.id === id))) {
    throw new BoardError("Include each existing heading exactly once.");
  }
  if (actual.length < 2) return source;
  const newline = board.newline;
  const chunks = orderedIds.map(id => {
    const column = requireColumn(board, id);
    return source.slice(column.start, column.end);
  });
  // Add a separator only when moving the original end-of-file heading would
  // otherwise concatenate its last line with the following heading.
  const middle = chunks.map((chunk, index) => index < chunks.length - 1 && !chunk.endsWith(newline) ? chunk + newline + newline : chunk).join("");
  return source.slice(0, actual[0].start) + middle + (board.suffix && !middle.endsWith(newline) ? newline + newline : "") + board.suffix;
}

export function assertFresh(expected, current) {
  if (typeof expected !== "string" || expected !== current) throw new BoardError("The note changed since this board loaded. Refresh before saving.");
}

export function validateWrite(source, limit = 100000) {
  if (typeof source !== "string" || source.length > limit) throw new BoardError("This note is too large for a safe board rewrite. Edit it in the note.");
  parseBoard(source);
  return source;
}

export function columnKeys(board) {
  const occurrences = new Map();
  return board.columns.map(column => {
    if (column.implicit) return { ...column, key: "unassigned" };
    const group = JSON.stringify([column.depth, column.title]);
    const occurrence = occurrences.get(group) ?? 0;
    occurrences.set(group, occurrence + 1);
    return { ...column, key: JSON.stringify([column.depth, column.title, occurrence]) };
  });
}

export function markdownLinks(markdown) {
  const links = [];
  const visit = node => {
    if (node.type === "link") links.push({ url: node.url, text: textOf(node) });
    for (const child of node.children ?? []) visit(child);
  };
  visit(parser.parse(markdown));
  return links;
}

export function markdownImages(markdown) {
  const tree=parser.parse(markdown),definitions=new Map(),images=[];
  const definitionsIn=node=>{if(node.type==="definition")definitions.set(node.identifier,node.url);for(const child of node.children??[])definitionsIn(child);};
  definitionsIn(tree);
  const visit=node=>{
    if(node.type==="image")images.push({url:node.url,alt:node.alt||""});
    if(node.type==="imageReference"&&definitions.has(node.identifier))images.push({url:definitions.get(node.identifier),alt:node.alt||""});
    for(const child of node.children??[])visit(child);
  };
  visit(tree);
  return images;
}

/** Destination spans only; labels, titles and code examples are not rewritten. */
export function markdownLinkTargets(markdown) {
  const targets=[];
  const visit=node=>{
    if(node.type==="link"){
      const [start,end]=offset(node),raw=markdown.slice(start,end);
      let urlStart=-1;
      if(raw===node.url)urlStart=start;
      else if(raw==="<"+node.url+">")urlStart=start+1;
      else {
        const labelEnd=node.children?.at(-1)?.position.end.offset??start+1;
        const delimiter=markdown.indexOf("](",labelEnd);
        if(delimiter>=start&&delimiter<end){
          let index=delimiter+2;
          while(index<end&&/\s/.test(markdown[index]))index++;
          if(markdown[index]==="<")index++;
          if(markdown.slice(index,index+node.url.length)===node.url)urlStart=index;
        }
      }
      if(urlStart>=0)targets.push({url:node.url,start:urlStart,end:urlStart+node.url.length});
    }
    for(const child of node.children??[])visit(child);
  };
  visit(parser.parse(markdown));
  return targets;
}

export function richFootnoteData(markdown) {
  const tree=parser.parse(markdown);
  const nodes=tree.children.filter(node=>node.type==="footnoteDefinition");
  const definitions=[];
  for(let index=0;index<nodes.length;index++){
    const node=nodes[index],header=node.children[0]?.children?.find(child=>child.type==="link");
    if(!header)continue;
    const end=nodes[index+1]?.position.start.offset??markdown.length;
    const lineEnd=markdown.indexOf("\n",header.position.end.offset);
    const bodyStart=lineEnd>=0&&lineEnd<end?lineEnd+1:end;
    const body=markdown.slice(bodyStart,end).replace(/^(?: {4}|\t)/gm,"").replace(/^(?:[ \t]*\r?\n)+/,"").replace(/(?:\r?\n[ \t]*)+$/,"");
    definitions.push({id:node.identifier,label:textOf(header),href:header.url,markdown:body,hasContent:!!body.trim(),raw:markdown.slice(node.position.start.offset,end)});
  }
  const byId=new Map(definitions.map(definition=>[definition.id,definition]));
  const referenceLabel=(node,fallback)=>{
    const end=node.position.start.offset;
    if(markdown[end-1]!=="]")return fallback;
    let depth=0;
    for(let index=end-1;index>=Math.max(0,end-1000);index--){
      let slashes=0;for(let back=index-1;back>=0&&markdown[back]==="\\";back--)slashes++;
      if(slashes%2)continue;
      if(markdown[index]==="]")depth++;
      if(markdown[index]==="["&&--depth===0){
        const parsed=parser.parse(markdown.slice(index,end)+"(https://example.invalid)");
        const link=parsed.children[0]?.children?.find(child=>child.type==="link");
        return link?textOf(link):fallback;
      }
    }
    return fallback;
  };
  const links=[],footerStart=nodes[0]?.position.start.offset??markdown.length;
  const visit=node=>{
    if(node.position?.start.offset>=footerStart)return;
    if(node.type==="link")links.push({label:textOf(node),href:node.url,footnoteId:null,hasContent:false});
    if(node.type==="footnoteReference"){
      const definition=byId.get(node.identifier);
      if(definition)links.push({label:referenceLabel(node,definition.label),href:definition.href,footnoteId:definition.id,hasContent:definition.hasContent});
    }
    for(const child of node.children??[])visit(child);
  };
  visit(tree);
  return {definitions,links};
}

export function noteLinkUuid(url) {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== "https://www.amplenote.com") return null;
    const match = parsed.pathname.match(/^\/notes\/([^/]+)\/?$/);
    return match && UUID.test(match[1].startsWith("local-") ? match[1].slice(6) : match[1]) ? match[1] : null;
  } catch { return null; }
}
