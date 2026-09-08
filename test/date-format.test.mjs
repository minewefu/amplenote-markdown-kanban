import {test} from "node:test";
import assert from "node:assert/strict";
import {formatDatePattern} from "../date-format.mjs";
test("custom date patterns preserve literals and format leap days and time",()=>{
  const date=new Date(2024,1,29,13,5,9);
  assert.equal(formatDatePattern(date,'[Due] DD/MM/YYYY HH:mm:ss','en-US'),'Due 29/02/2024 13:05:09');
  assert.equal(formatDatePattern(date,'ddd, D MMMM YY h:mm A','en-US'),'Thu, 29 February 24 1:05 PM');
});
test("custom twelve-hour dates handle midnight and noon",()=>{
  assert.equal(formatDatePattern(new Date(2026,0,1,0,0),'hh:mm a'),'12:00 am');
  assert.equal(formatDatePattern(new Date(2026,0,1,12,0),'hh:mm a'),'12:00 pm');
  assert.equal(formatDatePattern(new Date(NaN),'YYYY-MM-DD'),'');
});
