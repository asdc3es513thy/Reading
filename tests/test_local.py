#!/usr/bin/env python3
"""GitHub 版（index.html）：沒有 window.claude，用 IndexedDB，答覆靠複製提問、貼上答覆。"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, NOTE, ANSWER, check, finish, footer_version, serve, png_file, browser, sync_playwright  # noqa: E402


def main():
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    dist = ROOT / 'dist' / 'reading-log.html'
    ver = footer_version(html)
    check(bool(ver), '頁底有版本號')
    check(dist.exists() and footer_version(dist.read_text(encoding='utf-8')) == ver, '兩個版本版本號相同')
    check('@@' not in html, '沒有未代入的佔位符')
    method = (ROOT / 'METHOD.md').read_text(encoding='utf-8')
    check(ver in method, 'METHOD.md 版本號與頁面相同')

    srv, url = serve(ROOT)
    img = png_file()
    with sync_playwright() as pw:
        b = browser(pw)
        ctx = b.new_context(permissions=['clipboard-read', 'clipboard-write'])
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(url + 'index.html')
        page.wait_for_selector('#notice:not([hidden])')

        check(page.is_hidden('#askBtn') and page.is_visible('#copyBtn'), '沒有 Claude：顯示「複製提問文字並儲存」')
        check('GitHub 版' in page.inner_text('#whereAmI'), '頁底說明正在用 GitHub 版')
        check(page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--line').trim()") == 'rgba(255,255,255,.0001)', '邊框 --line 維持定案值')

        # 內文頁：重述不足 20 字不可送出
        page.set_input_files('#file', img)
        page.fill('#note', '太短')
        check(page.is_disabled('#copyBtn') and '重述還差' in page.inner_text('#gateMsg'), '內文頁重述不足 20 字被擋')
        check(page.evaluate("document.querySelectorAll('#records article').length") == 0, '被擋時沒有儲存')

        # 足 20 字：複製並儲存
        page.fill('#note', NOTE)
        page.click('#copyBtn')
        page.wait_for_function("document.getElementById('say').textContent.includes('儲存')")
        clip = page.evaluate('navigator.clipboard.readText()')
        check(NOTE in clip and '【核對】' in clip, '提問文字已複製，含重述和【核對】')
        page.wait_for_selector('#records article')

        # 貼上答覆
        page.click('#records article button:has-text("貼上答覆")')
        page.fill('#records article textarea', ANSWER)
        page.click('#records article button:has-text("儲存答覆")')
        page.wait_for_function("document.getElementById('records').textContent.includes('測試之書')")
        rec = page.inner_text('#records')
        check('第一章' in rec, '答覆解析出書名和章節')

        # 封面／目錄：不需重述
        page.check('#modeB')
        check(page.is_hidden('#noteWrap'), '篩書模式隱藏重述欄')
        page.set_input_files('#file', img)
        page.click('#copyBtn')
        page.wait_for_function("document.querySelectorAll('#records article').length >= 2 || document.getElementById('records').textContent.includes('2')")
        clip = page.evaluate('navigator.clipboard.readText()')
        check('【核心主張】' in clip, '篩書提問用【核心主張】')

        # 重新載入：IndexedDB 保留
        page.reload()
        page.wait_for_function("document.getElementById('records').textContent.includes('測試之書')")
        check(True, '重新載入後記錄仍在')

        keys = page.evaluate('Object.keys(localStorage)')
        check(all(k.startswith('reading-log:') for k in keys), 'localStorage 鍵全部有 reading-log: 前綴')

        # 匯出備份
        with page.expect_download() as dl:
            page.click('#expJson')
        data = json.loads(Path(dl.value.path()).read_text(encoding='utf-8'))
        check(data.get('app') == '睇書記錄' and len(data['entries']) == 2, '匯出 JSON：app 名稱和記錄數')
        check(len(data.get('images', {})) == 2, '匯出 JSON 包括相片')
        e0 = next(e for e in data['entries'] if e.get('mode') == 'A')
        check(e0.get('cover') == {'hit': 2, 'total': 3} and e0.get('wrong') == 1, '覆蓋 2/3、講錯 1 已儲存')

        # 匯入到全新瀏覽器
        bk = Path(dl.value.path())
        ctx2 = b.new_context()
        p2 = ctx2.new_page()
        p2.goto(url + 'index.html')
        p2.wait_for_selector('#notice:not([hidden])')
        p2.set_input_files('#impFile', str(bk))
        p2.wait_for_function("document.getElementById('bkSay').textContent.includes('已匯入')")
        check('記錄 2 條' in p2.inner_text('#bkSay'), '匯入到另一個瀏覽器：2 條記錄')

        # 匯入舊格式（沒有 mode、cover）
        old = {'app': '睇書記錄', 'entries': [{'id': 'old1', 'note': '舊記錄', 'answer': '【核對】舊', 'createdAt': 1}]}
        op = Path(png_file()).with_name('old.json')
        op.write_text(json.dumps(old, ensure_ascii=False), encoding='utf-8')
        p2.set_input_files('#impFile', str(op))
        p2.wait_for_function("document.getElementById('bkSay').textContent.includes('記錄 1 條')")
        check(True, '沒有 mode、cover 的舊記錄可匯入')

        check(not errors, '沒有 JavaScript 錯誤' + (('：' + errors[0]) if errors else ''))
        b.close()
    srv.shutdown()
    finish()


if __name__ == '__main__':
    main()
