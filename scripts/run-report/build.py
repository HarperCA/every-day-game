# 生成某一轮抓取的逐条明细页：每条搜索结果从脚本内筛选、判重、前置筛选、读详情页到入库的去向。
# 用法：python build.py <运行目录（含 baidu-candidates.json 等）> [输出 html]
import json, os, sys
from collections import Counter

RUN = sys.argv[1] if len(sys.argv) > 1 else '.'
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(RUN, 'run-report.html')
HERE = os.path.dirname(os.path.abspath(__file__))

L = lambda f: json.load(open(os.path.join(RUN, f), encoding='utf-8'))
baidu = L('baidu-candidates.json')
jev = L('jev-filter-report.json')
formal = L('formal-notices.json')['candidates']
combined = L('combined-candidates.json')['candidates']
extracted = L('combined-extracted.json')['results']
leads = L('notice-resolution-leads.json')['results']
followup = L('notice-followup-filter-report.json')
ingest = L('ingest-report.json')

KIND = {'repost_or_school_selection': '转载或校内选拔', 'news_or_result': '新闻或赛果', 'unrelated': '与赛事无关',
        'organizer_notice': '主办方通知', 'competition_site': '赛事官网', 'registration_entry': '报名入口', 'directory_lead': '目录清单'}
ACTION = {'fetch': '放行读正文', 'review': '低置信度，只留线索', 'lead': '只留线索', 'reject': '拦截'}

dec = {d['url']: d for d in jev['decisions']}
formal_urls = {c['detailUrl'] for c in formal}
lead_by_notice = {r['noticeUrl']: r for r in leads}
combined_urls = {c['detailUrl'] for c in combined}
ext_by_url = {r['url']: r for r in extracted}

rows = []
for c in baidu['candidates']:
    u = c['detailUrl']
    d = dec.get(u)
    row = {'q': c.get('matchedQuery', ''), 'route': (c.get('discovery') or {}).get('route', ''),
           't': c['name'], 'u': u, 'intro': (c.get('introduction') or '')[:160]}
    if not d:
        row.update(dup='已在库或疑似重复', jev='', kind='', reason='判重时与库里已有赛事重名或疑似重名，本轮跳过', final='判重跳过', stage=1)
    else:
        row.update(dup='新', jev=ACTION.get(d['action'], d['action']), kind=KIND.get(d['kind'], d['kind']),
                   reason=d.get('reason') or '', conf=d.get('confidence'))
        if u in formal_urls:
            r = lead_by_notice.get(u, {})
            n = len(r.get('leads') or [])
            row.update(final=f'转入通知追溯（找到 {n} 个待核验页面）', stage=3)
        elif u in combined_urls:
            e = ext_by_url.get(u, {})
            row.update(final='读了详情页，未入库' if e.get('ok') else f'读详情页失败（{e.get("status") or e.get("error") or "未知"}）', stage=4)
        elif d['action'] == 'fetch':
            row.update(final='放行但未读正文（标题含通知，未进入前10条追溯）', stage=2)
        elif d['action'] == 'reject':
            row.update(final='前置筛选拦截', stage=2)
        else:
            row.update(final='只留作线索，未入库', stage=2)
    rows.append(row)

# 2026-09-26 起搜索脚本逐条记录丢弃的结果；更早的运行只有数量。
for d in baidu.get('dropped', []):
    rows.append({'q': d['query'], 'route': d.get('route', ''), 't': d['title'], 'u': d['url'], 'intro': d.get('snippet', ''),
                 'dup': '', 'jev': '', 'kind': '', 'reason': d.get('reasonText', d['reason']), 'final': f"搜索脚本丢弃（{d.get('reasonText', d['reason'])}）", 'stage': 1})

per_query = [{'q': p['query'], 'route': p.get('route', ''), 'refs': p['references'], 'out': p['outOfScope'], 'irr': p['irrelevant'],
              'dupRun': p['duplicate'], 'cand': p['candidates']} for p in baidu['perQuery']]
summary = {
    'refs': baidu['stats']['referencesTotal'], 'queries': baidu['stats']['queries'], 'cands': len(baidu['candidates']),
    'dropped': baidu['stats']['referencesTotal'] - len(baidu['candidates']), 'droppedLogged': len(baidu.get('dropped', [])),
    'out': sum(p['out'] for p in per_query), 'irr': sum(p['irr'] for p in per_query), 'dupRun': sum(p['dupRun'] for p in per_query),
    'known': baidu['stats'].get('knownSourceSkipped', 0),
    'new': len(jev['decisions']), 'jev': Counter(d['action'] for d in jev['decisions']),
    'formal': len(formal), 'followupPages': followup.get('total'), 'followupFetch': followup.get('fetch'),
    'detail': len(combined), 'extractOk': sum(1 for e in extracted if e.get('ok')), 'added': ingest.get('added'),
    'fail': ingest.get('failureReasons') or {},
}
notice_rows = [{'t': r['noticeTitle'], 'u': r['noticeUrl'], 'name': r.get('proposedName'), 'q': r.get('followupQuery'),
                'leads': [{'t': l.get('title'), 'u': l.get('url')} for l in (r.get('leads') or [])]} for r in leads]

data = json.dumps({'rows': rows, 'perQuery': per_query, 'summary': summary, 'notices': notice_rows}, ensure_ascii=False)
tpl = open(os.path.join(HERE, 'page.html'), encoding='utf-8').read()
open(OUT, 'w', encoding='utf-8').write(tpl.replace('__DATA__', data.replace('</', '<\\/')))
print(OUT, len(rows), summary['jev'])
