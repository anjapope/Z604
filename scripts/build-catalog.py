"""Build the offline browser/server catalog from checked-in bibliographic snapshots."""
import json,re,unicodedata,collections
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
CACHE=ROOT/'scripts/catalog-sources'
def norm(s):return re.sub(r'[^a-z0-9]','',unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode().lower())
def titlekey(s):return norm(re.sub(r'^(?:the|a|an)\s+','',s,flags=re.I))
core=json.loads((CACHE/'core.json').read_text())
entries=[];seen_keys=set();seen_pairs=set();seen_titles=set();queries=[]
for e in core:
 e.pop('searchIndex',None)
 e['provenance']='SPL established collection'
 entries.append(e);seen_pairs.add((titlekey(e['title']),norm(e['author'])));seen_titles.add(titlekey(e['title']))
# Preserve import order independently of download completion order.
for p in sorted(CACHE.glob('*.json')):
 if p.name=='core.json':continue
 data=json.loads(p.read_text());queries.append(data['url'])
 for d in data['docs']:
  title=str(d.get('title','')).strip();authors=d.get('author_name') or [];year=d.get('first_publish_year');key=d.get('key','')
  if not title or not authors or not isinstance(year,int) or not 1400<=year<=2026 or not re.fullmatch(r'/works/OL\d+W',key):continue
  author='; '.join(authors[:4]);pair=(titlekey(title),norm(author));tk=titlekey(title)
  # Collapse editions/translations/duplicate work entries conservatively by title.
  if key in seen_keys or pair in seen_pairs or tk in seen_titles:
   for e in core:
    if titlekey(e['title'])==tk and 'sourceUrl' not in e:
     e['sourceUrl']='https://openlibrary.org'+key;e['sourceWorkId']=key
   continue
  subjects=[str(x).strip() for x in d.get('subject',[]) if isinstance(x,str) and 1<len(x)<90 and not re.search(r'^(?:open_|in:|nyt:|reading level|collection|accessible|protected|overdrive|large type|translations)',x,re.I)]
  metadata=' '.join(subjects).lower()
  juvenile=bool(re.search(r'juvenile|children.s (?:fiction|literature|stories)|picture books',metadata))
  teen=bool(re.search(r'young adult|teenage',metadata))
  isfiction=bool(re.search(r'\bfiction\b|novels|fairy tales|short stories',metadata))
  section=data['section'];shelf=data['shelf'];audience=data['audience']
  if juvenile:audience='Children';section='Children' if isfiction else 'Children’s Nonfiction';shelf='J FIC' if isfiction else 'J'
  elif teen:audience='Teen';section='Young Adult' if isfiction else 'Young Adult Nonfiction';shelf='YA FIC' if isfiction else 'YA'
  elif isfiction and shelf not in ['FIC','E','J FIC','YA FIC']:
   section='Literary Fiction';shelf='FIC'
  elif section in ['Fantasy','Science Fiction','Mystery/Thriller','Romance','Historical Fiction','Horror','Literary Fiction','Classic Fiction'] and not isfiction:
   # Subject search can return criticism, reference books, and unrelated records.
   continue
  if shelf=='FIC' and 'science fiction' in metadata:section='Science Fiction'
  elif shelf=='FIC' and re.search(r'fantasy fiction|fantasy literature',metadata):section='Fantasy'
  elif shelf=='FIC' and re.search(r'detective|mystery fiction',metadata):section='Mystery/Thriller'
  elif shelf=='FIC' and 'historical fiction' in metadata:section='Historical Fiction'
  last=norm(authors[0].split()[-1])[:3].upper() or 'UNK'
  location="Children's Room" if shelf=='E' else 'Juvenile Fiction' if shelf=='J FIC' else 'Juvenile Nonfiction' if shelf=='J' else 'Young Adult' if audience=='Teen' else 'Fiction Stacks' if shelf=='FIC' else 'Nonfiction'
  # A selected local print holding; no claim of a specific edition/ISBN or digital license.
  e={'recordId':f"CAT-{100000+int(re.search(r'OL(\d+)W',key).group(1))}",'title':title,'author':author,'year':year,'genre':section,'format':'Print Book','isFiction':isfiction,'callNumber':f'{shelf} {last}','location':location,'audience':audience,'subjects':subjects[:18],'description':'Subjects: '+('; '.join(subjects[:5]) if subjects else section)+'.','sourceUrl':'https://openlibrary.org'+key,'sourceWorkId':key,'publicationYearType':'First publication year reported by Open Library','provenance':'Open Library work metadata; SPL local selection and shelving'}
  entries.append(e);seen_keys.add(key);seen_pairs.add(pair);seen_titles.add(tk)
