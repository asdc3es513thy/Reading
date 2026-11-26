#!/usr/bin/env python3
"""Claude 版（dist/reading-log.html）：以模擬的 window.claude 提供 db、sample、assets、downloads。"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, NOTE, ANSWER, check, finish, serve, png_file, browser, sync_playwright  # noqa: E402

MOCK = r"""
(() => {
  const store = {}, subs = {}, blobs = {};
  const T = window.__claude = {samples: [], saves: [], answer: ANSWER_JSON};
  const coll = p => p.split('/')[0];
  const emit = c => {
    const docs = Object.keys(store).filter(k => coll(k) === c).map(k => ({id: k.slice(c.length + 1), data: () => JSON.parse(JSON.stringify(store[k]))}));
    for (const f of subs[c] || []) setTimeout(() => f({docs}), 0);
  };
  const doc = p => ({
    set: async d => { store[p] = JSON.parse(JSON.stringify(d)); emit(coll(p)); },
    update: async d => { store[p] = {...(store[p] || {}), ...JSON.parse(JSON.stringify(d))}; emit(coll(p)); },
    delete: async () => { delete store[p]; emit(coll(p)); }
  });
  const db = {
    doc,
    collection: c => ({
      add: async d => { const id = 'd' + Math.random().toString(36).slice(2, 10); await doc(c + '/' + id).set(d); return {id}; },
      onSnapshot: f => { (subs[c] = subs[c] || []).push(f); emit(c); return () => {}; }
    })
  };
  const sample = async (prompt, opts) => {
    T.samples.push({prompt, images: (opts && opts.images || []).length});
    if (opts && opts.onText) opts.onText({text: '思考'});
    return {text: T.answer, truncated: false};
  };
  sample.limits = async () => ({images: {maxCount: 5}});
  const assets = {
    upload: async b => { const id = 'a' + Math.random().toString(36).slice(2, 10); blobs[id] = b; return {id}; },
    delete: async id => { delete blobs[id]; return {deleted: true}; }
  };
  const downloads = {save: async f => { T.saves.push(f); return {status: 'saved'}; }};
  const caps = {db, sample, assets, downloads};
  window.claude = {use: async n => caps[n]};
})();
"""


SCREEN = ('書名：《測試之書》\n章節：封面\n類型：論點書\n\n'
          '【核心主張】主張一。\n核心概念：\n概念1 刻意練習：操作定義；支撐主張一；深入步驟：①②③\n'
          '【背景與批評】批評。\n【第一性原理】推理。\n【解構】假設。\n【下一步】行動。')

IMG = {
    'visualnotes': '題：測試\n節：刻意練習｜有目標\n點：每次只練一點\n節：回饋｜即時\n點：找教練',
    'mentalmodels': '題：測試\n節：刻意練習｜有目標的練習\n節：回饋｜即時糾錯\n節：表現｜結果\n連：刻意練習 → 表現｜導致\n連：回饋 → 刻意練習｜是前提',
    'chaptermap': '題：測試\n節：第一章｜迷思\n點：天分不是關鍵\n節：第二章｜方法\n連：第一章 → 第二章｜由破到立',
    'themes': '題：測試\n節：努力｜主題\n點：小提琴手（第一章）\n點：棋手（第二章）',
    'quotes': '題：金句\n句：練習不是重複，是改進｜第一章\n句：回饋令練習有方向｜我的重述',
    'handwritten': '題：筆記\n節：核心\n點：重要！練習要有目標\n點：小心：時數不等於進步',
    'blueprint': '題：點樣變專家\n節：輸入｜時間\n點：每日 1 小時\n節：機制｜刻意練習\n連：輸入 → 機制｜投入',
    'timeline': '題：按思路\n節：第一章｜迷思\n節：第二章｜方法\n節：第三章｜表徵',
    'actionplan': '題：清單\n節：今日\n做：練習 10 分鐘｜完成計時\n做：記錄錯誤｜寫下 3 個\n節：這星期\n做：找人回饋｜收到 1 次意見',
    'iceberg': '題：冰山\n上：多練就會進步\n下：只有有回饋的練習才有效｜對應上層1',
}

def main():
    srv, url = serve(ROOT / 'dist')
    img = png_file()
    with sync_playwright() as pw:
        b = browser(pw)
        page = b.new_page()
        page.add_init_script(MOCK.replace('ANSWER_JSON', json.dumps(ANSWER)))
        page.route('**/_blob/*', lambda r: r.fulfill(status=200, content_type='image/png', body=Path(img).read_bytes()))
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(url + 'reading-log.html')
        page.wait_for_function("document.getElementById('whereAmI').textContent.includes('Claude 版')")

        check(page.is_visible('#askBtn') and page.is_hidden('#copyBtn'), '有 Claude：顯示「核對我的重述」')
        check(page.is_hidden('#notice'), '沒有錯誤提示')
        check(page.is_hidden('#recsCard'), 'Claude 版不顯示新書推介（沒有搜尋）')

        # 內文頁：未有相片、重述不足都不可送出
        page.fill('#note', NOTE)
        check(page.is_disabled('#askBtn'), '未有相片不可送出')
        page.fill('#note', '太短')
        page.set_input_files('#file', img)
        check(page.is_disabled('#askBtn') and '重述還差' in page.inner_text('#gateMsg'), '重述不足 20 字不可送出')
        check(page.evaluate('window.__claude.samples.length') == 0, '選相片後沒有自動送出')
        page.fill('#note', '')
        check('封面／目錄：篩書' in page.inner_text('#gateMsg'), '未寫重述時提示封面要揀篩書')

        page.fill('#note', NOTE)
        page.click('#askBtn')
        page.wait_for_function("document.getElementById('records').textContent.includes('測試之書')")
        s = page.evaluate('window.__claude.samples[0]')
        check(NOTE in s['prompt'] and '【核對】' in s['prompt'] and s['images'] == 1, '提問含重述、【核對】及 1 張相片')
        check(page.input_value('#note') == '', '送出後清空重述')
        say = page.inner_text('#say')
        check('覆蓋 2/3' in say and '講錯 1' in say, '答覆解析出覆蓋和講錯')

        # 封面／目錄：不需重述，直接篩書
        page.check('#modeB')
        page.set_input_files('#file', img)
        check(page.is_enabled('#askBtn'), '篩書模式有相片即可送出')
        check(page.inner_text('#askBtn') == '篩書：核心主張＋十種視覺筆記', '篩書按鈕預設連十種視覺筆記')
        page.uncheck('#autoDg')   # 一鍵生成另在 test_local 測試；這裡只測篩書提問
        check(page.inner_text('#askBtn') == '篩書：核心主張', '篩書按鈕名稱')
        page.evaluate("window.__claude.answer = " + json.dumps(SCREEN))
        page.click('#askBtn')
        page.wait_for_function('window.__claude.samples.length === 2')
        s = page.evaluate('window.__claude.samples[1]')
        check('【核心主張】' in s['prompt'] and NOTE not in s['prompt'], '篩書提問用【核心主張】，不含重述')
        check('核心概念：' in s['prompt'] and '深入步驟' in s['prompt'] and '不湊數' in s['prompt'], '篩書提問要求核心概念（最多五個、不湊數）及深入步驟')
        page.wait_for_function("document.getElementById('say').textContent.includes('已儲存')")

        # 同一本書的內文頁：帶入篩書時的核心概念
        page.evaluate("window.__claude.answer = " + json.dumps(ANSWER))
        page.check('#modeA')
        page.set_input_files('#file', img)
        page.fill('#note', NOTE)
        page.click('#askBtn')
        page.wait_for_function('window.__claude.samples.length === 3')
        s = page.evaluate('window.__claude.samples[2]')
        check('概念1 刻意練習' in s['prompt'] and '推進或修正' in s['prompt'], '內文頁提問帶入同一本書的核心概念，並要求對應')
        page.wait_for_function("document.getElementById('say').textContent.includes('已儲存')")


        # 全書整理：十種版式，每個畫成一張 SVG 圖；版式橫向 scroll snap
        check(page.is_visible('#dgCard'), '有記錄就直接顯示「全書整理」，不用另外打開')
        chips = page.eval_on_selector_all('.dg-chip', 'n => n.length')
        slides = page.eval_on_selector_all('.dg-slide', 'n => n.map(x => x.dataset.kind)')
        check(chips == 10 and slides == ['visualnotes', 'mentalmodels', 'chaptermap', 'themes', 'quotes', 'handwritten', 'blueprint', 'timeline', 'actionplan', 'iceberg'], '整理有十種版式，各一頁')
        snap = page.evaluate("[getComputedStyle(document.querySelector('.dg-gal')).scrollSnapType, getComputedStyle(document.querySelector('.dg-chips')).position, getComputedStyle(document.querySelector('.tabs')).position]")
        check(snap[0].startswith('x mandatory') and snap[1] == 'sticky' and snap[2] == 'sticky', '版式橫向 scroll snap；版式列和分頁列 sticky')
        def gen(kind, answer):
            page.evaluate("window.__claude.answer = " + json.dumps(answer))
            page.click(f'.dg-chip:nth-child({slides.index(kind) + 1})')
            page.click(f'.dg-slide[data-kind={kind}] button:has-text("生成")')
        for kind, ans in IMG.items():
            gen(kind, ans)
            page.wait_for_selector(f'.dg-slide[data-kind={kind}] svg.dg-img')
        s = next(x for x in page.evaluate('window.__claude.samples') if '概念關係圖' in x['prompt'])
        check(NOTE in s['prompt'] and '只限下面「我的閱讀記錄」' in s['prompt'] and s['images'] == 0, '整理提問只用已存記錄，不附相片')
        check(page.evaluate("document.querySelectorAll('svg.dg-img').length") == 10, '十種版式都畫成 SVG 圖')
        check(page.eval_on_selector_all('.dg-slide[data-kind=mentalmodels] .dg-node', 'n => n.length') == 3 and page.eval_on_selector_all('.dg-slide[data-kind=mentalmodels] .dg-edge', 'n => n.length') == 2, '概念關係圖：3 個節點、2 條連線')
        hs = page.evaluate("[...document.querySelectorAll('svg.dg-img')].map(s => +s.getAttribute('height'))")
        check(all(h > 150 for h in hs), '每張圖都有內容高度')
        check(page.eval_on_selector_all('.dg-slide[data-kind=actionplan] .dg-ck', 'n => n.length') == 3, '行動清單：3 個勾選格')
        page.click('.dg-chip:nth-child(9)')
        page.click('.dg-slide[data-kind=actionplan] .dg-ck >> nth=1')
        page.wait_for_function("document.querySelector('.dg-slide[data-kind=actionplan] .dg-ck[data-i=\"1\"]').getAttribute('aria-checked') === 'true'")
        check(page.eval_on_selector_all('.dg-slide[data-kind=actionplan] .dg-ck', 'n => n.map(x => x.getAttribute("aria-checked"))') == ['false', 'true', 'false'], '勾選狀態已儲存')
        page.wait_for_timeout(300)
        left = page.evaluate("(() => { const g = document.querySelector('.dg-gal'); return Math.round(g.scrollLeft / g.clientWidth); })()")
        check(left == 8, '重新繪畫後停留在同一版式')
        page.evaluate("window.__claude.answer = '隨便寫的文字，沒有格式'")
        page.click('.dg-chip:nth-child(10)')
        page.click('.dg-slide[data-kind=iceberg] button:has-text("重新生成")')
        page.wait_for_function("document.querySelector('.dg-slide[data-kind=iceberg]').textContent.includes('不符合格式')")
        check(page.query_selector('.dg-slide[data-kind=iceberg] svg.dg-img') is not None, '不符合格式的答覆不覆蓋舊圖')

        # 匯出經 downloads
        page.click('#expJson')
        page.wait_for_function('window.__claude.saves.length === 1')
        f = page.evaluate('window.__claude.saves[0]')
        data = json.loads(f['data'])
        check(f['filename'].endswith('.json') and data.get('app') == '睇書記錄', '匯出 JSON 經 downloads')
        check(len(data['entries']) == 3 and len(data['images']) == 3, '匯出包括 3 條記錄和 3 張相片')
        check({'entries', 'cards', 'sessions', 'practice'} <= set(data), '匯出集合名稱不變')
        check(len(data.get('digests', [])) == 10, '匯出包括 10 份全書整理')

        check(not errors, '沒有 JavaScript 錯誤' + (('：' + errors[0]) if errors else ''))
        b.close()
    srv.shutdown()
    finish()


if __name__ == '__main__':
    main()
