import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createPlugin } from "../plugin.mjs";

const uuid="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",taskId="11111111-1111-4111-8111-111111111111",pluginId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function host({completed=false,heading=true,sourceSuffix=""}={}) {
  const task={uuid:taskId,noteUUID:uuid,createdAt:100,content:"Card & detail",hideUntil:null,startAt:null,...(completed?{completedAt:500}:{})};
  let source=(heading?'# Backlog\n\n# Done\n\n':'')+(completed?'# Completed tasks<!-- {"omit":true} -->\n\n':'')+`- [${completed?'x':' '}] Card & detail<!-- ${JSON.stringify(task)} -->\n`+sourceSuffix;
  const calls=[],settings={};
  const app={calls,settings,context:{pluginUUID:pluginId,embedArgs:["board",uuid]},
    notes:{find:async input=>({uuid:typeof input==='string'?input:input.uuid,name:'A </script> board',tags:[]})},
    getNoteContent:async()=>source,
    getNoteTasks:async()=>[structuredClone(task)],getTask:async()=>structuredClone(task),getTags:async()=>[],
    htmlFromContent:async content=>'<p>'+content.replaceAll('&','&amp;').replaceAll('<','&lt;')+'</p>',
    updateTask:async(id,updates)=>{calls.push(['updateTask',id,updates]);Object.assign(task,updates);return true;},
    setSetting:async(key,val)=>{calls.push(['setSetting',key,val]);settings[key]=val;},
    openEmbed:async(...args)=>calls.push(['openEmbed',...args]),navigate:async url=>calls.push(['navigate',url]),
    openSidebarEmbed:async(...args)=>{calls.push(['sidebar',...args]);return true;},
    source:()=>source,change:()=>{source+='\nExternal edit';}
  };
  return app;
}
function pageState(html){return JSON.parse(html.match(/<script id="board-state" type="application\/json">([\s\S]*?)<\/script>/)[1]);}
test("note action opens the selected note in a full-screen plugin section",async()=>{
  const app=host();await createPlugin().noteOption["Open Kanban"](app,uuid);
  assert.deepEqual(app.calls,[['openEmbed','board',uuid],['navigate','https://www.amplenote.com/notes/plugins/'+pluginId]]);
});
test("board rendering preserves the title as inert JSON and maps tasks to headings",async()=>{
  const app=host(),html=await createPlugin().renderEmbed(app,'board',uuid),state=pageState(html);
  assert.equal(state.note.name,'A </script> board');
  assert.ok(!html.includes('A </script> board'));
  assert.equal(state.columns.at(-1).cards[0].uuid,taskId);
  assert.equal(state.columns.at(-1).cards[0].content,'Card & detail');
});
test("completed tasks appear in the final column without exposing a generated heading",async()=>{
  const app=host({completed:true});const state=pageState(await createPlugin().renderEmbed(app,'board',uuid));
  assert.deepEqual(state.columns.map(c=>c.title),['Unassigned','Backlog','Done']);
  assert.equal(state.columns.at(-1).cards[0].completedAt,500);
});
test("a note without headings gets an explicit completed archive lane",async()=>{
  const app=host({completed:true,heading:false});const state=pageState(await createPlugin().renderEmbed(app,'board',uuid));
  assert.deepEqual(state.columns.map(c=>c.title),['Unassigned','Completed']);
  assert.equal(state.columns.at(-1).cards[0].uuid,taskId);
});
test("repeated completion and moves within Done do not resubmit completion",async()=>{
  const app=host({completed:true}),plugin=createPlugin(),data=pageState(await plugin.renderEmbed(app,'board',uuid));
  for(const action of ['complete','move']){
    const result=await plugin.onEmbedCall(app,action,{noteUUID:uuid,expected:app.source(),cardId:taskId,columnId:data.columns.at(-1).id});
    assert.equal(result.ok,true,result.message);
  }
  assert.equal(app.calls.filter(call=>call[0]==='updateTask').length,0);
});
test("commands cannot target a different note than the current embed",async()=>{
  const app=host();const result=await createPlugin().onEmbedCall(app,'complete',{noteUUID:pluginId,expected:app.source(),cardId:taskId});
  assert.equal(result.ok,false);assert.match(result.message,/open board/);assert.equal(app.calls.length,0);
});
test("a stale editor save is rejected before native task updates",async()=>{
  const app=host(),expected=app.source();app.change();
  const result=await createPlugin().onEmbedCall(app,'edit',{noteUUID:uuid,expected,cardId:taskId,content:'Changed',startAt:null});
  assert.equal(result.ok,false);assert.match(result.message,/changed/);assert.equal(app.calls.length,0);
});
test("settings accept only supported date formats and tolerate native null records",async()=>{
  const app=host();app.settings['kanban.board.'+uuid]='null';const plugin=createPlugin();
  const good=await plugin.onEmbedCall(app,'settings',{noteUUID:uuid,expected:app.source(),dateFormat:'iso'});
  assert.equal(good.ok,true,good.message);assert.equal(good.changed,true);
  const refreshed=await plugin.onEmbedCall(app,'refresh',{noteUUID:uuid});
  assert.equal(refreshed.data.settings.dateFormat,'iso');
  const bad=await plugin.onEmbedCall(app,'settings',{noteUUID:uuid,expected:app.source(),dateFormat:'script'});
  assert.equal(bad.ok,false);
});
test("the complete bundle creates its actions in a DOM-free plugin worker",async()=>{
  const code=await readFile(new URL('../dist/plugin.js',import.meta.url),'utf8');
  const plugin=vm.runInNewContext('('+code+')',{URL},{timeout:3000});
  assert.equal(typeof plugin._get().renderEmbed,'function');
  assert.equal(typeof plugin.noteOption['Open Kanban'],'function');
});

test("a post-insertion read failure reports the existing task ID for safe editing",async()=>{
  const app=host(),expected=app.source(),createdId='22222222-2222-4222-8222-222222222222';
  let inserted=0;
  const originalRead=app.getNoteContent;
  app.insertTask=async()=>{inserted++;return createdId;};
  app.getNoteContent=async()=>{if(inserted)throw Error('Temporary host read failure');return originalRead();};
  const result=await createPlugin().onEmbedCall(app,'add',{noteUUID:uuid,expected,columnId:'column:0',content:'New card',startAt:null});
  assert.equal(result.ok,false);
  assert.equal(result.createdTaskId,createdId);
  assert.match(result.message,/card was created/);
  assert.equal(inserted,1);
});

test("a confirmed native task edit is acknowledged independently of a later view failure",async()=>{
  const app=host(),plugin=createPlugin();
  app.updateTask=async(id,updates)=>{app.calls.push(['updateTask',id,updates]);app.getNoteContent=async()=>{throw Error('View temporarily unavailable');};return true;};
  const result=await plugin.onEmbedCall(app,'edit',{noteUUID:uuid,expected:app.source(),cardId:taskId,content:'Edited card',startAt:null});
  assert.equal(result.ok,true,result.message);
  assert.equal(result.changed,true);
  const refresh=await plugin.onEmbedCall(app,'refresh',{noteUUID:uuid});
  assert.equal(refresh.ok,false);
  assert.match(refresh.message,/View temporarily/);
  assert.equal(app.calls.filter(call=>call[0]==='updateTask').length,1);
});
