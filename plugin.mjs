import * as Core from "./core.mjs";
import { createBoardService } from "./service.mjs";
import { appendNoteLink, encodeState, firstTagColor, imageUrl, renderRichDescription } from "./format.mjs";
import { renderPage } from "./dist/ui-template.mjs";

const configKey = uuid => `kanban.board.${uuid}`;
const validLimit = number => Number.isInteger(number) && number >= 0 && number <= 9999;
export function createPlugin() {
  const service = createBoardService(), configurations = new Map(), busy = new Set();
  const config = (app, uuid) => {
    if (configurations.has(uuid)) return configurations.get(uuid);
    let value;
    try { value = JSON.parse(app.settings?.[configKey(uuid)] || "{}"); } catch { throw Error("Board settings could not be read."); }
    if (!value || typeof value!=="object" || Array.isArray(value)) value={};
    const limits={};
    for(const [key,limit] of Object.entries(value.limits || {}))if(validLimit(limit))limits[key]=limit;
    return {dateFormat:["locale","iso","relative","custom"].includes(value.dateFormat)?value.dateFormat:"locale",datePattern:typeof value.datePattern==="string"&&value.datePattern.length<=80?value.datePattern:"YYYY-MM-DD",limits};
  };
  const saveConfig = async (app, uuid, value) => {
    await app.setSetting(configKey(uuid), JSON.stringify(value));
    configurations.set(uuid,value);
  };
  async function view(app, uuid) {
    const snapshot = await service.snapshot(app,uuid), options = config(app,snapshot.note.uuid);
    const columns = Core.columnKeys(snapshot.board).map(column => ({id:column.id,key:column.key,title:column.title,implicit:column.implicit,limit:options.limits[column.key] || 0,cards:[]}));
    if (columns.length === 1) columns.push({id:"completed",key:"completed",title:"Completed",implicit:true,virtual:true,limit:0,cards:[]});
    const tags = await app.getTags(), notes = new Map();
    const taskIndex = new Map(snapshot.tasks.map(task => [task.uuid,task]));
    const entries = snapshot.board.cards.map(card => ({card,task:taskIndex.get(card.uuid),column:columns.find(column=>column.id===card.columnId)}));
    for (const task of snapshot.tasks) if (task.completedAt != null && !entries.some(entry=>entry.task?.uuid===task.uuid)) entries.push({card:{title:task.content.split("\n")[0]},task,column:columns.at(-1)});
    for (let start=0;start<entries.length;start+=4) await Promise.all(entries.slice(start,start+4).map(async ({card,task,column}) => {
      if (!task || !column) throw Error("A card does not have a matching native task. Refresh the note.");
      let label = null;
      const link = Core.markdownLinks(task.content).find(link=>Core.noteLinkUuid(link.url));
      if (link) {
        const linkedUUID = Core.noteLinkUuid(link.url);
        if (!notes.has(linkedUUID)) notes.set(linkedUUID, app.notes.find(linkedUUID));
        const linked = await notes.get(linkedUUID);
        if (linked) label = {name:linked.name || "Untitled note",url:`https://www.amplenote.com/notes/${linked.uuid}`,color:firstTagColor(linked,tags)};
      }
      const childCount = card.start == null ? 0 : snapshot.board.taskRecords.filter(record=>record.range[0]>card.start && record.range[1]<=card.end).length-1;
      const firstImage=Core.markdownImages(task.content).find(image=>imageUrl(image.url));
      column.cards.push({uuid:task.uuid,title:card.title,content:task.content,html:await app.htmlFromContent(task.content),columnId:column.id,startAt:task.startAt??null,hideUntil:task.hideUntil??null,completedAt:task.completedAt??null,label,image:firstImage?{url:imageUrl(firstImage.url),alt:firstImage.alt}:null,childCount:Math.max(0,childCount),_order:entries.findIndex(entry=>entry.task?.uuid===task.uuid)});
    }));
    for (const column of columns) { column.cards.sort((a,b)=>a._order-b._order); for(const card of column.cards)delete card._order; }
    return {note:snapshot.note,source:snapshot.source,columns,settings:options,pending:snapshot.pending};
  }
  async function open(app, uuid) {
    await app.openEmbed("board",uuid);
    await app.navigate("https://www.amplenote.com/notes/plugins/"+app.context.pluginUUID);
  }
  const targetColumn = (snapshot,id) => {
    const column = Core.columnKeys(snapshot.board).find(column=>column.id===id);
    if (!column) throw Error("The column changed. Refresh the board.");
    return column;
  };
  const nativeTask = async (app, uuid, taskId) => {
    const task = await app.getTask(taskId);
    if (!task || task.noteUUID!==uuid) throw Error("This task no longer belongs to the board.");
    return task;
  };
  const updateTask = async (app, taskId, updates) => { if(await app.updateTask(taskId,updates)!==true)throw Error("Amplenote could not update the task."); };
  async function move(app, uuid, snapshot, taskId, columnId, beforeCardId) {
    const completedTarget = columnId==="completed";
    const initialTarget = completedTarget?null:targetColumn(snapshot,columnId);
    let task = await nativeTask(app,uuid,taskId);
    const finalColumn=completedTarget || !initialTarget.implicit && initialTarget.id===snapshot.board.columns.at(-1).id;
    if(task.completedAt!=null && finalColumn)return;
    if (completedTarget) { await updateTask(app,taskId,{completedAt:Math.floor(Date.now()/1000)}); return; }
    if (task.completedAt!=null) {
      await updateTask(app,taskId,{completedAt:null});
      snapshot=await service.snapshot(app,uuid);
    }
    const column = Core.columnKeys(snapshot.board).find(column=>column.key===initialTarget.key);
    if (!column) throw Error("The destination heading changed while the task reopened.");
    const limit=config(app,uuid).limits[column.key] || 0;
    await service.rewrite(app,uuid,snapshot.source,markdown=>Core.moveCard(markdown,taskId,column.id,{beforeCardId,limit}));
    if (!column.implicit && column.id===snapshot.board.columns.at(-1).id) await updateTask(app,taskId,{completedAt:Math.floor(Date.now()/1000)});
  }
  async function dispatch(app, action, request) {
    const uuid=request.noteUUID;
    if(action==="refresh")return {data:await view(app,uuid)};
    if(action==="recover"){const result=await service.recover(app,uuid);if(!result.restored)throw Error("Some task dates still need restoration. Review the pending save before editing.");return {changed:true};}
    if(action==="acknowledgeRecovery"){await service.acknowledgeRecovery(app,uuid);return {changed:true};}
    if(action==="openLink") {
      const url=new URL(String(request.url));
      if(!["https:","http:","mailto:"].includes(url.protocol))throw Error("This link uses an unsupported protocol.");
      if(await app.navigate(url.href)!==true)throw Error("Amplenote could not open this URL.");
      return {opened:true};
    }
    if(action==="peekNote") {
      const linkedUUID=Core.noteLinkUuid(request.url);
      if(!linkedUUID)throw Error("This link is not an Amplenote note.");
      const opened=await app.openSidebarEmbed({aspectRatio:0.8,id:"kanban-note-preview"},"peek",linkedUUID);
      if(!opened)await app.navigate(request.url);
      return {opened:true};
    }
    if(action==="richFootnote") {
      const html=renderRichDescription(request.description);
      const opened=await app.openSidebarEmbed({aspectRatio:0.8,id:"kanban-footnote"},"rich",uuid,{html,title:request.label,href:request.href});
      if(!opened)throw Error("Open this rich footnote from the source note on mobile.");
      return {opened:true};
    }
    let snapshot=await service.snapshot(app,uuid);
    Core.assertFresh(request.expected,snapshot.source);
    if(snapshot.pending)throw Error("Restore and review the interrupted save before editing.");
    let createdTaskId=null;
    if(action==="settings") {
      if(!["locale","iso","relative","custom"].includes(request.dateFormat))throw Error("Choose a supported date format.");
      if(request.dateFormat==="custom"&&(typeof request.datePattern!=="string"||!request.datePattern.trim()||request.datePattern.length>80))throw Error("Enter a date pattern of 1 to 80 characters.");
      await saveConfig(app,uuid,{...config(app,uuid),dateFormat:request.dateFormat,...(request.dateFormat==="custom"?{datePattern:request.datePattern}: {})});
    } else if(action==="move") {
      await move(app,uuid,snapshot,request.cardId,request.columnId,request.beforeCardId||null);
    } else if(action==="complete" || action==="reopen") {
      const task=await nativeTask(app,uuid,request.cardId);
      if(action==="complete" && task.completedAt==null || action==="reopen" && task.completedAt!=null)await updateTask(app,request.cardId,{completedAt:action==="complete"?Math.floor(Date.now()/1000):null});
    } else if(action==="edit") {
      await nativeTask(app,uuid,request.cardId);
      if(typeof request.content!=="string" || !request.content.trim() || request.content.length>100000)throw Error("Enter card Markdown within the supported size limit.");
      if(request.startAt!==null && !Number.isSafeInteger(request.startAt))throw Error("Choose a valid start date.");
      await updateTask(app,request.cardId,{content:request.content,startAt:request.startAt});
    } else if(action==="add") {
      const key=request.columnId==="completed"?"completed":targetColumn(snapshot,request.columnId).key;
      if(typeof request.content!=="string" || !request.content.trim() || request.content.length>100000)throw Error("Enter card Markdown within the supported size limit.");
      if(request.startAt!==null && !Number.isSafeInteger(request.startAt))throw Error("Choose a valid start date.");
      const limit=config(app,uuid).limits[key] || 0;
      const target=snapshot.board.columns.find(column=>column.id===request.columnId);
      if(limit && target?.cards.filter(card=>!card.checked).length>=limit)throw Error("This column has reached its open-card limit.");
      const taskId=await app.insertTask({uuid},{content:request.content,startAt:request.startAt});
      createdTaskId=taskId;
      try {
        snapshot=await service.snapshot(app,uuid);
        const column=Core.columnKeys(snapshot.board).find(column=>column.key===key);
        await move(app,uuid,snapshot,taskId,key==="completed"?"completed":column.id,null);
      } catch(error){const failure=Error("The card was created, but its placement needs review. Refresh and move the existing card. "+(error?.message??String(error)));failure.createdTaskId=taskId;throw failure;}
    } else if(["addColumn","editColumn","deleteColumn","reorderColumn"].includes(action)) {
      const options={...config(app,uuid),limits:{...config(app,uuid).limits}};
      const columns=Core.columnKeys(snapshot.board);
      const column=action==="addColumn"?null:targetColumn(snapshot,request.columnId);
      if(["addColumn","editColumn"].includes(action) && !validLimit(request.limit))throw Error("Use a whole-number column limit from 0 to 9999.");
      const index=column?columns.findIndex(item=>item.id===column.id):-1;
      const after=await service.rewrite(app,uuid,snapshot.source,markdown=>{
        if(action==="addColumn")return Core.addColumn(markdown,request.title);
        if(action==="editColumn")return Core.renameColumn(markdown,column.id,request.title);
        if(action==="deleteColumn")return Core.deleteColumn(markdown,column.id);
        if(![-1,1].includes(request.direction) || index+request.direction<1 || index+request.direction>=columns.length)throw Error("The column cannot move farther in that direction.");
        const ids=columns.slice(1).map(item=>item.id),from=index-1,to=from+request.direction;
        [ids[from],ids[to]]=[ids[to],ids[from]];
        return Core.reorderColumns(markdown,ids);
      });
      if(column && action!=="reorderColumn")delete options.limits[column.key];
      if(action==="addColumn")options.limits[Core.columnKeys(after.board).at(-1).key]=request.limit;
      if(action==="editColumn")options.limits[Core.columnKeys(after.board)[index].key]=request.limit;
      await saveConfig(app,uuid,options);
    } else if(action==="labelCard" || action==="noteFromCard") {
      const task=await nativeTask(app,uuid,request.cardId);
      let note;
      if(action==="labelCard") {
        const answer=await app.prompt("Link a note to this card",{inputs:[{type:"note",label:"Note"}]});
        if(!answer)return {cancelled:true};
        note=await app.notes.find(Array.isArray(answer)?answer[0]:answer);
      } else {
        const name=await app.prompt("Name for the note",{inputs:[{type:"text",label:"Name",value:task.content.split("\n")[0].slice(0,100)}]});
        if(!name)return {cancelled:true};
        const title=Array.isArray(name)?name[0]:name;
        Core.assertFresh(request.expected,await app.getNoteContent({uuid}));
        note=await app.notes.create(String(title),[]);
        await app.replaceNoteContent({uuid:note.uuid},task.content);
        note=await app.notes.find(note.uuid);
      }
      if(!note)throw Error("The selected note is unavailable.");
      Core.assertFresh(request.expected,await app.getNoteContent({uuid}));
      const noteURL=await app.getNoteURL({uuid:note.uuid});
      await updateTask(app,request.cardId,{content:appendNoteLink(task.content,note.name,noteURL)});
    } else throw Error("Unknown board action.");
    return {changed:true,createdTaskId};
  }
  return {
    noteOption:{"Open Kanban":async function(app,uuid){await open(app,uuid);}},
    appOption:{
      "Open a Kanban note":async function(app){const answer=await app.prompt("Open a note as a Kanban board",{inputs:[{type:"note",label:"Note"}]});if(answer){const note=await app.notes.find(Array.isArray(answer)?answer[0]:answer);if(note)await open(app,note.uuid);}},
      "Create a Kanban board":async function(app){const name=await app.prompt("Board name");if(name){const uuid=await app.createNote(String(name));await app.replaceNoteContent({uuid},"# Backlog\n\n# Doing\n\n# Done\n");await open(app,uuid);}}
    },
    async renderEmbed(app,mode="board",uuid=app.context.noteUUID,details={}) {
      if(mode==="peek") {
        const note=await app.notes.find(uuid);
        if(!note)throw Error("The linked note is unavailable.");
        const data={title:note.name,html:await app.htmlFromContent(await app.getNoteContent({uuid:note.uuid})),href:`https://www.amplenote.com/notes/${note.uuid}`,noteUUID:note.uuid};
        return renderPage("preview",encodeState(data));
      }
      if(mode==="rich")return renderPage("preview",encodeState({...details,noteUUID:uuid}));
      const data=await view(app,uuid);
      return renderPage("board",encodeState(data));
    },
    async onEmbedCall(app,action,request) {
      let uuid=request?.noteUUID;
      let authorized=false;
      try {
        const embedUUID=app.context.embedArgs?.[1] || app.context.noteUUID;
        const embedded=await app.notes.find(embedUUID);
        if(typeof uuid!=="string")throw Error("This command does not identify a note.");
        const requested=await app.notes.find(uuid);
        if(!embedded || !requested || embedded.uuid!==requested.uuid)throw Error("This command does not match the open board.");
        uuid=embedded.uuid;
        request={...request,noteUUID:uuid};
        authorized=true;
        if(busy.has(uuid))throw Error("A command for this board is already running.");
        busy.add(uuid);
        try{return {ok:true,...await dispatch(app,action,request)};}finally{busy.delete(uuid);}
      } catch(error) {
        let pending=null,data=null;
        if(authorized){try{pending=service.pending(app,uuid);}catch{}if(error?.createdTaskId){try{data=await view(app,uuid);}catch{}}}
        return {ok:false,message:error?.message??String(error),pending,data,createdTaskId:authorized?error?.createdTaskId??null:null};
      }
    }
  };
}
