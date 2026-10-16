"""Build the official 2026 undergraduate names and the project's search mapping.

Usage: python scripts/build-undergraduate-majors.py [--input PDF_OR_UTF8_TEXT]
Without --input, downloads the Ministry of Education PDF. PDF input requires
PyMuPDF. Categories below are product search categories, NOT official categories
or a claim that a student meets a competition's registration requirements.
"""
import argparse
import json
import re
import urllib.request
from pathlib import Path

PDF_URL = 'https://www.moe.gov.cn/srcsite/A08/moe_1034/s3882/202604/W020260427440749576927.pdf'
NOTICE_URL = 'https://www.moe.gov.cn/srcsite/A08/moe_1034/s3882/202604/t20260427_1434931.html'
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'apps/miniprogram/cloudfunctions/publicData/undergraduateMajors2026.json'
H, E, B, M, A, C, L, I, F, N, P, D = (
    '人文与法学', '外语与教育', '建筑与土木', '数学与统计',
    '机械与自动化', '材料与化工', '生物与医药', '电子信息',
    '经管与商科', '能源与环境', '计算机与AI', '设计与艺术')

# Exhaustive official professional-class mapping. Multiple categories represent
# substantive overlap, not an unrestricted search fallback.
CLASS_MAP = {}
for category, codes in [
    (H, '0101 0301 0302 0303 0304 0305 0306 0501 0503 0601'),
    (E, '0401 0402 0502'),
    (F, '0201 0202 0203 0204 1201 1202 1203 1204 1205 1206 1207 1208 1209'),
    (M, '0701 0712'), (I, '0702 0704 0803 0806 0807'),
    (C, '0703 0804 0813 0816 0817'),
    (N, '0705 0706 0707 0708 0709 0805 0814 0815 0822 0825 0829 0902 0905 0907'),
    (L, '0710 0901 0903 0904 0906 0826 0827 0830 1001 1002 1003 1004 1005 1006 1007 1008 1009 1010 1011'),
    (A, '0801 0802 0808 0818 0819 0820 0821 0823 0824'),
    (P, '0809'), (B, '0810 0811 0812 0828'),
    (D, '1301 1302 1303 1304 1305'),
]:
    for code in codes.split():
        CLASS_MAP[code] = [category]
CLASS_MAP['0711'] = [H, L]  # psychology: behavioural science / health
CLASS_MAP['0831'] = [H, I]  # policing technology; names refined below

# Explicit multidisciplinary exceptions. Codes are the current official codes;
# 2026 transferred cross-disciplinary majors use 14xxxx, not their former codes.
EXCEPTIONS = {
    '020102': [F, M], '020104T': [F, N], '020109T': [F, P],
    '020111T': [F, N], '020305T': [F, M], '020310T': [F, P],
    '040104': [E, P], '040105': [E, D], '040110TK': [E, L],
    '040111T': [E, L], '040117TK': [E, P], '040203': [E, F],
    '040205': [E, L], '040206T': [E, L], '040210TK': [E, F],
    '040211TK': [E, A], '040212TK': [E, F], '040213T': [E, L],
    '040215TK': [E, F], '040216T': [E, L], '040217TK': [E, A],
    '050103': [H, E], '050110T': [H, P],
    '0502104TK': [E, H], '0502105T': [E, H],
    '0502106TK': [E, P], '0502107TK': [E, P], '050302': [H, D], '050303': [H, D],
    '050306T': [H, P], '050307T': [H, D], '050308T': [H, D],
    '070102': [M, P], '070105TK': [M, P],
    '070201': [M, I], '070202': [M, I], '070203': [I, N], '070206T': [I, P],
    '070503': [N, B], '070504': [N, P], '070903T': [N, P],
    '071003': [L, P], '071204T': [M, L],
    '080205': [A, D], '080211T': [A, E], '080212T': [A, E],
    '080218T': [A, D, P], '080418T': [C, I], '080420T': [C, P],
    '080421T': [C, I], '080602T': [I, N], '080711T': [I, L],
    '080716T': [I, E], '080717T': [P, I], '080718T': [I, N],
    '080808T': [A, D], '080906': [P, D],
    '081002': [B, N], '081004': [B, I], '081008T': [B, A],
    '081012T': [B, A], '081407T': [N, P],
    '081602': [C, D], '081604T': [C, D, E], '081605T': [C, D],
    '082008T': [A, I], '082107': [A, I], '082304': [A, B, N],
    '082404T': [A, D], '082707T': [L, E], '082708T': [L, E],
    '082803': [B, D, N], '082806T': [B, D],
    '083101K': [H, C], '083102K': [H, B], '083103TK': [H, A],
    '083104TK': [H, I], '083106TK': [H, A], '083107TK': [H, C],
    '083108TK': [H, P], '083109TK': [H, C, N],
    '083110TK': [H, A], '083111TK': [H, P], '083113TK': [H, A],
    '083112TK': [H, L, N], '090110T': [L, E], '090111T': [L, E],
    '100901K': [L, H], '100704T': [L, F], '100709TK': [L, F],
    '101016TK': [L, F], '101017TK': [L, F], '101018TK': [L, N],
    '120102': [F, P], '120103': [F, B], '120105': [F, B],
    '120110T': [F, M, P], '120210': [F, D], '120213T': [F, E],
    '120214T': [F, E], '120219TK': [F, P], '120404': [F, N],
    '120412T': [F, L], '120413T': [F, L], '120422TK': [F, P],
    '120504T': [F, P], '120904T': [F, E],
    '130207T': [D, E], '130212T': [D, E], '130313T': [D, E],
    '130413TK': [D, E], '130415T': [D, L], '130508': [D, P],
    '130509T': [D, I], '130514T': [D, B], '130515TK': [D, P],
    '140001TK': [A, P], '140002TK': [A, I, C],
    '140003TK': [A, I], '140004TK': [I], '140005T': [N],
    '140006T': [B, P], '140007T': [L, P], '140008T': [L, P, M],
    '140009T': [L, I, P], '140010TK': [L, A],
    '140011TK': [L, A, I], '140012TK': [A, P],
    '140013TK': [L, I, P], '140014T': [A, P], '140015T': [N],
}


