'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('all pages load shared navigation and About/Instructions retain Community Support',()=>{
 const root=path.join(__dirname,'../..');
 const pages=require('../public-assets').filter(f=>f.endsWith('.html'));
 for(const page of pages)assert.match(fs.readFileSync(path.join(root,page),'utf8'),/src="site-nav.js"/);
 for(const page of pages){
  let links;
  vm.runInNewContext(fs.readFileSync(path.join(root,'site-nav.js'),'utf8'),{location:{pathname:'/Z604/'+page},document:{querySelectorAll:()=>[{replaceChildren:(...items)=>{links=items;}}],createElement:()=>({setAttribute(name,value){this[name]=value;}})}});
  assert.equal(links.filter(l=>l.textContent==='Community Support').length,1);
  assert.equal(links.filter(l=>l.textContent==='Events & Programs').length,1);
  assert.ok(!links.some(l=>l.textContent==='Events'||l.textContent==='Programs'));
  if(page==='programs.html')assert.ok(links.find(l=>l['aria-current']==='page').href.startsWith('events.html'));
  assert.ok(links.every(l=>l.href.includes('?nav=')));
  assert.equal(links.filter(l=>l['aria-current']==='page').length,1);
 }
});
