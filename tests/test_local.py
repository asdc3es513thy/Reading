#!/usr/bin/env python3
"""GitHub 版（index.html）：沒有 window.claude，用 IndexedDB，答覆靠複製提問、貼上答覆。"""
import re
import json
import subprocess
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


        # 全書整理（複製模式）：複製提問、貼上答覆
        page.click('#dgBooks button:has-text("測試之書")')
        page.click('.dg-chip:nth-child(10)')
        page.click('.dg-slide[data-kind=iceberg] button:has-text("生成")')
        page.wait_for_selector('.dg-panel textarea[aria-label="整理答覆"]')
        clip = page.evaluate('navigator.clipboard.readText()')
        check('冰山圖' in clip and NOTE in clip, '整理提問已複製，含版式和重述')
        page.fill('.dg-panel textarea[aria-label="整理答覆"]', '題：測試\n上：表面一\n下：深層一｜對應表面一')
        page.click('.dg-panel button:has-text("儲存答覆")')
        page.wait_for_selector('svg.dg-iceberg')
        check('深層一' in page.text_content('svg.dg-iceberg'), '冰山圖：貼上答覆後畫成圖，含水面下')
        with page.expect_download() as dl:
            page.click('.dg-slide[data-kind=iceberg] button:has-text("下載圖片")')
        check(Path(dl.value.path()).read_bytes()[:4] == b'\x89PNG', '冰山圖可下載為 PNG')

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
        web_mode(b, url, img)
        b.close()
    srv.shutdown()
    api_check()
    finish()


RECS = '書名：新書甲（New Book A）\n作者／出版年月／出版社：某作者／2026 年 10 月／某出版社\n類型：論點書'


STATE = {}


DG_BODY = '題：測試\n節：甲｜說明\n點：一\n連：甲 → 乙｜導致\n句：一句｜第一章\n做：行動｜標準\n上：表面\n下：深層｜表面'


