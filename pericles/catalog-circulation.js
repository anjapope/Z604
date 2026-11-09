'use strict';
const ASOF='2026-11-08', START='2020-03-01';
function isCirculationStatisticsQuestion(text) {
 if(isHistoryPrivacyQuestion(text))return false;
 if(/\b(?:my|our)\s+(?:books?|loans?|checkouts?|checkout history|borrowing history|account)\b|\b(?:have i|did i)\b/i.test(text))return false;
 if(/\b(?:programs?|events?|workshops?|sessions?)\b/i.test(text)&&!/\b(?:books?|titles?|catalog|collection)\b/i.test(text))return false;
 return /\bmost (?:checkouts|loans)\b|\b(?:most|least)\s+(?:popular|borrowed|checked[- ]?out|circulated)|\bchecked[- ]?out (?:the )?most\b|\btop\s+(?:(?:\d+|ten|five)\s+)?(?:books|titles|borrowed)|\bpopular\s+(?:books|titles)|\b(?:never|zero|no)\s+(?:been )?(?:borrowed|checked[- ]?out|checkouts)|\b(?:circulation|checkout) (?:history|statistics|records|counts|totals)|\bhow many times\b.*\b(?:borrowed|checked|circulated)|\b(?:checkouts|loans) (?:has|does|for)\b/i.test(text);
}
function dateWindow(text) {
 let from=START,to=ASOF;
 const dates=text.match(/\b(?:from|between)\s+(\d{4}-\d{2}-\d{2})\s+(?:to|through|and)\s+(\d{4}-\d{2}-\d{2})/i);
 const since=text.match(/\bsince\s+(\d{4}-\d{2}-\d{2})/i);
 const year=text.match(/\b(?:in|during|since|for)\s+(20\d{2})\b/i);
 const days=text.match(/\b(?:last|past) (\d{1,4}) days\b/i);
 if(dates){from=dates[1];to=dates[2];}
 else if(since){from=since[1];}
 else if(year){from=`${year[1]}-01-01`;if(!/\bsince\b/i.test(year[0]))to=`${year[1]}-12-31`;}
 else if(/\bthis year\b/i.test(text))from='2026-01-01';
 else if(/\blast year\b/i.test(text)){from='2025-01-01';to='2025-12-31';}
 else if(/\bthis month\b/i.test(text))from='2026-11-01';
 else if(/\blast month\b/i.test(text)){from='2026-10-01';to='2026-10-31';}
 else if(days){const d=new Date(`${ASOF}T12:00:00Z`);d.setUTCDate(d.getUTCDate()-Math.max(0,Number(days[1])-1));from=d.toISOString().slice(0,10);}
 else if(/\b(?:past|last) (?:12 months|year)\b/i.test(text))from='2025-11-09';
 for(const date of [from,to]){const parsed=new Date(date+'T12:00:00Z');if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)return {error:'Use valid dates in YYYY-MM-DD form.'};}
 if(from>to)return {error:'Use an end date on or after the start date.'};
 if(from>ASOF||to<START)return {error:`Recorded history covers ${START} through ${ASOF}; that period is outside the snapshot.`};
 return {from:from<START?START:from,to:to>ASOF?ASOF:to};
}
function workKey(e){return `${e.author}|${e.title.replace(/^Percy Jackson and the Olympians: /,'')}`.toLowerCase();}
function circulationStatistics(text,entries) {
 const window=dateWindow(text);if(window.error)return {error:window.error};const full=window.from===START&&window.to===ASOF;
 const history=full?null:require('./knowledge/circulation-history.json');
 let candidates=entries;
 if(/\bdvds?\b/i.test(text))candidates=candidates.filter(e=>e.format==='DVD');
 else if(/\baudiobooks?\b/i.test(text))candidates=candidates.filter(e=>e.format==='Audiobook');
 else if(/\be-?books?\b/i.test(text))candidates=candidates.filter(e=>e.format==='Ebook');
 else if(/\bbooks?\b/i.test(text))candidates=candidates.filter(e=>!['DVD','Blu-ray'].includes(e.format));
 const lower=text.toLowerCase();
 const named=candidates.filter(e=>{const title=e.title.toLowerCase(),at=lower.indexOf(title);return at>=0&&!/[a-z0-9]/i.test(lower[at-1]||' ')&&!/[a-z0-9]/i.test(lower[at+title.length]||' ');}).sort((a,b)=>b.title.length-a.title.length)[0];
 if(named)candidates=candidates.filter(e=>workKey(e)===workKey(named));
 else if(/harry potter/i.test(text))candidates=candidates.filter(e=>/^Harry Potter and /i.test(e.title));
 else {
  if(/\b(?:children|kids)\b/i.test(text))candidates=candidates.filter(e=>/Children|All Ages/.test(e.audience));
  const genre=[...new Set(entries.map(e=>e.genre))].sort((a,b)=>b.length-a.length).find(g=>lower.includes(g.toLowerCase()));
  if(genre)candidates=candidates.filter(e=>e.genre===genre);
 }
 const groups=new Map();
 for(const e of candidates){
  const total=full?(e.circulation?.totalCheckouts||0):(history.records[e.recordId]||[]).filter(r=>r[2]>=window.from&&r[2]<=window.to).length;
  const key=workKey(e);let row=groups.get(key);
  if(!row){row={recordId:e.recordId,title:e.title.replace(/^Percy Jackson and the Olympians: /,''),author:e.author,checkouts:0,formats:[]};groups.set(key,row);}
  row.checkouts+=total;row.formats.push(e.format);
 }
 const rows=[...groups.values()];const zero=rows.filter(r=>r.checkouts===0).length;
 const never=/\b(?:never|zero|no)\s+(?:been )?(?:borrowed|checked[- ]?out|checkouts)/i.test(text);
 const least=/\bleast\b/i.test(text);
 const limit=Math.min(20,Math.max(1,Number(text.match(/\btop\s+(\d+)\b/i)?.[1])||(/\btop ten\b/i.test(text)?10:5)));
 const sorted=(never?rows.filter(r=>r.checkouts===0):rows).sort((a,b)=>(least||never?a.checkouts-b.checkouts:b.checkouts-a.checkouts)||a.title.localeCompare(b.title));
 let recent=[],byCopy={};
 if(named){
  for(const e of candidates){
   for(const [id,count] of Object.entries(e.circulation?.byCopy || {})) byCopy[id]=(byCopy[id]||0)+count;
  }
  if(/\b(?:history|records)\b/i.test(text)) {
   const all=history || require('./knowledge/circulation-history.json');
   recent=candidates.flatMap(e=>all.records[e.recordId]||[]).filter(r=>r[2]>=window.from&&r[2]<=window.to).sort((a,b)=>b[2].localeCompare(a[2])).slice(0,8);
  }
 }
 return {recent,byCopy,window,asOf:ASOF,works:rows.length,totalCheckouts:rows.reduce((n,r)=>n+r.checkouts,0),zeroCheckoutWorks:zero,named:Boolean(named),never,results:sorted.slice(0,named?1:limit)};
}
function answerCirculationStatistics(text,entries) {
 if(!isCirculationStatisticsQuestion(text))return null;
 const s=circulationStatistics(text,entries);
 if(s.error)return s.error;
 return `Recorded checkout history, ${s.window.from} through ${s.window.to} (snapshot as of ${s.asOf}):\n${s.results.map((r,i)=>`${i+1}. [${r.title}](/catalog-detail.html?id=${r.recordId}) — ${r.author}: ${r.checkouts.toLocaleString()} checkouts${r.formats.length>1?' across '+r.formats.join(' and '):''}.`).join('\n')||'No matching records in this date range.'}\n${s.totalCheckouts.toLocaleString()} recorded checkouts across ${s.works.toLocaleString()} matching distinct works; ${s.zeroCheckoutWorks.toLocaleString()} have zero checkouts in this period. ${s.recent.length?'\nMost recent matching events:\n'+s.recent.map(r=>`- ${r[0]}: ${r[1]||'digital-format record'}; checked out ${r[2]}; ${r[3]?'returned '+r[3]:'resolved as lost '+r[4]}`).join('\n')+'\n':''}Counts are checkout events, not unique readers, holds, or renewals. These historical records are separate from current patron loans and recent account transactions; no borrower identities are included. Low use does not establish that a work lacks value.`;
}
module.exports={isCirculationStatisticsQuestion,circulationStatistics,answerCirculationStatistics,dateWindow};

