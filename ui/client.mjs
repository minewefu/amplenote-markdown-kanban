import DOMPurify from "dompurify";
import { mountPreview } from "./preview-client.mjs";

if (document.getElementById("preview-state")) {
  mountPreview();
} else {
let state = JSON.parse(document.getElementById("board-state").textContent);
let saving = false;
const root = document.getElementById("board");
const status = document.getElementById("status");
const errors = document.getElementById("error");
const editor = document.getElementById("editor");
const columnDialog = document.getElementById("column-editor");
const search = document.getElementById("search");
const byId = id => document.getElementById(id);
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function button(label, action, className = "button") {
  const node = element("button", className, label);
  node.type = "button";
  node.dataset.write = "";
  node.addEventListener("click", () => Promise.resolve(action()).catch(showError));
  return node;
}
function showError(error) {
  errors.hidden = false;
  errors.textContent = error?.message ?? String(error);
  const openDialog=document.querySelector("dialog[open]");
  if(openDialog){let message=openDialog.querySelector(".dialog-error");if(!message){message=element("p","notice error dialog-error");message.setAttribute("role","alert");openDialog.append(message);}message.textContent=errors.textContent;}
}
function dateText(seconds) {
  if (seconds == null) return "";
  const date = new Date(seconds * 1000);
  if (state.settings?.dateFormat === "iso") return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
  if (state.settings?.dateFormat === "relative") {
    const days = Math.round((date.setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / 86400000);
    return new Intl.RelativeTimeFormat(undefined,{numeric:"auto"}).format(days,"day");
  }
  return date.toLocaleDateString(undefined, {month:"short",day:"numeric",year:date.getFullYear()===new Date().getFullYear()?undefined:"numeric"});
}
function localInputDate(seconds) {
  if (seconds == null) return "";
  const d = new Date(seconds * 1000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,16);
}
async function call(action, args = {}, { update = true } = {}) {
  if (saving) throw Error("A save is already running.");
  saving = true;
  errors.hidden = true;
  document.querySelectorAll(".dialog-error").forEach(node=>node.remove());
  status.textContent = action === "refresh" ? "Refreshing…" : "Saving…";
  document.querySelectorAll("[data-write]").forEach(node=>node.disabled=true);
  try {
    const result = await window.callAmplenotePlugin(action, {noteUUID:state.note.uuid,expected:state.source,...args});
    if (!result?.ok) {
      if (result?.createdTaskId) { byId("card-id").value=result.createdTaskId; byId("editor-title").textContent="Edit card"; }
      if (result?.data && update) { state = result.data; render(); }
      else if(result?.pending && update){state.pending=result.pending;render();}
      throw Error(result?.message || "The action could not be completed.");
    }
    if (result.changed && update) {
      if(result.createdTaskId){byId("card-id").value=result.createdTaskId;byId("editor-title").textContent="Edit card";}
      // A write acknowledgment and a board refresh are separate host calls.
      // Rendering failure must not turn a confirmed save into a duplicate retry.
      try {
        const refreshed=await window.callAmplenotePlugin("refresh",{noteUUID:state.note.uuid});
        if(!refreshed?.ok || !refreshed.data)throw Error(refreshed?.message || "The refreshed board was unavailable.");
        state=refreshed.data;render();
      } catch(error) {
        state.loading=true;
        showError("Saved. The board could not refresh yet; use Refresh before making another change. "+(error?.message??String(error)));
      }
    }
    if (result.data && update) { state = result.data; render(); }
    return result;
  } finally {
    saving = false;
    status.textContent = state.loading ? "Saved — refresh needed" : state.pending ? "Save needs review" : "Up to date";
    document.querySelectorAll("[data-write]").forEach(node=>node.disabled=!!state.loading && node.id!=="refresh");
  }
}
function showTaskEditor(card, column) {
  byId("editor-title").textContent = card ? "Edit card" : "New card";
  byId("card-id").value = card?.uuid ?? "";
  byId("card-column").value = column?.id ?? card?.columnId ?? "unassigned";
  byId("card-markdown").value = card?.content ?? "";
  byId("card-start").value = localInputDate(card?.startAt);
  byId("card-extras").hidden = !card;
  editor.showModal();
  byId("card-markdown").focus();
}
function showColumnEditor(column) {
  byId("column-id").value = column?.id ?? "";
  byId("column-title").value = column?.title ?? "";
  byId("column-limit").value = column?.limit ?? 0;
  byId("remove-column").hidden = !column;
  byId("confirm-removal").hidden = true;
  columnDialog.showModal();
  byId("column-title").focus();
}
function cardNode(card, column) {
  const cardElement = element("article", "card" + (card.completedAt != null ? " completed" : ""));
  cardElement.dataset.card = card.uuid;
  cardElement.tabIndex = 0;
  cardElement.setAttribute("aria-label", card.title || "Task card");
  cardElement.draggable = true;
  cardElement.addEventListener("dragstart", event => {
    event.dataTransfer.setData("application/x-kanban-card", card.uuid);
    event.dataTransfer.effectAllowed = "move";
    cardElement.classList.add("dragging");
  });
  cardElement.addEventListener("dragend", () => cardElement.classList.remove("dragging"));
  cardElement.addEventListener("keydown", event => { if (event.target === cardElement && event.key === "Enter") showTaskEditor(card); });
  const content = element("div", "card-content");
  content.innerHTML = DOMPurify.sanitize(card.html || "", {USE_PROFILES:{html:true},ADD_ATTR:["description","data-href"],FORBID_TAGS:["input","button","textarea","select","style","form"]});
  const images = [...content.querySelectorAll("img")];
  if (images.length) {
    const preview = images[0].cloneNode(true);
    preview.className = "card-preview";
    preview.loading = "lazy";
    cardElement.append(preview);
    images.forEach(image=>image.remove());
  }
  content.addEventListener("click", event => {
    const link = event.target.closest("a");
    if (link) {
      if (link.getAttribute("description")) {
        event.preventDefault();
        call("richFootnote", {description:link.getAttribute("description"),href:link.getAttribute("data-href") || link.getAttribute("href"),label:link.textContent},{update:false}).catch(showError);
      } else if (link.href.startsWith("https://www.amplenote.com/notes/")) {
        event.preventDefault();
        call("peekNote",{url:link.href},{update:false}).catch(showError);
      }
    } else showTaskEditor(card);
  });
  cardElement.append(content);
  const meta = element("div", "card-meta");
  if (card.label) {
    const label = button(card.label.name,()=>call("peekNote",{url:card.label.url},{update:false}),"note-label");
    if (/^#[a-f0-9]{6}$/i.test(card.label.color || "")) label.style.setProperty("--label-color",card.label.color);
    meta.append(label);
  }
  if (card.startAt != null) meta.append(element("span","date","◷ " + dateText(card.startAt)));
  if (card.hideUntil) meta.append(element("span","hidden-badge","Hidden until " + dateText(card.hideUntil)));
  if (card.childCount) meta.append(element("span","subtasks",`${card.childCount} subtask${card.childCount===1?"":"s"} · move together`));
  cardElement.append(meta);
  const controls = element("div","card-controls");
  const move = element("select","move-select");
  move.setAttribute("aria-label",`Move ${card.title || "card"} to`);
  move.dataset.write = "";
  move.append(new Option("Move to…", ""));
  for (const target of state.columns) move.append(new Option(target.title,target.id));
  move.addEventListener("change",()=>{ const target=move.value; if(target) call("move",{cardId:card.uuid,columnId:target}).catch(showError); move.value=""; });
  controls.append(move,button("Edit",()=>showTaskEditor(card),"quiet"),button(card.completedAt != null ? "Reopen" : "Complete",()=>call(card.completedAt != null ? "reopen" : "complete",{cardId:card.uuid}),"quiet complete-button"));
  cardElement.append(controls);
  return cardElement;
}
function render() {
  byId("board-title").textContent = state.note.name || "Untitled board";
  byId("source-link").href = `https://www.amplenote.com/notes/${state.note.uuid}`;
  byId("date-format").value = state.settings?.dateFormat || "locale";
  const pending = byId("pending");
  pending.hidden = !state.pending;
  byId("acknowledge").hidden = state.pending?.phase !== "restored-needs-review";
  root.replaceChildren();
  const query = search.value.trim().toLocaleLowerCase();
  let shown = 0, total = 0;
  for (let index=0;index<state.columns.length;index++) {
    const column = state.columns[index];
    const lane = element("section","lane" + (column.implicit ? " unassigned" : ""));
    lane.dataset.column=column.id;
    lane.setAttribute("aria-label",column.title);
    const head = element("header","lane-header");
    const title = element("h2","",column.title);
    const open = column.cards.filter(card=>card.completedAt == null).length;
    const count = element("span","count" + (column.limit && open>=column.limit ? " at-limit" : ""),column.limit?`${open}/${column.limit}`:String(column.cards.length));
    head.append(title,count);
    if (!column.implicit) {
      head.append(button("•••",()=>showColumnEditor(column),"lane-menu"));
      head.lastChild.setAttribute("aria-label",`Settings for ${column.title}`);
    }
    lane.append(head);
    if (index === state.columns.length-1 && !column.implicit) lane.append(element("p","lane-hint","Drop here to complete"));
    const stack = element("div","card-stack");
    for (const card of column.cards) {
      total++;
      if (query && !(card.title+" "+card.content+" "+(card.label?.name||"")).toLocaleLowerCase().includes(query)) continue;
      stack.append(cardNode(card,column)); shown++;
    }
    if (!stack.childElementCount) stack.append(element("p","empty-lane",query?"No matching cards":"No cards yet"));
    lane.append(stack,button("+ Add card",()=>showTaskEditor(null,column),"add-card"));
    if (!column.implicit) {
      const order = element("div","column-order");
      if(index>1) order.append(button("← Move left",()=>call("reorderColumn",{columnId:column.id,direction:-1}),"quiet"));
      if(index<state.columns.length-1) order.append(button("Move right →",()=>call("reorderColumn",{columnId:column.id,direction:1}),"quiet"));
      lane.append(order);
    }
    lane.addEventListener("dragover",event=>{ if(event.dataTransfer.types.includes("application/x-kanban-card")){event.preventDefault();event.dataTransfer.dropEffect="move";lane.classList.add("drop-target");} });
    lane.addEventListener("dragleave",event=>{if(!lane.contains(event.relatedTarget))lane.classList.remove("drop-target");});
    lane.addEventListener("drop",event=>{
      const cardId=event.dataTransfer.getData("application/x-kanban-card");
      lane.classList.remove("drop-target");
      if(!cardId)return;
      event.preventDefault();
      const beforeCardId=event.target.closest("[data-card]")?.dataset.card ?? null;
      call("move",{cardId,columnId:column.id,beforeCardId}).catch(showError);
    });
    root.append(lane);
  }
  byId("card-count").textContent=query?`${shown} of ${total} cards`:`${total} card${total===1?"":"s"}`;
  status.textContent=state.pending?"Save needs review":"Up to date";
}
search.addEventListener("input",render);
byId("refresh").addEventListener("click",()=>call("refresh").catch(showError));
byId("add-column").addEventListener("click",()=>showColumnEditor(null));
byId("date-format").addEventListener("change",event=>call("settings",{dateFormat:event.target.value}).catch(showError));
byId("restore").addEventListener("click",()=>call("recover").catch(showError));
byId("acknowledge").addEventListener("click",()=>call("acknowledgeRecovery").catch(showError));
document.querySelectorAll("[data-close]").forEach(node=>node.addEventListener("click",()=>node.closest("dialog").close()));
byId("save-card").addEventListener("click",event=>{
  event.preventDefault();
  const start = byId("card-start").value;
  call(byId("card-id").value?"edit":"add",{cardId:byId("card-id").value,columnId:byId("card-column").value,content:byId("card-markdown").value,startAt:start?Math.floor(new Date(start).getTime()/1000):null}).then(()=>editor.close()).catch(showError);
});
byId("link-note").addEventListener("click",()=>call("labelCard",{cardId:byId("card-id").value}).then(result=>{if(!result.cancelled)editor.close();}).catch(showError));
byId("create-note").addEventListener("click",()=>call("noteFromCard",{cardId:byId("card-id").value}).then(result=>{if(!result.cancelled)editor.close();}).catch(showError));
byId("save-column").addEventListener("click",event=>{
  event.preventDefault();
  call(byId("column-id").value?"editColumn":"addColumn",{columnId:byId("column-id").value,title:byId("column-title").value,limit:Number(byId("column-limit").value)}).then(()=>columnDialog.close()).catch(showError);
});
byId("remove-column").addEventListener("click",()=>{byId("confirm-removal").hidden=false;});
byId("keep-column").addEventListener("click",()=>{byId("confirm-removal").hidden=true;});
byId("confirm-remove-column").addEventListener("click",()=>call("deleteColumn",{columnId:byId("column-id").value}).then(()=>columnDialog.close()).catch(showError));
byId("card-markdown").addEventListener("keydown",event=>{if(event.key==="Enter"&&(event.ctrlKey||event.metaKey)){event.preventDefault();byId("save-card").click();}});
byId("column-title").addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();byId("save-column").click();}});
render();
}
