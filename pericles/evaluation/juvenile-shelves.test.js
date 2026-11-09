'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {CATALOG_ENTRIES,searchCatalog}=require('../catalog-service');
test('children’s physical books have explicit fiction, nonfiction, or picture-book shelves',()=>{
 const books=CATALOG_ENTRIES.filter(e=>e.audience.includes('Children')&&['Print Book','Large Print'].includes(e.format));
 assert.ok(books.length>1500);
 for(const e of books)assert.match(e.callNumber,/^(?:J FIC|JNF|J PIC) /,e.title);
 assert.match(CATALOG_ENTRIES.find(e=>e.title==='Matilda').callNumber,/^J FIC DAH/);
 assert.match(CATALOG_ENTRIES.find(e=>e.title==='The Very Hungry Caterpillar').callNumber,/^J PIC CAR/);
 const nonfiction=books.filter(e=>e.isFiction===false&&!/picture books/i.test(e.subjects.join(' ')));
 assert.ok(nonfiction.some(e=>e.callNumber.startsWith('JNF ')));
 assert.ok(searchCatalog('JNF',{limit:10}).every(e=>e.callNumber.startsWith('JNF ')));
});
