"""測試共用：本機 HTTP 伺服器、Chromium、測試相片、簡單斷言。"""
import base64
import functools
import http.server
import re
import tempfile
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
# 8x8 PNG：只用作上載測試，不是用戶相片
PNG = base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQDALx3P8E9vg4AAAAASUVORK5CYII=')
NOTE = '作者認為刻意練習比天分重要，因為頂尖表現者的差距主要來自累積練習時數。'
ANSWER = ('書名：《測試之書》\n章節：第一章\n類型：論點書\n覆蓋：2/3\n講錯：1\n\n'
          '【核對】要點一。\n【背景與批評】批評。\n【第一性原理】推理。\n【解構】假設。\n【下一步】行動。')

FAILS = []


def check(cond, name):
    print(('通過 ' if cond else '失敗 ') + name)
    if not cond:
        FAILS.append(name)


def finish():
    if FAILS:
        raise SystemExit(f'{len(FAILS)} 項失敗：' + '；'.join(FAILS))
    print('全部通過')


def footer_version(html):
    m = re.search(r'版本 (\d{4}-\d{2}-\d{2} · [0-9a-f]{7})', html)
    return m.group(1) if m else ''


def serve(directory):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    h = functools.partial(Quiet, directory=str(directory))
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f'http://127.0.0.1:{srv.server_address[1]}/'


def png_file():
    d = Path(tempfile.mkdtemp())
    p = d / 'page.png'
    p.write_bytes(PNG)
    return str(p)


def browser(pw):
    try:
        return pw.chromium.launch()
    except Exception:
        return pw.chromium.launch(executable_path='/opt/pw-browsers/chromium')


__all__ = ['ROOT', 'PNG', 'NOTE', 'ANSWER', 'check', 'finish', 'footer_version', 'serve', 'png_file', 'browser', 'sync_playwright']
