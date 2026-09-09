const label=text=>String(text||"").replace(/\uFEFF/g,"").replace(/\s+/g," ").trim();
const href=text=>{try{return new URL(String(text)).href;}catch{return String(text||"");}};
export function attachFootnoteMetadata(root,occurrences=[]) {
  const remaining=[...occurrences];
  for(const anchor of root.querySelectorAll("a")){
    if(anchor.querySelector("img"))continue;
    const actualHref=anchor.getAttribute("data-href")??anchor.getAttribute("href")??"";
    const index=remaining.findIndex(entry=>label(entry.label)===label(anchor.textContent)&&href(entry.href)===href(actualHref));
    if(index<0)continue;
    const [entry]=remaining.splice(index,1);
    if(entry.footnoteId!=null){anchor.dataset.footnoteId=entry.footnoteId;anchor.dataset.footnoteContent=entry.hasContent?"1":"0";}
  }
}
