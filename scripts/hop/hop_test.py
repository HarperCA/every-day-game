"""顺链找原文（跳转搜索）测试工具。

给一个起点页面（通常是学校转发的赛事通知），顺着页面里的链接往外跳，
看能不能找到赛事的官方原文（主办方通知、赛事官网、官方附件）。

只读：不写库，不改任何线上数据。只用 Python 标准库，服务器上不用额外安装。

用法：
    python3 hop_test.py cases.json [输出.json]

cases.json 是一个列表，每项 {"name": 标题, "url": 起点网址, "from": 备注}。

判断规则（这一版只用规则，不用 AI）：
    1. 从起点标题推出上级赛事名称，例如
       “关于开展第八届全国大学生混凝土材料设计大赛校内选拔赛的通知” → “全国大学生混凝土材料设计大赛”
    2. 起点页面里的链接打分：外部官方域名、文字有“官网/原文/通知/附件”或赛事名称的加分；
       本校的导航、新闻链接不跟
    3. 最多跟两层、每个起点最多打开 6 个页面；遵守 robots.txt，同一网站两次访问间隔 1.5 秒
    4. 跟到的页面：不在起点学校的网站上，且标题或正文开头出现赛事名称 → 判为“疑似官方原文”
"""
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from html.parser import HTMLParser

USER_AGENT = 'competition-crawler/1.0 (+admin source verification; respects robots.txt)'
TIMEOUT = 20
HOST_DELAY = 1.5
MAX_PAGES = 6

# 不跟的网站：公众号、在线文档、问卷、社交平台（不是官方原文，或者抓不到）
SKIP_HOSTS = re.compile(r'(weixin\.qq\.com|kdocs\.cn|wjx\.(cn|top)|docs\.qq\.com|zhihu\.com|bilibili\.com|weibo\.com|baidu\.com|beian\.miit\.gov\.cn|beian\.gov\.cn)$')
# 页脚、导航这类链接文字：备案号、版权、登录、网站地图……不跟
SKIP_TEXT = re.compile(r'ICP|备案|公网安备|版权|网站地图|登录|注册账号|联系我们|English|首页$')
ATTACHMENT = re.compile(r'\.(pdf|docx?|xlsx?|zip|rar)(\?|$)', re.I)
OFFICIAL_WORDS = re.compile(r'官网|官方网站|原文|组委会|大赛网站|竞赛网站|赛事网站|报名系统|报名平台')
NOTICE_WORDS = re.compile(r'通知|章程|规程|办法|指南|公告|方案')


# ---------- 抓取 ----------

_robots = {}
_last_visit = {}


def allowed_by_robots(url):
    """robots.txt 不允许的不抓；robots.txt 取不到按惯例视为允许。"""
    parts = urllib.parse.urlsplit(url)
    origin = f'{parts.scheme}://{parts.netloc}'
    if origin not in _robots:
        parser = urllib.robotparser.RobotFileParser()
        try:
            request = urllib.request.Request(origin + '/robots.txt', headers={'User-Agent': USER_AGENT})
            with urllib.request.urlopen(request, timeout=8) as response:
                body = response.read(200_000).decode('utf-8', 'replace')
            # 有的网站拿首页冒充 robots.txt，那不是真的规则
            parser.parse([] if '<html' in body.lower() else body.splitlines())
        except Exception:
            parser.parse([])
        _robots[origin] = parser
    return _robots[origin].can_fetch(USER_AGENT, url)


def wait_for_host(host):
    """同一网站两次访问至少间隔 HOST_DELAY 秒，别给对方服务器添压力。"""
    last = _last_visit.get(host, 0)
    gap = time.time() - last
    if gap < HOST_DELAY:
        time.sleep(HOST_DELAY - gap)
    _last_visit[host] = time.time()


