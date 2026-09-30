"""辽宁省大学生创新创业管理共享平台（cxcy.upln.cn，辽宁省教育厅主办）读取脚本。

这个平台的网页靠脚本加载，直接抓网页只能拿到“正在加载”的空壳；但它有公开的数据接口，不用登录：
    赛事列表  /provincial/match/competition/queryOngoing?year=<年>&code=<1 进行中 / 0 未开始>
    赛事详情  /provincial/match/competition/detail?id=<编号>
平台只接受国内访问，所以经腾讯云开发上海的网页中转（pageRelay）去取。

输出和天池、DataFountain 抓取器一样格式的候选文件，交给每晚流水线判重、前置筛选、抽取、入库。
注意：平台上的 startTime / endTime 只作为“平台显示的起止时间”写进正文和 platformTimes，
不填进报名日期——它说不清是报名还是比赛时间；报名日期只用附件通知原文里抽出来、带引文的。

只用 Python 标准库。用法：python3 upln.py --out 候选文件.json [--year 2026]
"""
import argparse
import base64
import datetime
import html
import json
import os
import re
import sys
import time
import urllib.request

BASE = 'https://cxcy.upln.cn/provincial/match/competition'
PUBLIC_PAGE = 'https://cxcy.upln.cn/match/details?comId='
FILE_URL = 'https://cxcy.upln.cn/provincial/file/fileInfo/downLoad?id='
CODES = {'1': '进行中', '0': '未开始'}
CONFIG_DIR = os.environ.get('RELAY_DIR', '/opt/daily-contest')


def read_config(name, env):
    if os.environ.get(env):
        return os.environ[env].strip()
    try:
        with open(os.path.join(CONFIG_DIR, name), encoding='utf-8') as file:
            return file.read().strip()
    except OSError:
        return ''


ENDPOINT = read_config('.relay-endpoint', 'RELAY_ENDPOINT')
SECRET = read_config('.relay-secret', 'RELAY_SECRET')


def relay_json(url, retries=2):
    """经中转取一个 JSON 接口；平台偶尔域名解析失败，失败时重试。"""
    last = ''
    for attempt in range(retries + 1):
        request = urllib.request.Request(ENDPOINT, data=json.dumps({'url': url, 'secret': SECRET}).encode('utf-8'),
                                         headers={'content-type': 'application/json'}, method='POST')
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                data = json.load(response)
        except Exception as error:
            last = f'中转调用失败：{error}'
            time.sleep(2)
            continue
        if data.get('status') != 'ok' or not data.get('bodyBase64'):
            last = f"{data.get('status')} {data.get('error', '')}".strip()
            time.sleep(2)
            continue
        payload = json.loads(base64.b64decode(data['bodyBase64']).decode('utf-8'))
        if not payload.get('success'):
            raise RuntimeError(f"平台返回失败：{payload.get('message')}")
        return payload.get('result')
    raise RuntimeError(f'取不到 {url}：{last}')


def plain(value):
    """详情正文是网页片段：去掉标签、还原 &mdash; 之类的转义，免得抽取引文里带乱码。"""
    text = re.sub(r'<(br|/p|/div|/li)[^>]*>', '\n', str(value or ''), flags=re.I)
    text = html.unescape(re.sub(r'<[^>]+>', '', text))
    return re.sub(r'\n\s*\n+', '\n', text).strip()


