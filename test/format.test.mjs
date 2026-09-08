import { test } from "node:test";
import assert from "node:assert/strict";
import { appendNoteLink, encodeState, renderRichDescription, firstTagColor } from "../format.mjs";
import { markdownLinks, noteLinkUuid, columnKeys, parseBoard } from "../core.mjs";

const uuid="11111111-1111-4111-8111-111111111111";
test("card labels are inserted before footnotes and do not duplicate existing links",()=>{
  const content='Card [detail][^1]\n\n[^1]: [detail](https://example.com)\n\n    **Rich text**\n';
  const linked=appendNoteLink(content,'Note [title]',uuid);
  assert.ok(linked.indexOf('Note \\[title\\]')<linked.indexOf('[^1]:'));
  assert.ok(linked.endsWith('    **Rich text**\n'));
  assert.equal(appendNoteLink(linked,'New name',uuid),linked);
  assert.equal(markdownLinks(linked).filter(link=>noteLinkUuid(link.url)).length,1);
});
test("note URLs require the official origin and a real note identifier",()=>{
  assert.equal(noteLinkUuid('https://www.amplenote.com/notes/'+uuid),uuid);
  assert.equal(noteLinkUuid('https://www.amplenote.com.evil.example/notes/'+uuid),null);
  assert.equal(noteLinkUuid('javascript:alert(1)'),null);
  assert.equal(noteLinkUuid('https://www.amplenote.com/notes/tasks/'+uuid),null);
});
test("embedded JSON cannot terminate its script element",()=>{
  const encoded=encodeState({title:'</script><script>bad()</script>',line:'\u2028'});
  assert.ok(!encoded.includes('<'));
  assert.deepEqual(JSON.parse(encoded),{title:'</script><script>bad()</script>',line:'\u2028'});
});
test("rich footnotes preserve text, marks and links without accepting executable attributes",()=>{
  const html=renderRichDescription([{type:'paragraph',content:[{type:'text',text:'<img onerror=x>',marks:[{type:'strong'}]},{type:'link',attrs:{href:'https://example.com?a=1&b=2',onclick:'bad()'},content:[{type:'text',text:'Open'}]},{type:'image',attrs:{src:'javascript:alert(1)'}}]}]);
  assert.ok(html.includes('<strong>&lt;img onerror=x&gt;</strong>'));
  assert.ok(html.includes('href="https://example.com/?a=1&amp;b=2"'));
  assert.ok(!html.includes('onclick'));
  assert.ok(!html.includes('<img'));
});
test("unsupported rich-footnote wrappers retain readable children",()=>{
  assert.equal(renderRichDescription([{type:'future-block',content:[{type:'text',text:'Keep this'}]}]),'Keep this');
  assert.throws(()=>renderRichDescription('{}'),/unsupported/);
});
test("label color follows the note's first tag rather than arbitrary tag sorting",()=>{
  const tags=[{text:'a',color:'ff0000'},{text:'b',color:'00ff00'}];
  assert.equal(firstTagColor({tags:['b','a']},tags),'#00ff00');
  assert.equal(firstTagColor({tags:[]},tags),null);
});
test("semantic column keys survive source offsets and disambiguate duplicates",()=>{
  const md='# Same\n\n- [ ] One\n\n# Same\n';
  const a=columnKeys(parseBoard(md)),b=columnKeys(parseBoard('Intro\n\n'+md));
  assert.deepEqual(a.map(column=>column.key),b.map(column=>column.key));
  assert.notEqual(a[1].key,a[2].key);
});
