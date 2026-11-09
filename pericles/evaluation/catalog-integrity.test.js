'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {CATALOG_ENTRIES,getCatalogSummary}=require('../catalog-service');
const {createCirculationService}=require('../circulation-service');
const manifest=require('../../scripts/catalog-manifest.json');
test('sourced collection contains thousands of distinct works without synthetic copies or dates',()=>{
 assert.equal(CATALOG_ENTRIES.length,manifest.records);
 assert.ok(getCatalogSummary().distinctWorks>9000);
 assert.equal(new Set(CATALOG_ENTRIES.map(e=>e.recordId)).size,CATALOG_ENTRIES.length);
 assert.ok(CATALOG_ENTRIES.every(e=>!(/\(Copy \d+\)|Catalog copy/.test(e.title+' '+e.description))));
 const imported=CATALOG_ENTRIES.filter(e=>e.sourceWorkId && e.provenance.startsWith('Open Library'));
 assert.equal(imported.length,manifest.importedRecords);
 assert.equal(new Set(imported.map(e=>e.sourceWorkId)).size,imported.length);
 for(const e of imported){
  assert.match(e.sourceUrl,/^https:\/\/openlibrary.org\/works\/OL\d+W$/);
  assert.ok(e.title&&e.author&&e.subjects.length);assert.equal(e.format,'Print Book');
  assert.match(e.publicationYearType,/First publication/);
 }
 assert.ok(CATALOG_ENTRIES.filter(e=>e.year>=2000).length>3000);
 assert.ok(CATALOG_ENTRIES.filter(e=>e.audience==='Children').length>1500);
 for(const genre of ['Computing','Veterans and Military Life','Genealogy','Cooking','Disability and Accessibility'])assert.ok(CATALOG_ENTRIES.some(e=>e.genre===genre),genre);
});
test('legacy generated loan IDs migrate to the same title rather than an imported work',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'catalog-migration-'));
 try{
  const filePath=path.join(dir,'circulation.json');const now=()=>new Date('2026-11-08T17:00:00Z');
  createCirculationService({filePath,now}).select({},'A');
  const saved=JSON.parse(fs.readFileSync(filePath));delete saved.catalogSchemaVersion;
  saved.accounts.A.loans[0].recordId='CAT-0105';fs.writeFileSync(filePath,JSON.stringify(saved));
  const account=createCirculationService({filePath,now}).select({},'A');
  assert.equal(account.loans[0].title,'The Great Gatsby');
  assert.equal(account.loans[0].recordId,'CAT-0001');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
