# Reading｜睇書記錄

睇書作為自主路徑進步迴路：Entry Filter → Comprehension → Deconstruction → Reconstruction → Validation Loop，疊加 Elaborative Encoding、Retrieval Practice、Spaced Repetition。作者結論只是假說；閱讀的目的，是在真實處境中驗證，建立自己的模型。

方法全文見 [METHOD.md](METHOD.md)；由設定到每日使用的完整流程見 [WORKFLOW.md](WORKFLOW.md)。

## 兩個版本

兩個版本由同一份原始檔產生，功能和方法相同，分別在於答覆和記錄存放：

| | Claude 版（主力） | Vercel 網頁版 | GitHub 版（備用） |
|---|---|---|---|
| 打開 | Claude app → Artifacts →「睇書記錄」 | 你的 Vercel 網址 | https://asdc3es513thy.github.io/Reading/ |
| 上載後答覆 | 自動（Claude） | 自動（OpenRouter → GitHub Models → Gemini，預設都用免費額度；輸入通行碼，經 `api/ask.js`） | 按「複製提問文字並儲存」，到 Claude 取得答覆，再在記錄上「貼上答覆」 |
| 記錄存放 | 你的 Claude 帳戶，換裝置仍在 | 只在該裝置的瀏覽器 | 只在該裝置的瀏覽器 |

### Vercel 網頁版設定

在 Vercel 專案 → Settings → Environment Variables 加以下變數（金鑰最少一個），然後 Redeploy：

- `OPENROUTER_API_KEY`：第一引擎 OpenRouter（openrouter.ai → Keys），香港免 VPN。預設 `openrouter/free`，再 `google/gemma-4-31b-it:free`（可用 `OPENROUTER_MODELS` 改）。
- `GITHUB_TOKEN`：第二引擎 GitHub Models。GitHub → Settings → Developer settings → Fine-grained tokens 建立，權限只開 **Models: Read**。預設先 `openai/gpt-4.1`，再 `openai/o4-mini`（可用 `GITHUB_MODELS` 改）。

- `GEMINI_API_KEY`：後備 Gemini，以及新書推介（要 Google 搜尋）。Google AI Studio（aistudio.google.com → Get API key）建立，有免費額度。
- `APP_PASSCODE`：自訂通行碼。網址是公開的，沒有通行碼的人不能用你的額度。
- 可選 `GEMINI_MODEL`：逗號分隔，按次序試；預設 `gemini-3.8-pro,gemini-3.8-flash`（Pro 不存在、無權限或額度用完就改用 Flash）。
- 可選 `GEMINI_THINKING`：思考深度 `LOW`／`MEDIUM`／`HIGH`／`XHIGH`，預設 `XHIGH`（最深）；越高越慢、越耗額度。

注意：免費額度每日有次數上限；Google 可能用免費版的內容（包括重述和書頁相片）改進其產品。答覆由 Gemini 產生，格式未必每次與 Claude 版一致。

未設定時，網頁版自動退回「複製提問文字」模式。

網頁版另有「新書推介」：每星期第一次打開自動更新（亦可按「更新推介」），用 Gemini＋Google 搜尋，按「當前要解決的問題」和已讀書目推介近一年出版的書，不限圖書館；推介只存在該裝置的瀏覽器。Claude 版和 GitHub 版沒有這一節。

頁底會顯示版本號。兩邊版本號相同，即代表已同步。

## 怎樣用

1. **內文頁**：合上書，先寫重述（最少 20 字），再影這一頁，按「核對我的重述」。答覆會計出你的覆蓋率和講錯的地方。
2. **封面、目錄、前言**：揀「篩書」，影相即可，得到核心主張、批評，以及這本書值不值得讀。
3. **值得驗證的頁**：按「升級為模型卡」，寫第一性原理依據、修正版模型、帶數字和期限的預測、失敗條件、到期日。
4. **到期**：回填結果。命中就入卡，進入 1／3／7／21／60 天的間隔複習；證偽就修正為新版本。
5. **入定・推理**：閱讀前擲硬幣，決定今次入定與否，累積數據驗證「入定令理解更準確」。迴路指標會顯示迴路有否閉合。

每次答覆有 5 節：核對（篩書時是核心主張）、背景與批評、第一性原理、解構、下一步（行動＋三條蘇格拉底式提問）。

## 資料與備份

- 「方法與記錄」頁底的「備份」可匯出 JSON（包括相片）；在另一個版本匯入，就可以把記錄搬過去。
- 匯出 Markdown 筆記只有文字，方便交給其他 AI 檢討。
- **這個 repo 是公開的**：不要把備份 JSON、書頁相片或任何記錄上載到這裏。

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.html` | GitHub Pages 版（由 `build.py` 產生，不要手改） |
| `WORKFLOW.md` | 完整流程：設定、閱讀、驗證、複習、備份、出錯處理、更新 |
| `METHOD.md` | 方法全文（由 `build.py` 從頁面產生，不要手改） |
| `src/reading-log.src.html` | 唯一原始檔 |
| `src/bg.jpg`、`src/VERSION` | 背景相片、發佈日期 |
| `api/ask.js`、`package.json`、`vercel.json` | Vercel 網頁版的答覆函數（OpenRouter → GitHub Models → Gemini） |
| `build.py` | 產生 `index.html`、`METHOD.md` 和 Claude 版（`dist/`） |
| `tests/` | 實際開瀏覽器的測試：`test_local.py` 測 GitHub 版、Vercel 網頁版和 `api/ask.js`，`test_claude.py` 測 Claude 版 |
| `CLAUDE.md` | 給 Claude 的更新守則 |

## 更新記錄

- **2026-11-22（二）**：新增 Vercel 網頁版直接答覆（`api/ask.js`＋通行碼，用 Gemini 免費額度）；repo 加入 `src/`、`build.py`、`tests/`。

- **2026-11-22**：按 Gemini 覆核及 Claude 驗證更新。上載改為雙模式（內文先重述後核對、封面直接篩書）；答覆由 9 節精簡為 5 節；新增模型卡、到期回填和間隔複習；迴路指標改為追蹤建卡、回填、修正；入定實驗改用擲硬幣分配；新增匯出和匯入；頁底加版本號和兩版連結；repo 改為單一原始檔。
- **2026-11-14**：首版：上載書頁取得答覆、按書和章節分層記錄、方法全文、入定・推理分頁、宇宙背景。
