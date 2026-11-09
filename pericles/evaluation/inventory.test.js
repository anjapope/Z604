'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {CATALOG_ENTRIES,getCatalogSummary,answerCatalogQuestion}=require('../catalog-service');
const {inventorySummary}=require('../inventory-service');
const {classifyServiceIntent}=require('../service-router');
test('copy counts exclude retired stock and preserve bibliographic breadth',()=>{
 const s=getCatalogSummary();const copies=CATALOG_ENTRIES.flatMap(e=>e.copies||[]);
 assert.equal(s.activeCopies,copies.filter(c=>c.status==='active').length);
 assert.equal(s.retiredCopies,s.lostCopies+s.withdrawnCopies);
 assert.ok(s.activeCopies>s.totalRecords);assert.equal(s.distinctWorks,9130);
 assert.equal(new Set(copies.map(c=>c.itemId)).size,copies.length);
 assert.ok(s.multicopyTitles>100);assert.ok(s.replacementCopies>100);
 assert.ok(CATALOG_ENTRIES.filter(e=>['Ebook','Audiobook'].includes(e.format)).every(e=>e.copies.length===0));
});
test('retirement and replacement links are reciprocal and chronologically valid',()=>{
 for(const e of CATALOG_ENTRIES){const copies=e.copies||[];
  for(const c of copies){
   assert.ok(c.acquiredOn>`${e.year-1}-12-31`);
   if(c.status==='active') assert.equal(c.retiredOn,undefined);
   else{const replacement=copies.find(x=>x.itemId===c.replacedBy);assert.ok(replacement);assert.equal(replacement.replaces,c.itemId);assert.equal(replacement.status,'active');assert.ok(c.acquiredOn<=c.retiredOn);assert.ok(c.retiredOn<replacement.acquiredOn);}
  }
 }
});
test('copy questions route to authoritative inventory without turning retired items into available copies',()=>{
 const e=CATALOG_ENTRIES.find(e=>e.title==='Matilda');assert.equal(e.copies.filter(c=>c.status==='active').length,4);
 const q='How many copies of Matilda do you have?';assert.equal(classifyServiceIntent(q),'catalog');
 assert.match(answerCatalogQuestion(q),/4 active physical copies and 1 retired/);
 assert.match(answerCatalogQuestion('Show withdrawn and replaced items'),/retired copies.*lost.*withdrawn/s);
 const s=inventorySummary(CATALOG_ENTRIES);
 assert.match(answerCatalogQuestion('How many items are in the catalogue?'),new RegExp(s.activeCopies.toLocaleString()));
 assert.match(answerCatalogQuestion('How many records are in the catalogue?'),/9,131 bibliographic records/);
});
