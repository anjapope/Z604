"""Refresh a reproducible Open Library work-metadata snapshot (no book text)."""
import json,time,urllib.parse,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
CACHE=ROOT/'scripts/catalog-sources'
# Subject, SPL browsing section, local shelf prefix, audience.
TOPICS=[
('fantasy','Fantasy','FIC','Adult'),('science_fiction','Science Fiction','FIC','Adult'),('mystery','Mystery/Thriller','FIC','Adult'),('romance','Romance','FIC','Adult'),('historical_fiction','Historical Fiction','FIC','Adult'),('horror','Horror','FIC','Adult'),('literary_fiction','Literary Fiction','FIC','Adult'),('short_stories','Short Stories','FIC','Adult'),('poetry','Poetry','811','Adult'),('drama','Drama','812','Adult'),
('biography','Biography','920','Adult'),('memoir','Memoir','920','Adult'),('american_history','History','973','Adult'),('world_history','History','909','Adult'),('military_history','Military History','355','Adult'),('veterans','Veterans and Military Life','362.86','Adult'),('genealogy','Genealogy','929','Adult'),('indiana','Indiana and Regional History','977.2','Adult'),
('biology','Science & Nature','570','Adult'),('physics','Science & Nature','530','Adult'),('astronomy','Science & Nature','520','Adult'),('ecology','Environment','577','Adult'),('climate_change','Environment','363.738','Adult'),('mathematics','Mathematics','510','Adult'),('chemistry','Science & Nature','540','Adult'),('geology','Science & Nature','550','Adult'),
('computer_programming','Computing','005','Adult'),('artificial_intelligence','Computing','006.3','Adult'),('3d_printing','Making and Technology','621.988','Adult'),('engineering','Making and Technology','620','Adult'),('woodworking','Crafts and Hobbies','684','Adult'),('sewing','Crafts and Hobbies','646','Adult'),('gardening','Gardening','635','Adult'),('cooking','Cooking','641.5','Adult'),
('personal_finance','Personal Finance','332','Adult'),('small_business','Business','658','Adult'),('taxation','Tax and Government','336.2','Adult'),('careers','Careers','650.14','Adult'),('psychology','Psychology','150','Adult'),('mental_health','Health and Wellness','616.89','Adult'),('parenting','Parenting','649','Adult'),('autism','Disability and Accessibility','616.858','Adult'),('addiction','Health and Wellness','616.86','Adult'),
('philosophy','Philosophy','100','Adult'),('religion','Religion','200','Adult'),('sociology','Social Sciences','301','Adult'),('politics','Politics','320','Adult'),('civil_rights','Social Sciences','323','Adult'),('art','Art','700','Adult'),('music','Music','780','Adult'),('photography','Photography','770','Adult'),('sports','Sports','796','Adult'),('travel','Travel','910','Adult'),
('picture_books','Children','E','Children'),('juvenile_fiction','Children','J FIC','Children'),('juvenile_nonfiction','Children’s Nonfiction','J','Children'),('early_readers','Children','E','Children'),('young_adult_fiction','Young Adult','YA FIC','Teen'),('young_adult_nonfiction','Young Adult Nonfiction','YA','Teen'),('graphic_novels','Graphic Novels','741.5','Teen/Adult'),('classics','Classic Fiction','FIC','Adult')]
CACHE.mkdir(parents=True,exist_ok=True)
for n,(topic,genre,shelf,audience) in enumerate(TOPICS):
 p=CACHE/(topic+'.json')
 if p.exists():continue
 # Published works, English editions, bounded dates; no guessed publication dates.
 q=f'subject:{topic} language:eng first_publish_year:[1400 TO 2026]'
 url='https://openlibrary.org/search.json?'+urllib.parse.urlencode({'q':q,'limit':200,'fields':'key,title,author_name,first_publish_year,subject,language','lang':'en'})
 try:
  req=urllib.request.Request(url,headers={'User-Agent':'SPL-Classroom-Catalog/1.0 (bibliographic metadata import)'})
  with urllib.request.urlopen(req,timeout=25) as r:data=json.load(r)
  # Bound the snapshot to bibliographic fields we actually use.
  docs=[{k:v for k,v in d.items() if k in ['key','title','author_name','first_publish_year','subject','language']} for d in data.get('docs',[])]
  for d in docs:d['subject']=d.get('subject',[])[:30]
  p.write_text(json.dumps({'query':q,'url':url,'section':genre,'shelf':shelf,'audience':audience,'docs':docs},ensure_ascii=False,separators=(',',':')))
  print(f'{n+1}/{len(TOPICS)} {topic}: {len(docs)} works',flush=True)
 except Exception as e:print(f'FAILED {topic}: {e}',flush=True)
 time.sleep(1.05)
