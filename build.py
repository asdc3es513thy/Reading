#!/usr/bin/env python3
"""由 src/ 產生 index.html（GitHub 版）、dist/reading-log.html（Claude 版）、METHOD.md。

版本號 = src/VERSION 的日期 + 原始檔內容雜湊（7 位）。兩個版本由同一次 build 產生，版本號必然相同。
"""
import base64
import hashlib
import re
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / 'src'


def version():
    date = (SRC / 'VERSION').read_text(encoding='utf-8').strip()
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', date):
        raise SystemExit('src/VERSION 要是 YYYY-MM-DD：' + date)
    h = hashlib.sha256()
    for name in ('reading-log.src.html', 'bg.jpg'):
        h.update((SRC / name).read_bytes())
    return date + ' · ' + h.hexdigest()[:7]


def render(ver):
    html = (SRC / 'reading-log.src.html').read_text(encoding='utf-8')
    for key in ('@@BG@@', '@@VERSION@@'):
        if html.count(key) != 1:
            raise SystemExit(f'原始檔中 {key} 應該剛好出現一次')
    bg = base64.b64encode((SRC / 'bg.jpg').read_bytes()).decode('ascii')
    return html.replace('@@BG@@', bg).replace('@@VERSION@@', ver)


class MethodMd(HTMLParser):
    """把「方法全文」分頁及「入定・推理」第一節轉為 Markdown。"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth = 0          # 在目標 view 內的 div 深度；0 = 不在
        self.view = None
        self.sections = 0       # 已見的 practice section 數
        self.blocks = []
        self.buf = None         # 目前收集中的行內文字
        self.kind = None
        self.lists = []         # [('ol'|'ul', 計數)]
        self.table = None
        self.row = None

    def active(self):
        if self.view == 'viewMethod':
            return True
        return self.view == 'viewPractice' and self.sections == 1

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if self.depth == 0:
            if tag == 'div' and a.get('id') in ('viewMethod', 'viewPractice'):
                self.view, self.depth = a['id'], 1
            return
        if tag == 'div':
            self.depth += 1
        if tag == 'section' and self.view == 'viewPractice':
            self.sections += 1
        if not self.active():
            return
        if tag in ('h2', 'h3', 'p', 'li', 'th', 'td'):
            self.buf, self.kind = [], tag
        elif tag in ('ol', 'ul'):
            self.lists.append([tag, 0])
        elif tag == 'table':
            self.table = []
        elif tag == 'tr':
            self.row = []
        elif tag == 'strong' and self.buf is not None:
            self.buf.append('**')

    def handle_endtag(self, tag):
        if self.depth == 0:
            return
        if tag == 'div':
            self.depth -= 1
            if self.depth == 0:
                self.view = None
            return
        if not self.active():
            return
        if tag == 'strong' and self.buf is not None:
            self.buf.append('**')
        elif tag == self.kind and self.buf is not None:
            text = re.sub(r'\s+', ' ', ''.join(self.buf)).strip()
            self.buf = None
            if tag == 'h2':
                if self.view == 'viewPractice':
                    text = '入定・閱讀・推理：' + text
                self.blocks.append('## ' + text)
            elif tag == 'h3':
                self.blocks.append('### ' + text)
            elif tag == 'p':
                self.blocks.append(text)
            elif tag == 'li':
                lst = self.lists[-1]
                lst[1] += 1
                mark = f'{lst[1]}.' if lst[0] == 'ol' else '-'
                self.blocks.append(('li', f'{mark} {text}'))
            else:
                self.row.append(text)
        elif tag in ('ol', 'ul'):
            self.lists.pop()
        elif tag == 'tr':
            self.table.append(self.row)
        elif tag == 'table':
            head, *body = self.table
            lines = ['| ' + ' | '.join(head) + ' |', '|' + '---|' * len(head)]
            lines += ['| ' + ' | '.join(r) + ' |' for r in body]
            self.blocks.append('\n'.join(lines))
            self.table = None

    def handle_data(self, data):
        if self.buf is not None:
            self.buf.append(data)

    def markdown(self):
        out, prev_li = [], False
        for b in self.blocks:
            is_li = isinstance(b, tuple)
            if is_li and prev_li:
                out[-1] += '\n' + b[1]
            else:
                out.append(b[1] if is_li else b)
            prev_li = is_li
        return '\n\n'.join(out)


def method_md(html, ver):
    p = MethodMd()
    p.feed(html)
    head = ('# 睇書記錄：方法全文\n\n'
            f'> 由 `src/reading-log.src.html` 的「方法全文」分頁自動產生（`build.py`），請勿手改。版本 {ver}。\n\n')
    return head + p.markdown() + '\n'


def main():
    ver = version()
    html = render(ver)
    (ROOT / 'index.html').write_text(html, encoding='utf-8')
    (ROOT / 'dist').mkdir(exist_ok=True)
    (ROOT / 'dist' / 'reading-log.html').write_text(html, encoding='utf-8')
    (ROOT / 'METHOD.md').write_text(method_md(html, ver), encoding='utf-8')
    print('版本', ver)


if __name__ == '__main__':
    main()
