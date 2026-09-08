import DOMPurify from "dompurify";
export function mountPreview() {
const state=JSON.parse(document.getElementById("preview-state").textContent);
document.getElementById("preview-title").textContent=state.title || "Rich footnote";
const body=document.getElementById("preview-body");
body.innerHTML=DOMPurify.sanitize(state.html || "",{USE_PROFILES:{html:true},ADD_ATTR:["description","data-href"],FORBID_TAGS:["input","button","textarea","select","style","form"]});
const source=document.getElementById("preview-source");
try{const url=new URL(state.href);if(["https:","http:","mailto:"].includes(url.protocol)){source.href=url.href;source.hidden=false;}}catch{}
body.addEventListener("click",async event=>{
  const link=event.target.closest("a");if(!link)return;
  let action,payload;
  if(link.getAttribute("description")){action="richFootnote";payload={description:link.getAttribute("description"),href:link.getAttribute("data-href") || link.href,label:link.textContent};}
  else if(link.href.startsWith("https://www.amplenote.com/notes/")){action="peekNote";payload={url:link.href};}
  if(!action)return;event.preventDefault();
  const result=await window.callAmplenotePlugin(action,{noteUUID:state.noteUUID,...payload});
  if(!result?.ok){document.getElementById("preview-error").textContent=result?.message || "Could not open link.";}
});
}