def web_mode(b, url, img):
    """Vercel 網頁版：/api/ask 存在時，按「核對我的重述」即經本網站取得答覆。"""
    calls = []

    def handle(route):
        r = route.request
        if r.method == 'GET':
            return route.fulfill(status=200, content_type='application/json', body=json.dumps({'app': '睇書記錄', 'configured': True, 'maxImages': 4, 'providers': ['mistral', 'gemini']}))
        body = json.loads(r.post_data)
        calls.append(body)
        if body.get('pass') != 'secret':
            return route.fulfill(status=401, content_type='application/json', body='{"error":"bad_pass"}')
        if 'EMPTY' in body.get('prompt', '') or STATE.get('empty'):
            return route.fulfill(status=200, content_type='application/x-ndjson', body='{"done":true,"truncated":false,"provider":"mistral"}\n')
        if '你是選書顧問' in body.get('prompt', ''):
            done = {'done': True, 'truncated': False, 'sources': [{'title': '出版社新書頁', 'uri': 'https://example.com/new-book'}, {'title': '壞連結', 'uri': 'javascript:alert(1)'}]}
            lines = [json.dumps({'t': RECS}, ensure_ascii=False), json.dumps(done, ensure_ascii=False)]
            return route.fulfill(status=200, content_type='application/x-ndjson', body='\n'.join(lines) + '\n')
        kinds = re.findall(r'===版式：/(\w+)===', body.get('prompt', ''))
        if kinds:
            STATE['dg'] = STATE.get('dg', 0) + 1
            if STATE['dg'] == 1:
                kinds = [k for k in kinds if k != 'quotes']   # 第一批故意漏一個，測試自動補齊
            text = ''.join('===版式：/' + k + '===\n' + DG_BODY + '\n' for k in kinds)
            lines = [json.dumps({'t': text}, ensure_ascii=False), '{"done":true,"truncated":false,"provider":"openrouter"}']
            return route.fulfill(status=200, content_type='application/x-ndjson', body='\n'.join(lines) + '\n')
        lines = [json.dumps({'t': ANSWER[:30]}, ensure_ascii=False), json.dumps({'t': ANSWER[30:]}, ensure_ascii=False), json.dumps({'done': True, 'truncated': False, 'provider': 'openrouter', 'model': 'test/model:free', 'skipped': ['gemini-3.1-pro-preview 429 quota'], 'sources': [{'title': '書評甲', 'uri': 'https://example.com/review'}, {'title': '壞', 'uri': 'javascript:x'}]}, ensure_ascii=False)]
        return route.fulfill(status=200, content_type='application/x-ndjson', body='\n'.join(lines) + '\n')

    ctx = b.new_context()
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.route('**/api/ask', handle)
    page.goto(url + 'index.html')
    page.wait_for_function("document.getElementById('whereAmI').textContent.includes('網頁版')")
    check(page.is_visible('#recsCard') and not any('你是選書顧問' in c['prompt'] for c in calls), '網頁版顯示新書推介；未有通行碼不會自動搜尋')
    check('Mistral，後備 Gemini' in page.inner_text('#whereAmI'), '頁底顯示主引擎和後備')
    check(page.is_visible('#askBtn') and page.is_hidden('#copyBtn') and page.is_visible('#pass'), '網頁版：顯示「核對我的重述」和通行碼欄')

    page.set_input_files('#file', img)
    page.fill('#note', NOTE)
    page.click('#askBtn')
    page.wait_for_function("document.getElementById('say').textContent.includes('通行碼')")
    check(not calls, '未輸入通行碼不會送出')

    page.fill('#pass', 'wrong')
    page.click('#askBtn')
    page.wait_for_function("document.getElementById('say').textContent.includes('通行碼不正確')")
    check(page.evaluate("document.querySelectorAll('#records article').length") == 0, '通行碼錯誤時沒有儲存')

    page.fill('#pass', 'secret')
    STATE['empty'] = True
    page.click('#askBtn')
    page.wait_for_function("document.getElementById('say').textContent.includes('沒有回覆')")
    check(page.evaluate("document.querySelectorAll('#records article').length") == 0, '空答覆不會儲存，並顯示原因')
    STATE['empty'] = False
    page.click('#askBtn')
    page.wait_for_function("document.getElementById('records').textContent.includes('測試之書')")
    last = calls[-1]
    check(NOTE in last['prompt'] and '【核對】' in last['prompt'] and len(last['images']) == 1 and last['images'][0]['type'] in ('image/jpeg', 'image/png') and last['images'][0]['data'], '網頁版提問含重述、【核對】及相片')
    check('承鏈' in last['prompt'] and '替換測試' in last['prompt'] and '淨效益轉負' in last['prompt'] and '領域機制' in last['prompt'], '提問要求首尾承接的推理鎖鏈、負收益臨界、替換測試、領域機制')
    check('逐環自查' in last['prompt'] and '可觀察的預測' in last['prompt'], '提問要求鎖鏈逐環自查，事實型主張以可觀察預測收尾')
    check('答覆來源：OpenRouter · test/model:free' in page.inner_text('#records'), '記錄顯示答覆來源（引擎和模型）')
    check(last.get('search') is True and '作答前必須先搜尋' in last['prompt'] and '你不能上網' not in last['prompt'], '網頁版核對要求先上網搜尋')
    rec_txt = page.inner_text('#records')
    check('未能使用（已改用下一個）：gemini-3.1-pro-preview 429 quota' in rec_txt and '網上來源 1 個' in rec_txt, '記錄顯示未能使用的引擎原因和網上來源（只留 http 連結）')
    say = page.inner_text('#say')
    check('覆蓋 2/3' in say and '講錯 1' in say, '網頁版答覆解析出覆蓋和講錯')
    check(page.evaluate("localStorage.getItem('reading-log:api-pass')") == 'secret', '通行碼記在 reading-log: 前綴鍵')
    page.reload()
    page.wait_for_function("document.getElementById('records').textContent.includes('測試之書')")
    check(page.input_value('#pass') == 'secret', '重新載入後記得通行碼，記錄仍在')

    # 新書推介：有通行碼、未有推介 → 打開即自動搜尋一次
    page.wait_for_function("document.getElementById('recsText').textContent.includes('新書甲')")
    rc = [c for c in calls if '你是選書顧問' in c['prompt']]
    check(len(rc) == 1 and '測試之書' in rc[0]['prompt'] and '不限任何圖書館' in rc[0]['prompt'] and not rc[0]['images'], '自動推介：用搜尋、帶已讀書目、不限圖書館')
    links = page.eval_on_selector_all('#recsSrc a', 'as => as.map(a => a.href)')
    check(links == ['https://example.com/new-book'], '推介來源只顯示 http 連結')
    check(page.evaluate("JSON.parse(localStorage.getItem('reading-log:recs')).text").startswith('書名：新書甲'), '推介存在 reading-log: 前綴鍵')
    page.reload()
    page.wait_for_function("document.getElementById('recsText').textContent.includes('新書甲')")
    page.wait_for_timeout(500)
    check(len([c for c in calls if '你是選書顧問' in c['prompt']]) == 1, '一星期內重新打開不會再搜尋')
    check(page.evaluate("+localStorage.getItem('reading-log:recs-tried') > 0"), '記錄上次自動搜尋時間（失敗也不會每次打開都重試）')
    page.click('#recsBtn')
    page.wait_for_function("document.getElementById('recsSay').textContent.includes('更新於')")
    check(len([c for c in calls if '你是選書顧問' in c['prompt']]) == 2, '按「更新推介」即重新搜尋')
    # 篩書一鍵：核心主張＋十種視覺筆記
    page.check('#modeB')
    page.set_input_files('#file', img)
    check(page.inner_text('#askBtn') == '篩書：核心主張＋十種視覺筆記', '篩書按鈕預設同時生成十種視覺筆記')
    n0 = len(calls)
    page.click('#askBtn')
    page.wait_for_function("document.getElementById('dgAllSay').textContent.includes('已生成 10 種')", timeout=20000)
    dg = [c for c in calls[n0:] if '===版式：/' in c['prompt']]
    check(len(dg) == 3 and not any(c['images'] for c in dg) and all('篩書' in c['prompt'] for c in dg), '一按篩書：兩批生成十種，漏了的自動補齊，不附相片')
    check(page.evaluate("document.querySelectorAll('.dg-chip.has').length") == 10 and page.inner_text('#dgAllBtn') == '全部重新生成', '十種版式全部儲存')
    check('已生成 10 種' in page.inner_text('#say'), '上載區顯示完成')
    page.uncheck('#autoDg')
    check(page.inner_text('#askBtn') == '篩書：核心主張', '取消剔選就只篩書')
    check(not errors, '網頁版沒有 JavaScript 錯誤' + (('：' + errors[0]) if errors else ''))
    ctx.close()


