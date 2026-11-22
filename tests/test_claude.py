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

        # 匯出經 downloads
        page.click('#expJson')
        page.wait_for_function('window.__claude.saves.length === 1')
        f = page.evaluate('window.__claude.saves[0]')
        data = json.loads(f['data'])
        check(f['filename'].endswith('.json') and data.get('app') == '睇書記錄', '匯出 JSON 經 downloads')
        check(len(data['entries']) == 3 and len(data['images']) == 3, '匯出包括 3 條記錄和 3 張相片')
        check({'entries', 'cards', 'sessions', 'practice'} <= set(data), '匯出集合名稱不變')

        check(not errors, '沒有 JavaScript 錯誤' + (('：' + errors[0]) if errors else ''))
        b.close()
    srv.shutdown()
    finish()


if __name__ == '__main__':
    main()
