'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {CATALOG_ENTRIES,answerCatalogQuestion,getCatalogSummary}=require('../catalog-service');
const {classifyServiceIntent}=require('../service-router');
test('collection counts come from actual records and stay distinct from patron borrowing',()=>{
 for(const question of ['How many items are in the catalogue?','How many books do you have?','What is the oldest book?','What is the newest book?'])assert.equal(classifyServiceIntent(question),'catalog',question);
 assert.equal(classifyServiceIntent('How many books do I have checked out?'),'account');
 const summary=getCatalogSummary();assert.equal(summary.totalRecords,CATALOG_ENTRIES.length);
 assert.match(answerCatalogQuestion('How many items are in the catalogue?'),new RegExp(summary.activeCopies.toLocaleString()));
 const books=CATALOG_ENTRIES.filter(e=>['Print Book','Large Print','Ebook'].includes(e.format));
 assert.match(answerCatalogQuestion('How many books do you have?'),new RegExp(summary.activeBookCopies.toLocaleString()));
 const oldest=answerCatalogQuestion('What is the oldest book?');
 assert.match(oldest,new RegExp(String(Math.min(...books.map(e=>e.year)))));
 assert.ok(books.filter(e=>e.year===Math.min(...books.map(b=>b.year))).some(e=>oldest.includes(e.title)));assert.match(oldest,/do not establish the age of a particular physical copy/);
 assert.doesNotMatch(oldest,/; Audiobook;/);
 const latest=answerCatalogQuestion('What is the newest book?');assert.match(latest,new RegExp(String(Math.max(...books.map(e=>e.year)))));
});
test('HTTP collection requests use computed catalog facts',async()=>{
 require('dotenv').config=()=>({parsed:{}});
 const {app}=require('../../server');const previous=app.locals.composeServiceReply;
 app.locals.composeServiceReply=async({payload})=>payload;
 const server=app.listen(0,'127.0.0.1');
 try{
  await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
  for(const message of ['How many items are in the catalogue?','What is the oldest book?']){
   const r=await fetch(`http://127.0.0.1:${server.address().port}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message})});
   assert.equal(r.status,200);assert.equal((await r.json()).reply,answerCatalogQuestion(message));
  }
 }finally{app.locals.composeServiceReply=previous;await new Promise(resolve=>server.close(resolve));}
});
