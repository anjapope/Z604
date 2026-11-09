'use strict';
function inventorySummary(entries) {
 const copies=entries.flatMap(e=>(e.copies||[]).map(c=>({...c,recordId:e.recordId,title:e.title,format:e.format})));
 const activeCopiesByFormat = {};
 for (const c of copies) if(c.status==='active') activeCopiesByFormat[c.format]=(activeCopiesByFormat[c.format]||0)+1;
 return {activeCopiesByFormat,activeCopies:copies.filter(c=>c.status==='active').length,retiredCopies:copies.filter(c=>c.status!=='active').length,lostCopies:copies.filter(c=>c.status==='lost').length,withdrawnCopies:copies.filter(c=>c.status==='withdrawn').length,replacementCopies:copies.filter(c=>c.replaces).length,multicopyTitles:entries.filter(e=>(e.copies||[]).filter(c=>c.status==='active').length>1).length,digitalRecords:entries.filter(e=>['Ebook','Audiobook'].includes(e.format)).length,activeBookCopies:copies.filter(c=>c.status==='active'&&['Print Book','Large Print'].includes(c.format)).length};
}
function inventoryAnswer(message,entries) {
 if(!/\b(?:copies|copy history|inventory|withdrawn|lost|replaced|replacement|deaccession\w*|retired)\b/i.test(message))return null;
 if(/\b(?:my|i lost|i damaged|pay|fees?|charges?|costs?|fines?|renew|hold)\b/i.test(message))return null;
 const lower=message.toLowerCase();
 const match=entries.filter(e=>{const at=lower.indexOf(e.title.toLowerCase());return at>=0&&!/[a-z0-9]/i.test(lower[at-1]||' ')&&!/[a-z0-9]/i.test(lower[at+e.title.length]||' ');}).sort((a,b)=>b.title.length-a.title.length)[0];
 const summary=inventorySummary(entries);
 if(match){
  const copies=match.copies||[],active=copies.filter(c=>c.status==='active'),retired=copies.filter(c=>c.status!=='active');
  return `${match.title} (${match.format}) has ${active.length} active physical copies and ${retired.length} retired ${retired.length===1?'copy':'copies'} in its item history.${!copies.length?' This is a digital record; license counts and availability are not recorded.':''}\n${copies.map(c=>`- ${c.itemId}: ${c.status}; acquired ${c.acquiredOn}${c.retiredOn?`; retired ${c.retiredOn}: ${c.reason}`:''}${c.replacedBy?`; replaced by ${c.replacedBy}`:''}${c.replaces?`; replaces ${c.replaces}`:''}`).join('\n')}\n[Catalog record](/catalog-detail.html?id=${match.recordId})\nActive inventory is not an on-shelf availability check. Retired copies do not count toward current holdings.`;
 }
 const history=entries.filter(e=>(e.copies||[]).some(c=>c.status!=='active'));
 return `SPL has ${summary.activeCopies.toLocaleString()} active physical copies across ${entries.length.toLocaleString()} bibliographic records, plus ${summary.digitalRecords} digital-format records whose license counts are not recorded. ${summary.multicopyTitles.toLocaleString()} titles have multiple active copies. Item history retains ${summary.retiredCopies} retired copies (${summary.lostCopies} lost; ${summary.withdrawnCopies} withdrawn), with ${summary.replacementCopies} linked replacement copies. Retired copies are excluded from current inventory.\nExamples:\n${history.slice(0,6).map(e=>`- [${e.title}](/catalog-detail.html?id=${e.recordId}): ${e.copies.filter(c=>c.status==='active').length} active; ${e.copies.filter(c=>c.status!=='active').map(c=>`${c.status} ${c.itemId}, replaced by ${c.replacedBy}`).join('; ')}`).join('\n')}\nActive inventory does not establish whether an item is on the shelf right now.`;
}
module.exports={inventorySummary,inventoryAnswer};