# Retain enriched core records in the resulting array.
entries[:len(core)]=core
# Copy-level accession records are separate from bibliographic works.
policy=json.loads((ROOT/'scripts/catalog-holdings-policy.json').read_text())
popular={titlekey(t) for t in policy['popularTitles']}
for e in entries:
 e['copies']=[]
 if e['format'] not in ['Print Book','Large Print','DVD','Blu-ray']:
  continue
 number=int(e['recordId'].split('-')[1]);is_popular=titlekey(e['title']) in popular
 count=(12 if (e['title'].casefold().startswith('harry potter and ') and 'rowling' in e['author'].casefold()) else policy['youthPopularCopies'] if e['audience'].startswith('Children') else policy['popularCopies']) if is_popular or (e['title'].casefold().startswith('harry potter and ') and 'rowling' in e['author'].casefold()) else (2 if number%11==0 else 1)
 e['copyAllocation']='Popular title' if is_popular else 'General collection'
 # Retired copy history predates the replacement and excludes brand-new works.
 retired=(is_popular or number%53==0) and e['year']<=2024
 acquisition=f"{min(2026,max(2020,e['year']))}-03-01"
 if retired:
  status='lost' if number%2 else 'withdrawn'
  e['copies'].append({'itemId':e['recordId']+'-I000','copyNumber':0,'status':status,'acquiredOn':acquisition,'retiredOn':'2025-06-04','reason':'Missing after inventory review' if status=='lost' else 'Physical wear; binding and pages damaged','replacedBy':e['recordId']+'-I001'})
 for n in range(1,count+1):
  copy={'itemId':e['recordId']+f'-I{n:03d}','copyNumber':n,'status':'active','acquiredOn':'2025-06-11' if retired and n==1 else acquisition}
  if retired and n==1:copy['replaces']=e['recordId']+'-I000'
  e['copies'].append(copy)
import importlib.util
_spec=importlib.util.spec_from_file_location('circulation_builder', ROOT/'scripts/build-circulation-history.py')
_history=importlib.util.module_from_spec(_spec);_spec.loader.exec_module(_history)
circulation_manifest=_history.build_history(entries)
(ROOT/'pericles/knowledge/circulation-summaries.json').write_text(json.dumps({'asOf':circulation_manifest['asOf'],'records':{e['recordId']:e.pop('circulation') for e in entries}},ensure_ascii=False,separators=(',',':'))+'\n')
manifest={'circulation':circulation_manifest,'source':'Open Library Search API','sourceDocumentation':'https://openlibrary.org/dev/docs/api/search','licensing':'https://openlibrary.org/developers/licensing','snapshotDate':'2026-11-08','records':len(entries),'coreRecords':len(core),'importedRecords':len(entries)-len(core),'queries':queries,'genres':dict(sorted(collections.Counter(e['genre'] for e in entries).items())),'audiences':dict(collections.Counter(e['audience'] for e in entries)),'inventoryAsOf':policy['asOf'],'activeCopies':sum(c['status']=='active' for e in entries for c in e['copies']),'retiredCopies':sum(c['status']!='active' for e in entries for c in e['copies']),'multicopyTitles':sum(sum(c['status']=='active' for c in e['copies'])>1 for e in entries),'notes':['One imported record per selected work; no generated copy multiplication. Two retained core Lightning Thief records represent Ebook and Audiobook versions of the same work.','Imported titles, authors, subjects and first-publication years come from the stored source responses. Descriptions summarize subject headings, not invented plot summaries.','Call numbers, shelf locations and selection of print holdings are local SPL assignments. Imported records do not establish an edition, ISBN, reading level, digital license, physical stock or live availability.','Original 104 record IDs are retained. Imported IDs are deterministically derived from Open Library work IDs.','Unknown dates, authors and invalid work identifiers are excluded; title normalization conservatively collapses duplicates.']}
(ROOT/'scripts/catalog-sources/manifest.json.tmp').write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n')
(ROOT/'catalog-data.js').write_text('// Bibliographic snapshot; rebuild with python3 scripts/build-catalog.py.\nconst CATALOG_SEED_ENTRIES = '+json.dumps(entries,ensure_ascii=False,separators=(',',':'))+';\nconst CATALOG_ENTRIES = CATALOG_SEED_ENTRIES.map(entry => ({...entry, searchIndex: [entry.title,entry.author,entry.callNumber,entry.genre,entry.format,entry.audience,entry.location,...entry.subjects].join(" ").toLowerCase()}));\n')
(ROOT/'scripts/catalog-manifest.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n')
(CACHE/'manifest.json.tmp').unlink()
print(json.dumps({k:manifest[k] for k in ['records','coreRecords','importedRecords','audiences','genres']},indent=2,ensure_ascii=False))