def candidate_from(detail, list_item, state):
    organizer = '；'.join(filter(None, [
        f"主办：{detail.get('host')}" if detail.get('host') else '',
        f"协办：{detail.get('coOrganizer')}" if detail.get('coOrganizer') else '',
        f"承办：{detail.get('undertakeName')}" if detail.get('undertakeName') else '',
    ]))
    files = [f"{item.get('name') or item.get('fileName') or '附件'}（{FILE_URL}{item.get('id')}）" for item in (detail.get('fileList') or []) if item.get('id')]
    intro = '\n'.join(filter(None, [
        f"辽宁省大学生创新创业管理共享平台（辽宁省教育厅）赛事，状态：{state}。",
        f"简介：{plain(detail.get('synopsis'))}" if detail.get('synopsis') else '',
        f"平台显示的起止时间：{detail.get('startTime') or '未写'} 至 {detail.get('endTime') or '未写'}（需对照通知原文确认是报名时间还是比赛时间）",
        f"正文：{plain(detail.get('detail'))}" if detail.get('detail') else '',
        ('附件：' + '；'.join(files)) if files else '',
    ]))
    return {
        'externalId': f"upln-{detail['id']}",
        'name': detail.get('name') or list_item.get('name'),
        'seriesName': None,
        'detailUrl': f"{BASE}/detail?id={detail['id']}",
        'publicPageUrl': f"{PUBLIC_PAGE}{detail['id']}",
        'introduction': intro[:4000],
        'tags': ['辽宁省', '省级平台'],
        'organizer': organizer,
        # 平台的 startTime / endTime 说不清是报名还是比赛时间，不直接当报名日期；只在正文里列出，日期以附件原文抽取为准
        'registration_start': None,
        'registration_end': None,
        'platformTimes': {'start': detail.get('startTime'), 'end': detail.get('endTime')},
        'competition_start': None,
        'competition_end': None,
        'region': '辽宁省',
        'lifecycle': state,
        'editionYear': detail.get('year'),
        'attachments': files,
        # 结构化的附件清单，读详情时下载 PDF / Word 读出正文（run-extract.mjs 的 platformText）
        'attachmentFiles': [{'name': item.get('name') or item.get('fileName') or '附件', 'url': f"{FILE_URL}{item.get('id')}"}
                            for item in (detail.get('fileList') or []) if item.get('id')],
        'evidence': {'source': '辽宁省大学生创新创业管理共享平台', 'url': f"{BASE}/detail?id={detail['id']}", 'api': True,
                     'fetchedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()},
        'needsReview': ['registration_start', 'registration_end', 'eligibility', 'fees', 'professions'],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    parser.add_argument('--year', default=str(datetime.date.today().year))
    parser.add_argument('--pages', default='0')   # 流水线统一传的参数，这里用不上
    args = parser.parse_args()
    if not ENDPOINT or not SECRET:
        raise SystemExit('没有配置网页中转（.relay-endpoint / .relay-secret），无法访问辽宁平台')

    candidates, failures, seen = [], [], set()
    for code, state in CODES.items():
        records, page = [], 1
        # 列表接口每页默认 10 条；一次要太多会超时，所以按页翻
        while True:
            try:
                result = relay_json(f'{BASE}/queryOngoing?year={args.year}&code={code}&pageNo={page}&pageSize=10') or {}
            except Exception as error:
                failures.append({'stage': f'列表（{state}）第{page}页', 'error': str(error)[:200]})
                break
            records.extend(result.get('records', []))
            if not result.get('records') or len(records) >= int(result.get('total') or 0) or page >= 20:
                break
            page += 1
            time.sleep(0.5)
        for item in records:
            if item['id'] in seen:
                continue
            seen.add(item['id'])
            try:
                detail = relay_json(f"{BASE}/detail?id={item['id']}")
                candidates.append(candidate_from(detail, item, state))
            except Exception as error:
                failures.append({'stage': '详情', 'name': item.get('name'), 'error': str(error)[:200]})
            time.sleep(0.5)

    output = {'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'source': 'upln',
              'listApi': f'{BASE}/queryOngoing', 'failures': failures, 'candidateCount': len(candidates), 'candidates': candidates}
    with open(args.out, 'w', encoding='utf-8') as file:
        json.dump(output, file, ensure_ascii=False, indent=1)
    print(f'辽宁平台：{len(candidates)} 场（进行中 + 未开始），失败 {len(failures)}，写入 {args.out}')


if __name__ == '__main__':
    try:
        main()
    except SystemExit:
        raise
    except Exception as error:
        print(f'辽宁平台读取失败：{error}', file=sys.stderr)
        sys.exit(1)
