# 睇書記錄：給 Claude 的更新守則

用戶以繁體中文（粵語口吻）溝通；介面文字一律用繁體中文書面語。用戶要求「不需迎合」：有問題直接講。

## 結構

- `src/reading-log.src.html`：唯一原始檔（HTML＋CSS＋JS）。`@@BG@@`、`@@VERSION@@` 由 `build.py` 代入。
- `src/bg.jpg`：宇宙背景相片。`src/VERSION`：發佈日期，每次發佈改為當日。
- `build.py`：產生 `index.html`（GitHub Pages 版，commit）、`dist/reading-log.html`（Claude 版，不 commit）、`METHOD.md`（方法全文，commit）。
- 同一份程式碼三種運行方式：有 `window.claude` 就用 Claude 的 `db`、`sample`、`assets`、`downloads`；沒有就用瀏覽器 IndexedDB（資料庫名 `reading-log`），答覆改為複製提問文字、貼上答覆。
- Vercel 網頁版：同網站有 `api/ask`（`api/ask.js`：引擎次序預設 Google Gemini（`GEMINI_API_KEY`，先 `gemini-3.1-pro-preview` 後 `gemini-3.8-flash`；`light: true` 的全書整理請求略過 Pro）→ OpenRouter（`OPENROUTER_API_KEY`，可選 `OPENROUTER_MODELS`，預設非中國免費模型）→ Mistral（`MISTRAL_API_KEY`，可選 `MISTRAL_MODELS`），可用 `ENGINE_ORDER` 改；用戶定案 Gemini 排第一，因為 OpenRouter 免費模型和 Gemini Flash 深度不足；每個引擎都要求最高推理深度；**用戶不用任何中國 AI**（`CHINESE` 過濾，`openrouter/free` 亦排除），不可加回；不要預設經第三方用 Claude（Anthropic 不在香港提供服務）；另需 `APP_PASSCODE`；可選 `GEMINI_MODEL`、`GEMINI_THINKING`（預設 `XHIGH`））就經它取得答覆，記錄仍用 IndexedDB；GitHub Pages 沒有這個路徑，維持複製模式。網頁版的篩書、核對和「新書推介」都用 `search: true`（先用 Gemini 的 Google 搜尋；後備引擎提問前加註未能搜尋；`done.skipped` 列出用不到的引擎及原因，記錄欄位 `sources`、`skipped`）；新書推介每星期自動更新一次，結果存在 localStorage `reading-log:recs`，不入資料庫。

## 更新流程

1. 只改 `src/`，不要手改 `index.html` 或 `METHOD.md`。
2. 把 `src/VERSION` 改為當日日期，然後執行 `python3 build.py`。
3. 執行 `python3 tests/test_local.py` 和 `python3 tests/test_claude.py`，全部要通過。新功能要加測試。
4. Claude 版：用 Artifact 工具把 `dist/reading-log.html` 發佈到 https://claude.ai/artifact/BpatGZuPqyWHMYNGSt6ksF （傳入 `url`）。capabilities 維持 `{db:{}, sample:{images:true}, assets:{}, downloads:true}`。
5. GitHub 版：在分支 commit `src/`、`index.html`、`METHOD.md` 及相關檔案，推送後由用戶合併到 `main`。不能推送時，把 `index.html` 等檔案交給用戶在 GitHub 網頁上載。
   - commit 作者要用用戶的 GitHub 帳戶（`asdc3es513thy <322116925+asdc3es513thy@users.noreply.github.com>`，`git config user.name／user.email`），否則 Vercel 免費版會擋住自動部署；Claude 以 `Co-Authored-By` 註明。不要用用戶的私人電郵。
6. 兩邊頁底的版本號必須相同。
7. 自動協作：用戶帶來其他 AI 的檔案或報告，或要求更新時，Claude 直接完成以上 1–6，推送分支後用 `gh api repos/asdc3es513thy/reading/pulls` 開 PR，只回覆 PR 連結；不要叫用戶手動上載檔案。用戶合併後，確認 `main` 已更新。
8. 同步 claude.ai Reading Project：合併後用 Projects 工具覆寫同名文件（`reading-log (1).html` ← `index.html`，`ask (6).js`、`README (6).md`、`METHOD (6).md`、`CLAUDE (6).md`、`WORKFLOW (6).md`、`package (6).json`、`vercel (6).json`），內容沒有改的不要重寫。

## 用戶已定案、不可自行改動

- 外觀：宇宙背景；層透明度 `--surface` 約 0.22；邊框 `--line` 維持 `rgba(255,255,255,.0001)`。
- 上載雙模式：內文頁重述滿 20 字才可交 Claude 核對；封面／目錄直接篩書；選相片後不自動送出。
- 答覆 5 節：【核對】（篩書為【核心主張】）、【背景與批評】、【第一性原理】（四步推理）、【解構】（最致命一至兩個假設）、【下一步】（行動＋三條蘇格拉底式提問）。主張最多五個，不湊數。開頭固定行：書名、章節、類型；內文頁另有覆蓋、講錯。
- 模型卡：第一性原理依據、修正版模型、結論類型、帶數字的預測、失敗條件、樣本數、到期日。驗證中最多 3 張；機率型樣本最少 10 次；命中入卡，間隔 1／3／7／21／60 天，之後乘 2.5；證偽開新版本。
- 入定實驗：擲硬幣分配，3 小時內有效；以內文頁覆蓋率比較，兩組各 15 條才判斷。

## 資料

- 兩個版本的資料互不相通，只靠「匯出／匯入備份」（JSON，`app: "睇書記錄"`）搬。
- 集合與欄位名稱（`entries`、`cards`、`sessions`、`practice` 及其欄位）不可改名或改變意義，否則舊記錄讀不到。舊記錄可能沒有 `mode`、`cover` 等新欄位，程式要容許。
- `digests`：每本書的「整理全書」結果（十種版式：visualnotes、mentalmodels、chaptermap、themes、quotes、handwritten、blueprint、timeline、actionplan、iceberg）。文件 id = `g` + 書名雜湊 + `-` + 版式；欄位 `bookTitle`、`kind`、`text`（AI 原文，按「題／節／點／連／句／做／上／下」行格式解析）、`done`（行動清單已勾選的序號）。原料只限該書已存記錄，不附相片。舊備份沒有 `digests`，匯入要容許。
- GitHub Pages 網域 `asdc3es513thy.github.io` 與其他 repo 的頁面共用；localStorage 鍵要加 `reading-log:` 前綴。
- **這個 repo 是公開的**：不要 commit 用戶的備份 JSON、書頁相片或任何記錄。

## 覆核其他 AI 的報告（例如 Gemini）

逐項對照程式碼核實，分清「成立」「部分成立」「不成立」，並指出報告漏了甚麼。凡建議會推翻上面「已定案」的內容，先問用戶，不可自行改動。
