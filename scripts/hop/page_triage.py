"""按页面结构给“标题不像一场比赛”的搜索结果分流（试验工具）。

不看标题里有什么字，只看页面长什么样：
    栏目/列表页   大量同网站、文字较长、带日期的链接整齐排列，页面文字大多在链接里   → 信源线索（这一页）
    文章页       有一大段连续正文，链接零星                                     → 拦下；它所在的栏目（顶部导航路径）记为信源线索
    功能/平台页   正文很少，有表单、输入框                                        → 拦下（不是赛事页面）
    门户首页     链接很多但正文、列表都不集中                                     → 信源线索（低优先级）
    无法判断     打不开、被 robots 禁止、靠脚本加载的空壳                          → 不丢弃，低优先级留着

线索只是“待观察”：以后由主办方监测去定期打开，真发了赛事通知的才升级进信源表，
长期没有的自动淘汰——用结果说话，而不是事先按名字猜哪个栏目有用。

只读、只用 Python 标准库。用法：python3 page_triage.py cases.json [输出.json]
cases.json：[{"name": 标题, "url": 网址}, ...]
"""
import json
import re
import sys
import urllib.parse
from html.parser import HTMLParser

from hop_test import fetch, registrable_domain

DATE = re.compile(r'(19|20)\d{2}\s*[-/.年]\s*\d{1,2}(\s*[-/.月]\s*\d{1,2})?|\b\d{1,2}[-/]\d{1,2}\b')
BLOCK_TAGS = {'p', 'div', 'li', 'tr', 'td', 'br', 'h1', 'h2', 'h3', 'h4', 'section', 'article', 'dd', 'dt', 'table', 'ul', 'ol'}
BREADCRUMB_SEP = re.compile(r'^\s*(>|»|›|＞|/|->|→)\s*$')

# 阈值由回放数据定，见文件末尾的说明输出
LIST_MIN_LINKS = 8          # 至少这么多条“像标题的带日期链接”才算列表
LIST_MIN_LINK_RATIO = 0.35  # 页面文字里链接文字的占比
ARTICLE_MIN_PARAGRAPH = 250 # 最长一段连续正文（字）
EMPTY_TEXT = 80             # 正文少于这个字数视为空壳


class StructureParser(HTMLParser):
    def __init__(self, base_url):
        super().__init__(convert_charrefs=True)
        self.base = base_url
        self.skip = 0
        self.in_link = None
        self.links = []          # {url, text, trailing}
        self.text_len = 0
        self.link_text_len = 0
        self.run = ''            # 当前一段连续的非链接正文
        self.longest_run = 0
        self.forms = 0
        self.inputs = 0
        self.sequence = []       # 页面上依次出现的 ('link', idx) / ('text', 文字)，用来找导航路径

    def _end_run(self):
        self.longest_run = max(self.longest_run, len(re.sub(r'\s+', '', self.run)))
        self.run = ''

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ('script', 'style', 'noscript'):
            self.skip += 1
        elif tag == 'form':
            self.forms += 1
        elif tag in ('input', 'textarea', 'select') and attrs.get('type', 'text') not in ('hidden', 'submit', 'button', 'image'):
            self.inputs += 1
        elif tag == 'a' and attrs.get('href') and not re.match(r'(javascript|mailto|tel):|#', attrs['href'], re.I):
            self.in_link = {'url': urllib.parse.urljoin(self.base, attrs['href']), 'text': ''}
            self._end_run()
        if tag in BLOCK_TAGS:
            self._end_run()

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'noscript') and self.skip:
            self.skip -= 1
        elif tag == 'a' and self.in_link is not None:
            self.in_link['text'] = re.sub(r'\s+', ' ', self.in_link['text']).strip()
            self.in_link['trailing'] = ''
            self.links.append(self.in_link)
            self.sequence.append(('link', len(self.links) - 1))
            self.in_link = None
        if tag in BLOCK_TAGS:
            self._end_run()

    def handle_data(self, data):
        if self.skip:
            return
        compact = re.sub(r'\s+', '', data)
        self.text_len += len(compact)
        if self.in_link is not None:
            self.in_link['text'] += data
            self.link_text_len += len(compact)
            return
        self.run += data
        if compact:
            self.sequence.append(('text', data.strip()))
            # 紧跟在链接后面的文字（常见的日期位置）
            if self.links and len(self.links[-1]['trailing']) < 40:
                self.links[-1]['trailing'] += data.strip()


