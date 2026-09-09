import {test} from "node:test";
import assert from "node:assert/strict";
import {JSDOM} from "jsdom";
import {richFootnoteData} from "../core.mjs";
import {attachFootnoteMetadata} from "../ui/link-metadata.mjs";

test("native mixed rich footnotes retain Markdown images and formatting",()=>{
  const md='Inspect [study][^1]\n\n[^1]: [study](https://example.com/study)\n\n    **Review** this scene.\n\n    ![](https://example.com/image.png)\n';
  const data=richFootnoteData(md);
  assert.equal(data.definitions[0].markdown,'**Review** this scene.\n\n![](https://example.com/image.png)');
  assert.deepEqual(data.links,[{label:'study',href:'https://example.com/study',footnoteId:'1',hasContent:true}]);
});
test("footnote boundaries preserve code indentation and repeated references",()=>{
  const md='[One][^1] [Two][^2] [One again][^1]\n\n[^1]: [One](https://example.com/one)\n\n        code stays indented\n\n[^2]: [Two]()\n\n    Text.\n';
  const data=richFootnoteData(md);
  assert.equal(data.definitions[0].markdown,'    code stays indented');
  assert.equal(data.definitions[1].markdown,'Text.');
  assert.deepEqual(data.links.map(link=>link.footnoteId),['1','2','1']);
  assert.deepEqual(data.links.map(link=>link.label),['One','Two','One again']);
});
test("a normal link does not consume a same-label rich footnote's identity",()=>{
  const md='[Same](https://example.com) [Same][^1] [Same][^2]\n\n[^1]: [Same](https://example.com)\n\n    First body.\n\n[^2]: [Same](https://example.com)\n\n    Second body.\n';
  const dom=new JSDOM('<div id="root"><a href="https://example.com">Same</a><a href="https://example.com">Same\ufeff</a><a href="https://example.com">Same</a></div>');
  const root=dom.window.document.getElementById('root');
  attachFootnoteMetadata(root,richFootnoteData(md).links);
  assert.deepEqual([...root.querySelectorAll('a')].map(a=>a.dataset.footnoteId),[undefined,'1','2']);
  dom.window.close();
});
