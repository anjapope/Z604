"""Generate deterministic, anonymous SPL circulation events, not readership claims."""
import hashlib,random,datetime,collections,json
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
ASOF=datetime.date(2026,11,8)
TODAY=ASOF.isoformat()
END=ASOF-datetime.timedelta(days=1)
POLICY=json.loads((ROOT/'scripts/catalog-holdings-policy.json').read_text())
POPULAR={x.casefold() for x in POLICY['popularTitles']}
# Recent/current patron loans are maintained separately by the live account service.
CURRENT={'the midnight library','atomic habits','project hail mary','educated','the great gatsby','1984','matilda','the wild robot','the grapes of wrath','for whom the bell tolls','the guns of august','the body keeps the score','ken burns: the vietnam war'}
def build_history(entries):
 records={};tiers=collections.Counter();totals=collections.Counter()
 for e in entries:
  seed=int(hashlib.sha256(e['recordId'].encode()).hexdigest()[:16],16);rng=random.Random(seed)
  title=e['title'].casefold();harry=title.startswith('harry potter and ') and 'rowling' in e['author'].casefold()
  if harry:tier='very high';rate=.92
  elif title in POPULAR:tier='high';rate=.66
  elif e['genre'] in ['Fantasy','Mystery/Thriller','Romance','Children','Young Adult','Science Fiction']:
   tier='regular';rate=rng.choice([.12,.20,.30,.40])
  else:tier='low';rate=rng.choice([0,0,.008,.015,.035,.065])
  # Deliberate long tail: even eligible general titles may never have circulated.
  if not harry and title not in POPULAR and seed%9==0:rate=0;tier='none'
  tiers[tier]+=1;events=[]
  units=e['copies'] or [{'itemId':None,'acquiredOn':f"{min(2026,max(2020,e['year']))}-03-01",'status':'digital'}]
  end= datetime.date(2026,9,30) if title in CURRENT else END
  for unit in units:
   acquired=datetime.date.fromisoformat(unit['acquiredOn'])
   limit=min(end,datetime.date.fromisoformat(unit.get('retiredOn',TODAY)))
   lost=unit['status']=='lost' and acquired<=limit
   lost_start=limit-datetime.timedelta(days=21) if lost else None
   normal_limit=lost_start-datetime.timedelta(days=1) if lost else limit
   cursor=acquired+datetime.timedelta(days=rng.randint(0,15))
   if rate:
    while cursor+datetime.timedelta(days=7)<=normal_limit:
     # Short loan cycles are early returns, never simultaneous loans of a copy.
     wait=max(0,int(rng.expovariate(rate/14)))
     checkout=cursor+datetime.timedelta(days=wait)
     duration=rng.randint(7,21);returned=checkout+datetime.timedelta(days=duration)
     if returned>normal_limit:break
     events.append([unit['itemId'],checkout.isoformat(),returned.isoformat(),returned.isoformat(),'returned'])
     cursor=returned+datetime.timedelta(days=1)
   if lost and lost_start>=acquired:
    events.append([unit['itemId'],lost_start.isoformat(),None,limit.isoformat(),'lost'])
  events.sort(key=lambda r:(r[1],r[0] or ''))
  # IDs remain stable for this version of the authored history snapshot.
  events=[[f"{e['recordId']}-L{i+1:05d}",*r] for i,r in enumerate(events)]
  byyear=collections.Counter(r[2][:4] for r in events)
  e['circulation']={'totalCheckouts':len(events),'byYear':dict(sorted(byyear.items())),'byCopy':dict(collections.Counter(r[1] or 'digital' for r in events)),'firstCheckoutOn':events[0][2] if events else None,'lastCheckoutOn':events[-1][2] if events else None,'historyAsOf':TODAY}
  records[e['recordId']]=events;totals['loans']+=len(events)
  totals['zeroTitles']+=not events
 data={'version':1,'asOf':TODAY,'periodStart':'2020-03-01','authoredHistory':True,'columns':['loanId','itemId','checkedOutOn','returnedOn','resolvedOn','outcome'],'records':records,'notes':['Anonymous authored circulation history for the Stapleton scenario; not sourced from real patrons or Open Library usage.','Copy acquisitions, retirements, and replacements constrain all physical loans. No overlapping loans per copy. Digital histories are serial title-level events; no license quantities are inferred.','Popular-title selection is editorial. Demand weights create varied usage and a zero-use long tail; reading value is not inferred from use.','Live patron loans and renewal transactions remain in the separate account service and are not added to this historical snapshot. Snapshot dates and scope must be stated when reporting usage.']}
 (ROOT/'pericles/knowledge/circulation-history.json').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n')
 return {'asOf':TODAY,**dict(totals),'demandTiers':dict(tiers)}
