import argparse,hashlib,json,sys
from pathlib import Path
from PIL import Image
root=Path(__file__).resolve().parents[1];base=root/'data/competition-posters'
p=argparse.ArgumentParser();p.add_argument('--require-complete',action='store_true');args=p.parse_args();doc=json.loads((base/'manifest.json').read_text(encoding='utf8'));rows=doc['entries'];errors=[];missing=[];seen=set();originals=0
if len(rows)!=doc['required_cover_count']:errors.append('记录总数与要求不一致')
def resolve_asset(value):
 path=(base/value).resolve()
 if not path.is_relative_to(base.resolve()):raise ValueError('素材路径越界')
 return path
for row in rows:
 sid=row['source_row']
 if sid in seen:errors.append(f'{sid}: 重复源行号')
 seen.add(sid)
 if not row.get('name') or (row.get('cover') and not row.get('edition')):errors.append(f'{sid}: 缺比赛名称或已配图记录缺届次')
 if not row.get('cover'):missing.append(sid);continue
 try:
  f=resolve_asset(row['cover'])
  with Image.open(f) as im:
   if im.size!=(1920,1080):errors.append(f'{sid}: 封面不是1920×1080')
   im.verify()
  if hashlib.sha256(f.read_bytes()).hexdigest()!=row['cover_sha256']:errors.append(f'{sid}: 封面校验值不符')
  if not row.get('source_page'):errors.append(f'{sid}: 缺来源页面')
  if row.get('original'):
   with Image.open(resolve_asset(row['original'])) as im:im.verify()
   originals+=1
  elif not row.get('page_screenshot') or not resolve_asset(row['page_screenshot']).is_file():errors.append(f'{sid}: 缺原图且没有网页截图证据')
 except Exception as e:errors.append(f'{sid}: {e}')
print(json.dumps({'total':len(rows),'confirmed':len(rows)-len(missing),'originals':originals,'missing':len(missing),'errors':errors,'coverage_complete':not missing},ensure_ascii=False,indent=2))
if errors or (args.require_complete and missing):sys.exit(1)