def breadcrumb_column(parser, page_url):
    """找页面顶部“首页 > 某栏目 > 正文”这样的导航路径，返回路径里最后一个栏目链接。"""
    seq = parser.sequence[:400]
    best = None
    i = 0
    while i < len(seq):
        chain = []
        j = i
        while j < len(seq) and seq[j][0] == 'link':
            link = parser.links[seq[j][1]]
            if len(link['text']) > 12:
                break
            chain.append(link)
            j += 1
            if j < len(seq) and seq[j][0] == 'text' and BREADCRUMB_SEP.match(seq[j][1]):
                j += 1
            else:
                break
        if len(chain) >= 2 and (best is None or len(chain) > len(best)):
            best = chain
        i = max(j, i + 1)
    if not best:
        return None
    host = registrable_domain(urllib.parse.urlsplit(page_url).hostname)
    column = best[-1]
    if registrable_domain(urllib.parse.urlsplit(column['url']).hostname) != host or column['url'].rstrip('/') == page_url.rstrip('/'):
        return None
    return {'url': column['url'], 'text': column['text'], 'path': ' > '.join(l['text'] for l in best)}


def triage(case):
    page = fetch(case['url'])
    result = {'标题': case['name'], '网址': case['url']}
    if page['status'] != 'ok':
        return {**result, '分类': '无法判断', '去向': '低优先级留着', '依据': f"打不开：{page['status']}"}
    if not page.get('html'):
        return {**result, '分类': '无法判断', '去向': '低优先级留着', '依据': f"不是网页（{page.get('type')}）"}
    parser = StructureParser(page['url'])
    try:
        parser.feed(page['html'])
    except Exception:
        pass
    parser._end_run()
    host = registrable_domain(urllib.parse.urlsplit(page['url']).hostname)
    same_site = [l for l in parser.links if registrable_domain(urllib.parse.urlsplit(l['url']).hostname) == host]
    list_links = [l for l in same_site if len(l['text']) >= 8 and (DATE.search(l['text']) or DATE.search(l['trailing']))]
    ratio = parser.link_text_len / parser.text_len if parser.text_len else 0
    metrics = {'正文字数': parser.text_len, '链接文字占比': round(ratio, 2), '带日期的标题链接': len(list_links),
               '最长连续正文': parser.longest_run, '输入框': parser.inputs}
    result['指标'] = metrics
    if parser.text_len < EMPTY_TEXT:
        return {**result, '分类': '无法判断', '去向': '低优先级留着', '依据': '正文几乎为空（可能靠脚本加载）'}
    if len(list_links) >= LIST_MIN_LINKS and ratio >= LIST_MIN_LINK_RATIO and parser.longest_run < ARTICLE_MIN_PARAGRAPH * 2:
        return {**result, '分类': '栏目/列表页', '去向': '信源线索', '线索网址': page['url'],
                '依据': f"{len(list_links)} 条带日期的标题链接，链接文字占 {round(ratio * 100)}%"}
    if parser.longest_run >= ARTICLE_MIN_PARAGRAPH:
        column = breadcrumb_column(parser, page['url'])
        return {**result, '分类': '文章页', '去向': '拦下' + ('；所在栏目记为信源线索' if column else ''),
                '线索网址': column['url'] if column else '', '导航路径': column['path'] if column else '',
                '依据': f"最长一段连续正文 {parser.longest_run} 字" + (f"，导航路径：{column['path']}" if column else '，没找到导航路径')}
    if parser.inputs >= 2 and parser.text_len < 1500:
        return {**result, '分类': '功能/平台页', '去向': '拦下', '依据': f"正文 {parser.text_len} 字，有 {parser.inputs} 个输入框"}
    if len(same_site) >= 30:
        return {**result, '分类': '门户首页', '去向': '信源线索（低优先级）', '线索网址': page['url'],
                '依据': f"{len(same_site)} 个站内链接，正文不集中"}
    return {**result, '分类': '其他', '去向': '拦下', '依据': '既不是列表也没有成段正文'}


def main():
    cases = json.load(open(sys.argv[1], encoding='utf-8'))
    out_file = sys.argv[2] if len(sys.argv) > 2 else 'triage-result.json'
    results = []
    for index, case in enumerate(cases, 1):
        try:
            result = triage(case)
        except Exception as error:
            result = {'标题': case['name'], '网址': case['url'], '分类': '无法判断', '去向': '低优先级留着', '依据': f'出错：{error}'}
        results.append(result)
        print(f"[{index}/{len(cases)}] {result['分类']:<6} {result['去向']:<14} {case['name'][:30]}｜{result['依据'][:60]}", flush=True)
    json.dump(results, open(out_file, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    counts = {}
    for r in results:
        counts[r['分类']] = counts.get(r['分类'], 0) + 1
    print('\n分类统计：', json.dumps(counts, ensure_ascii=False))


if __name__ == '__main__':
    main()
