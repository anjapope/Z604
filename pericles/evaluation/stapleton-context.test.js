'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),path=require('node:path');
const context=require('../knowledge/stapleton-context.json');const {INSTITUTIONAL_CONTEXT}=require('../knowledge/institutional-context');
test('student city/library context is published, navigable, and consistent with assistant knowledge',()=>{
 const page=fs.readFileSync(path.join(__dirname,'../../stapleton-context.html'),'utf8');
 assert.ok(require('../public-assets').includes('stapleton-context.html'));
 for(const item of context.libraryHistory)assert.ok(page.includes(item.period),item.period);
 assert.deepEqual(INSTITUTIONAL_CONTEXT.libraryHistory,context.libraryHistory);
 assert.match(page,/tax incentives/);assert.match(page,/Logan King/);assert.match(page,/11:30 AM/);
 assert.match(fs.readFileSync(path.join(__dirname,'../../site-nav.js'),'utf8'),/stapleton-context.html/);
 for(const file of require('../public-assets').filter(p=>p.endsWith('.html')))assert.match(fs.readFileSync(path.join(__dirname,'../..',file),'utf8'),/href="stapleton-context.html"/);
});