def api_check():
    """api/ask.js：用假 Gemini 伺服器測試，不花額度。"""
    if not (ROOT / 'node_modules' / '@google' / 'genai').exists():
        subprocess.run(['npm', 'install', '--silent'], cwd=ROOT, check=True)
    r = subprocess.run(['node', 'tests/api_check.mjs'], cwd=ROOT, capture_output=True, text=True, timeout=60)
    if r.returncode:
        check(False, 'api/ask.js 可執行：' + r.stderr[-300:])
        return
    o = json.loads(r.stdout)
    check(o['unconfiguredGet'] is False and o['unconfiguredPost'] == 503, 'API：未設定金鑰和通行碼時拒絕')
    check(o['configuredGet'] is True and o['wrongPass'] == 401, 'API：通行碼錯誤回 401')
    check(o['noPrompt'] == 400 and o['tooMany'] == 413 and o['badType'] == 400, 'API：無效提問和相片被拒')
    check(o['okStatus'] == 200 and o['lines'][-1].get('done') and ''.join(l.get('t', '') for l in o['lines']) == '書名：《測試》\n【核對】一。', 'API：串流答覆完整')
    check('gemini-3.1-pro-preview:streamGenerateContent' in o['path'] and o['key'] == 'test-key', 'API：用 Gemini 金鑰，預設先試 Pro（gemini-3.1-pro-preview）')
    check('gemini-3.8-flash' in o['lightPath'], 'API：light 請求（全書整理）略過 Pro，直接用 Flash')
    check(o['nopro'].get('done') is True and len(o['noproPaths']) == 2 and 'gemini-3.8-flash' in o['noproPaths'][1], 'API：Pro 用不到時自動改用 Flash')
    check(o['parts'][0] == {'inlineData': {'mimeType': 'image/png', 'data': 'AAAA'}} and o['parts'][-1] == {'text': '提問'}, 'API：相片在前、提問在後')
    check({k: o['long'][k] for k in ('done', 'truncated', 'stop')} == {'done': True, 'truncated': True, 'stop': 'MAX_TOKENS'}, 'API：答覆過長標示截短')
    check(o['blocked'].get('error') == 'refused', 'API：安全封鎖回報 refused')
    check(o['config'].get('thinkingConfig') == {'thinkingLevel': 'XHIGH'}, 'API：預設要求最高思考深度')
    check(o['nothink'].get('done') is True, 'API：模型不接受思考深度時自動改用預設再試')
    check(o['searchTools'] == [{'googleSearch': {}}] and o['plainTools'] is None, 'API：只有推介請求才開 Google 搜尋')
    check(o['search'].get('sources') == [{'title': 'A', 'uri': 'https://example.com/a'}], 'API：搜尋來源去重後回傳')
    check(o['ghGet']['providers'] == ['mistral', 'gemini'] and o['ghOnlyGet'] == ['mistral'], 'API：列出可用引擎，Mistral 先於 Gemini')
    g = o['ghReq'][0] if o['ghReq'] else {}
    check(len(o['ghReq']) == 1 and g['auth'] == 'Bearer mi-test' and g['model'] == 'mistral-large-4-0' and g['stream'] is True and g['effort'] == 'high', 'API：Mistral 請求（Large 4、串流、最高推理深度）')
    check(g.get('content') == [{'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,AAAA'}}, {'type': 'text', 'text': '提問'}], 'API：Mistral 請求相片在前、提問在後')
    check(''.join(l.get('t', '') for l in o['gh']) == '書名：《GH》\n【核對】甲。' and o['gh'][-1].get('provider') == 'mistral', 'API：Mistral 思考區塊不混入答覆，答覆完整')
    check(o['ghFallback'].get('provider') == 'gemini' and o['ghFallbackPaths'][:2] == ['/mistral/chat/completions mistral-large-4-0', '/mistral/chat/completions mistral-medium-3-5'] and 'gemini' in o['ghFallbackPaths'][2], 'API：Mistral Large 4、Medium 3.5 都用不到時改用 Gemini')
    check(o['ghLen'].get('truncated') is True and o['ghFilter'].get('error') == 'refused', 'API：Mistral 截短和內容過濾')
    check(o['pro503'].get('model') == 'gemini-3.8-flash', 'API：Gemini Pro 太忙（503）時改用 Flash')
    check(o['ghStreamErr'].get('provider') == 'gemini', 'API：Mistral 未出文字就斷線時改用 Gemini')
    check(o['noReason'].get('provider') == 'mistral' and o['noReasonReq'] == ['high', 'undefined'], 'API：模型不接受推理深度時用預設再試')
    check(o['orGet'] == ['openrouter', 'mistral', 'gemini'], 'API：OpenRouter 排第一，然後 Mistral、Gemini')
    r0 = o['orReq'][0] if o['orReq'] else {}
    check(len(o['orReq']) == 1 and r0.get('auth') == 'Bearer or-test' and r0.get('title') == 'Reading Log' and r0.get('model') == 'nvidia/nemotron-3.5-super-vl:free' and r0.get('reasoning') == {'effort': 'high'} and r0.get('content', [{}])[0].get('type') == 'image_url', 'API：OpenRouter 請求（Nemotron 3.5 Super VL、最高推理深度、相片）')
    check(''.join(l.get('t', '') for l in o['or']) == '書名：《OR》' and o['or'][-1].get('provider') == 'openrouter', 'API：OpenRouter 串流答覆完整（略過 PROCESSING 註解行）')
    check(o['or429'].get('provider') == 'mistral' and o['or429Models'][:4] == ['nvidia/nemotron-3.5-super-vl:free', 'google/gemma-4-31b-it:free', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'mistral-large-4-0'], 'API：OpenRouter 三個免費模型都用不到時改用 Mistral')
    check(o['filtered'] == ['google/gemma-4-31b-it:free', 'mistral-large-4-0'], 'API：中國模型（含 openrouter/free 隨機路由）一律略過')
    check(o['orSearchFirst'].startswith('/v1/models/gemini'), 'API：有 OpenRouter 時新書推介仍先用 Gemini 搜尋')
    check(o['ghEmpty'].get('provider') == 'gemini', 'API：Mistral 沒有文字時改用 Gemini')
    check(o['ghJson'][0] == {'t': '書名：《JSON》'} and o['ghJson'][-1].get('provider') == 'mistral', 'API：一次過 JSON 答覆也讀得到')
    check(o['allDown'].get('error') == 'upstream' and o['allDown'].get('detail', '').startswith('mistral') and '；gemini 503' in o['allDown'].get('detail', ''), 'API：全部失敗時列出每個引擎的原因')
    check(o['quota'].get('error') == 'rate_limited' and o['quota'].get('detail') == 'gemini 429 You exceeded your current quota, please check your plan.', 'API：錯誤原因只顯示最內層訊息')
    check(o['defaultOrder'] == ['gemini', 'openrouter', 'mistral'] and o['defaultFirst'].get('provider') == 'gemini' and o['defaultFirstPath'].startswith('/v1/models/gemini-3.1-pro-preview'), 'API：預設 Gemini 排第一，先用 Pro')
    check(o['geminiQuota'].get('skipped', [])[:2] and 'gemini-3.1-pro-preview' in o['geminiQuota']['skipped'][0] and 'gemini-3.8-flash' in o['geminiQuota']['skipped'][1], 'API：done 列出用不到的 Gemini 型號和原因')
    check(o['searchFallback'].get('provider') == 'openrouter' and o['searchFallbackPrompt'].startswith('（系統註：你是後備引擎') and '這次未能使用網上搜尋' in o['searchFallbackPrompt'] and o['searchFallbackPrompt'].endswith('提問'), 'API：要求搜尋但 Gemini 用不到時，後備引擎提問加註鎖鏈自查及未能搜尋')
    q = o['geminiQuotaPaths']
    check(o['geminiQuota'].get('provider') == 'openrouter' and 'gemini-3.1-pro-preview' in q[0] and 'gemini-3.8-flash' in q[1] and q[2] == 'nvidia/nemotron-3.5-super-vl:free', 'API：Gemini Pro、Flash 額度用完時改用 OpenRouter')
    check(o['searchBothFirst'].startswith('/v1/models/gemini') and o['searchBoth'].get('sources'), 'API：新書推介先用 Gemini（有 Google 搜尋）')

if __name__ == '__main__':
    main()