def extract_text(path):
    if path.suffix.lower() != '.pdf':
        return path.read_text(encoding='utf-8-sig')
    import fitz
    with fitz.open(path) as document:
        return '\n'.join(page.get_text(sort=True) for page in document)


def build(text):
    majors = []
    current_class = None
    for line in text.splitlines():
        line = line.strip()
        class_match = re.fullmatch(r'(\d{4})\s+(.+类)', line)
        if class_match:
            current_class = (class_match[1], class_match[2])
            continue
        major_match = re.match(r'^(\d{6,7}(?:TK|T|K)?)\s+(.+)$', line)
        if not major_match:
            continue
        code, name = major_match.groups()
        # All line wrapping in this PDF is in the degree notes, after the name.
        name = re.split(r'[（(]注[：:]', name)[0].strip()
        if code.startswith('14'):
            source_class = ('1400', '交叉学科')
        else:
            assert current_class and code.startswith(current_class[0]), (code, current_class)
            source_class = current_class
        categories = EXCEPTIONS.get(code, CLASS_MAP.get(source_class[0]))
        assert categories and name and not re.search(r'[（()）]|授予|学位', name), (code, name)
        majors.append({'code': code, 'name': name, 'categories': categories,
                       'sourceCategory': source_class[1]})
    assert len(majors) == 883, f'Expected 883 official majors; parsed {len(majors)}'
    assert len({m['code'] for m in majors}) == 883, 'Duplicate official code'
    return majors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path)
    parser.add_argument('--output', type=Path, default=OUTPUT)
    args = parser.parse_args()
    input_path = args.input
    if input_path is None:
        input_path = ROOT / 'tmp/pdfs/undergraduate-2026.pdf'
        input_path.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(PDF_URL, input_path)
    majors = build(extract_text(input_path))
    result = {
        'metadata': {
            'title': '普通高等学校本科专业目录（2026年）', 'year': 2026,
            'scope': '本科专业，不包含专科或研究生专业', 'count': len(majors),
            'publisher': '中华人民共和国教育部', 'sourceUrl': PDF_URL,
            'noticeUrl': NOTICE_URL,
            'mappingNote': '名称、代码、专业类来自教育部；categories 为本项目比赛搜索映射，非官方学科分类，也不代表报名资格。',
            'mappingVersion': '2026-10-10-v1',
        },
        'majors': majors,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Wrote {len(majors)} unique undergraduate majors to {args.output}')


if __name__ == '__main__':
    main()
