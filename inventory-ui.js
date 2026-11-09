'use strict';
window.PericlesInventory = {
 render(container,entry) {
  const copies=entry.copies||[];
  const section=document.createElement('section');
  section.className='catalog-inventory';
  const heading=document.createElement('h3');heading.textContent='Copies and item history';section.appendChild(heading);
  const summary=document.createElement('p');
  const active=copies.filter(c=>c.status==='active').length;
  summary.textContent=copies.length ? `${active} active physical copies · ${copies.length-active} retired copies. ${entry.copyAllocation || ''}. Active inventory does not confirm on-shelf availability.` : 'Digital-format record. License counts and availability are not recorded.';
  section.appendChild(summary);
  if(copies.length){
   const list=document.createElement('ul');
   for(const c of copies){const row=document.createElement('li');row.textContent=`${c.itemId} — ${c.status}; acquired ${c.acquiredOn}${c.retiredOn?`; retired ${c.retiredOn} — ${c.reason}`:''}${c.replacedBy?`; replaced by ${c.replacedBy}`:''}${c.replaces?`; replaces ${c.replaces}`:''}`;list.appendChild(row);}
   section.appendChild(list);
  }
  container.appendChild(section);
 }
};
