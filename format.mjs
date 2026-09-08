import { markdownLinks, noteLinkUuid, parseBoard } from "./core.mjs";
export const escapeHtml = text => String(text ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
export const escapeMarkdown = text => String(text).replace(/[\\`*_{}\[\]<>#!|]/g,"\\$&");
export const encodeState = value => JSON.stringify(value).replace(/</g,"\\u003c").replace(/\u2028/g,"\\u2028").replace(/\u2029/g,"\\u2029");
export function appendNoteLink(content, name, noteIdOrUrl) {
  const url = String(noteIdOrUrl).includes("://") ? String(noteIdOrUrl) : `https://www.amplenote.com/notes/${noteIdOrUrl}`;
  const uuid=noteLinkUuid(url);
  if (!uuid) throw Error("The selected note URL is invalid.");
  if (markdownLinks(content).some(link => noteLinkUuid(link.url) === uuid)) return content;
  const footerStart = parseBoard(content).footerStart;
  return content.slice(0,footerStart).trimEnd() + ` [${escapeMarkdown(name || "Untitled note")}](${url})` + (footerStart < content.length ? "\n\n" + content.slice(footerStart) : "");
}
function safeUrl(value, image = false) {
  try {
    const url = new URL(String(value));
    if (["http:","https:"].includes(url.protocol) || !image && url.protocol === "mailto:") return url.href;
  } catch {}
  return "";
}
export function renderRichDescription(description) {
  const input = typeof description === "string" ? JSON.parse(description) : description;
  if (!Array.isArray(input)) throw Error("This rich footnote has an unsupported format.");
  let visited = 0;
  const render = (node, depth = 0) => {
    if (!node || ++visited > 5000 || depth > 32) throw Error("This rich footnote is too complex to display.");
    let content = node.type === "text" ? escapeHtml(node.text) : (node.content || []).map(child => render(child,depth+1)).join("");
    for (const mark of node.marks || []) {
      const tag = {strong:"strong",em:"em",strike:"s",code:"code",highlight:"mark"}[mark.type];
      if (tag) content = `<${tag}>${content}</${tag}>`;
    }
    if (node.type === "link") {
      const href = safeUrl(node.attrs?.href);
      return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${content}</a>` : content;
    }
    if (node.type === "image") {
      const src = safeUrl(node.attrs?.src || node.attrs?.url,true);
      return src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(node.attrs?.alt || "")}">` : "";
    }
    if (node.type === "hard_break") return "<br>";
    const tag = {paragraph:"p",blockquote:"blockquote",bullet_list:"ul",ordered_list:"ol",list_item:"li",code_block:"pre"}[node.type];
    return tag ? `<${tag}>${content}</${tag}>` : content;
  };
  return input.map(node => render(node)).join("");
}

export function firstTagColor(note, tags) {
  const color = tags.find(tag => tag.text === note.tags?.[0])?.color;
  return typeof color === "string" && /^[a-f0-9]{6}$/i.test(color) ? "#" + color : null;
}

export function imageUrl(url) {
  try { const parsed=new URL(String(url)); return ["https:","http:"].includes(parsed.protocol)?parsed.href:null; }
  catch { return null; }
}