function isHistoryPrivacyQuestion(text) {
 return /^(?:is|are) (?:my |our |the )?(?:borrowing|checkout|circulation) (?:history|records) (?:private|confidential)[?.!]*$/i.test(text.trim());
}
function isRestrictedHistoryRequest(text) {
 if(isHistoryPrivacyQuestion(text))return false;
 return /\b(?:checkout|borrowing|circulation|loan)[- ](?:history|histories|logs?|records?|data|statistics|counts?|totals?)\b|\b(?:who|which (?:patron|person|user)|names?).{0,45}\b(?:borrowed|checked out|read)\b|\b(?:byCopy|byYear|totalCheckouts|circulation-history|circulation-summaries)\b|\b(?:show|export|download|list|reveal).{0,35}\b(?:checkout|borrowing|circulation|loan)\b/i.test(text);
}
function publicPopularityReply(text, entries) {
 const q=text.trim().toLowerCase().replace(/[?!.,]/g,'').replace(/[-–]/g,' ').replace(/\s+/g,' ');
 const suffix='(?: in (?:the |your |spl[’\x27]s )?(?:collection|catalogue|catalog|library|spl|stapleton public library))?';
 const patterns=[
  new RegExp('^(?:what|which) (?:is |are )?(?:(?:the|your) )?(?:most popular|most borrowed|most checked out|most circulated) (?:book|title|item|work)s?'+suffix+'$'),
  new RegExp('^(?:what|which) (?:book|title|item|work)s? (?:has|have|had|is|are|was|were) (?:been )?(?:checked out|borrowed|circulated)(?: the)? most'+suffix+'$'),
  new RegExp('^(?:what|which) (?:book|title|item|work)s? (?:has|have|had) the most (?:checkouts|loans)'+suffix+'$'),
  new RegExp('^(?:show|list|give me|what are) (?:me )?(?:the )?(?:top (?:5|five) |most popular |most borrowed )(?:books|titles|works)'+suffix+'$')
 ];
 if(!patterns.some(p=>p.test(q))) return 'Checkout histories and detailed usage records are restricted. I can answer general collection-wide questions such as “What is the most popular book?”';
 if(!entries.some(e=>e.circulation))return 'General collection popularity information is currently unavailable.';
 const top=circulationStatistics('Most borrowed books',entries).results;
 const plural=/\b(?:books|titles|works|items)\b/.test(q);
 const chosen=top.slice(0,plural?5:1);
 return `${plural?'Among the most popular books':'The most popular book'} in SPL’s collection ${plural?'are':'is'} ${chosen.map(r=>`[${r.title}](/catalog-detail.html?id=${r.recordId}) by ${r.author}`).join('; ')}. This is a general collection-wide popularity summary; detailed circulation records are restricted.`;
}
module.exports.isRestrictedHistoryRequest=isRestrictedHistoryRequest;
module.exports.publicPopularityReply=publicPopularityReply;