def decode_html(raw, content_type):
    """按响应头或 <meta charset> 解码；都没写就先试 UTF-8，不行再用 GB18030（兼容 GBK/GB2312）。"""
    charset = re.search(r'charset=([\w-]+)', content_type or '', re.I)
    if not charset:
        charset = re.search(rb'<meta[^>]+charset=["\']?([\w-]+)', raw[:3000], re.I)
    name = (charset.group(1).decode() if isinstance(charset.group(1), bytes) else charset.group(1)) if charset else ''
    if name.lower() in ('gb2312', 'gbk', 'gb18030'):
        return raw.decode('gb18030', 'replace')
    try:
        return raw.decode(name or 'utf-8')
    except (UnicodeDecodeError, LookupError):
        return raw.decode('gb18030', 'replace')


def fetch(url):
    """返回 {'status', 'url'(跳转后的真实网址), 'type', 'html'}。"""
    url = urllib.parse.quote(url, safe=':/?&=%#+@,;~')   # 网址里的中文要先编码
    host = urllib.parse.urlsplit(url).hostname or ''
    if not allowed_by_robots(url):
        return {'status': 'robots 不允许', 'url': url}
    wait_for_host(host)
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept-Language': 'zh-CN,zh;q=0.9'})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            content_type = response.headers.get('Content-Type', '')
            final_url = response.geturl()
            if 'html' not in content_type.lower():
                return {'status': 'ok', 'url': final_url, 'type': content_type.split(';')[0], 'html': ''}
            raw = response.read(5_000_000)
            return {'status': 'ok', 'url': final_url, 'type': 'text/html', 'html': decode_html(raw, content_type)}
    except urllib.error.HTTPError as error:
        return {'status': f'HTTP {error.code}', 'url': url}
    except Exception as error:
        reason = getattr(error, 'reason', error)
        return {'status': f'打不开（{str(reason)[:40]}）', 'url': url}


# ---------- 解析页面 ----------

class PageParser(HTMLParser):
    """取出标题、正文文字、所有链接（链接文字 + 真实网址）。"""

    def __init__(self, base_url):
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.title = ''
        self.text_parts = []
        self.links = []
        self._in_title = False
        self._skip = 0          # 在 <script>/<style> 里面
        self._link = None       # 正在读的 <a>

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ('script', 'style'):
            self._skip += 1
        elif tag == 'title':
            self._in_title = True
        elif tag == 'a' and attrs.get('href'):
            href = attrs['href'].strip()
            if not re.match(r'(javascript|mailto|tel):|#', href, re.I):
                self._link = {'url': urllib.parse.urljoin(self.base_url, href), 'text': attrs.get('title') or ''}

    def handle_endtag(self, tag):
        if tag in ('script', 'style') and self._skip:
            self._skip -= 1
        elif tag == 'title':
            self._in_title = False
        elif tag == 'a' and self._link:
            self._link['text'] = re.sub(r'\s+', ' ', self._link['text']).strip()
            self.links.append(self._link)
            self._link = None

    def handle_data(self, data):
        if self._skip:
            return
        if self._in_title:
            self.title += data
        self.text_parts.append(data)
        if self._link is not None:
            self._link['text'] += data

    @property
    def text(self):
        return re.sub(r'\s+', ' ', ' '.join(self.text_parts)).strip()


def parse(html, url):
    parser = PageParser(url)
    try:
        parser.feed(html)
    except Exception:
        pass
    links = parser.links
    # 正文里直接写出来的网址（没做成链接的），也当作链接
    for found in re.findall(r'https?://[^\s<>"\'，。；、）)】]+', parser.text):
        links.append({'url': found.rstrip('.'), 'text': '（正文中的网址）'})
    return parser.title.strip(), parser.text, links


# ---------- 赛事名称与链接打分 ----------

