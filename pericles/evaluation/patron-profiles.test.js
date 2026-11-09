'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createCirculationService}=require('../circulation-service');
const {patronProfileReply}=require('../patron-profiles');
test('profile data persists, stays scoped to its patron, and existing-store migration runs once',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'patron-profiles-'));
 try {
  const filePath=path.join(dir,'circulation.json'),now=()=>new Date('2026-11-08T17:00:00Z');
  let service=createCirculationService({filePath,now});
  const a=service.select({},'A'), b=service.select({},'B'), c=service.select({},'C');
  assert.equal(a.violations.length,12);assert.equal(b.violations.length,0);assert.equal(c.recentSearches.length,0);
  assert.equal(b.recentSearches.length,3);assert(b.loans.some(l=>l.title==='For Whom the Bell Tolls'));
  assert(b.loans.some(l=>l.title==='The Guns of August'));assert(b.loans.some(l=>l.title==='Ken Burns: The Vietnam War'));
  assert.equal(patronProfileReply('veterans services',a),null);
  assert.match(patronProfileReply('veterans services',b).reply,/recent account searches.*Stapleton VA Outpatient Clinic/s);
  assert.equal(patronProfileReply('help with my maths homework',b),null);
  const saved=JSON.parse(fs.readFileSync(filePath));delete saved.patronProfilesVersion;
  saved.accounts.B.loans=saved.accounts.B.loans.filter(l=>l.id!=='B-4');fs.writeFileSync(filePath,JSON.stringify(saved));
  service=createCirculationService({filePath,now});const migrated=service.select({},'B');
  assert.equal(migrated.loans.filter(l=>l.title==='For Whom the Bell Tolls').length,1);
  assert.equal(migrated.loans.length,b.loans.length);
  assert.deepEqual(createCirculationService({filePath,now}).select({},'A').violations,a.violations);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