def contest_name(title):
    """从“关于开展第八届……大赛校内选拔赛的通知”里取出上级赛事名称。

    返回 (完整名称, 去掉届次年份的核心名称)。
    """
    name = re.split(r'\s*[|｜_]\s*', title)[0]                     # 去掉“ | 今日哈工大”这类站名
    name = re.sub(r'^【[^】]*】', '', name)
    name = re.sub(r'^关于(?:组织|开展|举办|参加|做好|转发|启动)*(?:参加)?', '', name)
    name = re.sub(r'(?:的)?(?:报名|参赛|选拔|预选|初赛|校赛|校内选拔赛|校园预选赛)*(?:的)?(?:通知|公告)$', '', name)
    name = re.sub(r'(?:校内选拔赛|校园预选赛|校赛|选拔赛|预选赛|选拔|初赛)$', '', name)
    # 去掉后缀的学校名：“……竞赛河南城建学院” → “……竞赛”
    name = re.sub(r'(竞赛|大赛|挑战赛|比赛)[一-龥]{2,10}(?:大学|学院)(?:校内)?$', r'\1', name)
    # 去掉前缀的学校或学院名：“武汉大学第十五届……”“土木工程学院“第十届……”
    name = re.sub(r'^[一-龥]{2,10}(?:大学|学院)(?=\s*[“"]?\s*(?:第|20\d\d))', '', name)
    name = re.sub(r'活动$', '', name).strip(' “”"')
    core = re.sub(r'^(?:\d{4}\s*年)?\s*(?:第[一二三四五六七八九十百\d]+届)?', '', name.strip(' “”"'))
    core = re.sub(r'[“”"「」]', '', core).strip().rstrip('的')
    return name, core


def name_keys(title, core):
    """用来在页面里认出这项赛事的几个关键词：
    引号里的冠名（“斯维尔杯”）、去掉“全国/大学生”等通用前缀后的主体（“服务外包创新应用大赛”）。"""
    keys = [k for k in re.findall(r'[“"「]([^”"」]{3,12})[”"」]', title) if not re.search(r'学院|大学', k)]
    body = re.sub(r'^.*?杯', '', core) or core            # 冠名已单独作为一个关键词
    body = re.sub(r'^(?:全国|中国|国际)?(?:高等院校|高校|普通高校)?(?:大学生|研究生|学生)?', '', body)
    body = re.sub(r'^[一-龥]{2,3}(?:省|市|自治区)(?:大学生|高校|研究生)?', '', body)
    keys += [body[:8]] if len(body) >= 4 else []
    return [k for k in dict.fromkeys(keys) if k]


def mentions(text, keys):
    return any(key in text for key in keys)


def registrable_domain(host):
    """hit.edu.cn、ccpa.com.cn、moe.gov.cn 这种“主域名”，用来判断是不是同一家单位的网站。"""
    labels = (host or '').lower().split('.')
    if len(labels) >= 3 and labels[-1] == 'cn' and labels[-2] in ('edu', 'gov', 'com', 'org', 'net', 'ac'):
        return '.'.join(labels[-3:])
    return '.'.join(labels[-2:])


def score_link(link, start_domain, keys):
    """分数越高越可能通向官方原文；3 分以下不跟。"""
    url, text = link['url'], link['text']
    host = urllib.parse.urlsplit(url).hostname or ''
    if not url.startswith('http') or SKIP_HOSTS.search(host) or SKIP_TEXT.search(text):
        return -1, '跳过'
    same_site = registrable_domain(host) == start_domain
    attachment = bool(ATTACHMENT.search(url))
    in_body = text == '（正文中的网址）'
    named = mentions(text, keys)
    official = bool(OFFICIAL_WORDS.search(text))
    score, why = 0, []
    if not same_site:
        # 外部链接本身不说明什么（页脚友情链接也是外部的），要和赛事名、“官网”或正文网址一起出现才加重分
        score += 5 if (named or official or in_body) else 1
        why.append('外部网站')
    if named:
        score += 3; why.append('文字含赛事名')
    if official:
        score += 3; why.append('文字含官网/原文')
    if in_body:
        score += 2; why.append('正文直接写出的网址')
    if NOTICE_WORDS.search(text):
        score += 1; why.append('文字含通知类词')
    if attachment:
        score += 2; why.append('附件')
    if same_site and not attachment and not named:
        score -= 10; why.append('本校普通链接')
    return score, '、'.join(why)


def judge(page_title, page_text, page_url, start_domain, keys):
    """跟到的页面像不像官方原文。"""
    host = urllib.parse.urlsplit(page_url).hostname or ''
    if registrable_domain(host) == start_domain:
        return '起点学校自己的页面'
    head = page_title + ' ' + page_text[:6000]
    if mentions(head, keys):
        return '疑似官方原文' if NOTICE_WORDS.search(head) else '疑似赛事官网'
    return '无关或无法确认'


# ---------- 主流程 ----------

def hop(case):
    start = fetch(case['url'])
    result = {'起点': case['name'], '起点网址': case['url'], '来源': case.get('from', ''), '步骤': []}
    if start['status'] != 'ok' or not start.get('html'):
        result['结论'] = f"起点打不开：{start['status']}"
        return result
    title, _, links = parse(start['html'], start['url'])
    full, core = contest_name(case['name'] or title)
    keys = name_keys(case['name'] or title, core)
    result['推出的赛事名'] = core
    result['识别关键词'] = keys
    start_domain = registrable_domain(urllib.parse.urlsplit(start['url']).hostname)

    ranked = sorted(({**link, 'score': s, 'why': w} for link in links for s, w in [score_link(link, start_domain, keys)] if s >= 3),
                    key=lambda item: -item['score'])
    seen, queue, opened = {start['url']}, [(item, 1) for item in ranked[:3]], 1
    while queue and opened < MAX_PAGES:
        link, depth = queue.pop(0)
        if link['url'] in seen:
            continue
        seen.add(link['url'])
        page = fetch(link['url'])
        opened += 1
        step = {'层': depth, '链接文字': link['text'][:40], '网址': link['url'], '打分理由': link['why'], '状态': page['status']}
        if page['status'] == 'ok' and page.get('html'):
            page_title, page_text, page_links = parse(page['html'], page['url'])
            step['页面标题'] = page_title[:60]
            step['判断'] = judge(page_title, page_text, page['url'], start_domain, keys)
            # 第二层：只在这个外部网站内部继续找带赛事名或通知字样的链接
            if depth == 1 and step['判断'] != '起点学校自己的页面':
                page_domain = registrable_domain(urllib.parse.urlsplit(page['url']).hostname)
                inner = [l for l in page_links if registrable_domain(urllib.parse.urlsplit(l['url']).hostname) == page_domain
                         and mentions(l['text'], keys) and not SKIP_TEXT.search(l['text'])]
                queue.extend(({**l, 'why': '官方网站内的相关链接'}, 2) for l in inner[:2])
        elif page['status'] == 'ok':
            step['判断'] = f"附件（{page.get('type')}），本测试不读附件内容；链接文字{'含' if mentions(link['text'], keys) else '不含'}赛事名"
        result['步骤'].append(step)

    hits = [s for s in result['步骤'] if str(s.get('判断', '')).startswith('疑似')]
    result['结论'] = f"找到 {len(hits)} 个疑似官方页面" if hits else ('起点页面里没有值得跟的链接' if not ranked else '跟了链接，但没找到官方原文')
    return result


def main():
    cases = json.load(open(sys.argv[1], encoding='utf-8'))
    out_file = sys.argv[2] if len(sys.argv) > 2 else 'hop-result.json'
    results = []
    for index, case in enumerate(cases, 1):
        result = hop(case)
        results.append(result)
        print(f"\n[{index}/{len(cases)}] {case['name'][:40]}")
        print(f"  推出的赛事名：{result.get('推出的赛事名', '')}　关键词：{result.get('识别关键词', '')}　结论：{result['结论']}")
        for step in result['步骤']:
            print(f"   第{step['层']}层 {step.get('判断', step['状态'])}｜{step.get('页面标题') or step['链接文字']}｜{step['网址'][:90]}")
    json.dump(results, open(out_file, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    found = sum(1 for r in results if r['结论'].startswith('找到'))
    print(f'\n共 {len(results)} 个起点，找到疑似官方页面的 {found} 个。结果写入 {out_file}')


if __name__ == '__main__':
    main()
