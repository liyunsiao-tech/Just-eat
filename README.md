# eat

`eat` 是一個 local-first 的吃什麼決定器：保留原本「從附近候選中直接幫我決定一家」的低摩擦流程，再用當下的一句話、每次選擇與本機 Taste Profile 讓決定逐漸更像你。

本專案是獨立的新 repository，使用乾淨 Git history；不以 submodule、symlink 或工作樹方式修改任何原始 `roulette-eater` repository。驗收時以唯讀方式核對原始功能，並以 HTML、CSS、Vanilla JavaScript、PWA、Google Places 與 weighted random 的最小架構完成安全延伸。

## 核心流程

1. 設定餐期、搜尋範圍、預算與口味方向。
2. 選填一句當下需求，例如「今天想吃熱的，不要麵」；明確排除條件優先於長期偏好。
3. 允許瀏覽器定位後，使用 Google Places API (New) 的 `Place.searchByText()` 取得附近真實餐廳候選；搜尋結果再以 client-side 精確距離檢查落在所選半徑內。
4. 若 AI 可用，server-side proxy 將當下需求、設定、Taste Profile、近期行為與候選清單送到 OpenAI-compatible chat completion endpoint。
5. AI 只能回傳候選清單裡的 `placeId`；格式錯誤、未知 ID、timeout、HTTP 錯誤或未設定 AI 時，自動回到原本 weighted random。
6. 每次候選呈現（`shown`）以及「吃這家」「換一家」「收藏」「不想吃這類」都會寫入本機 interactions，並重算 Taste Profile；`shown` 不會單獨增加或降低偏好分數。

沒有 Google key 或沒有定位權限時，App 會明確顯示「示範候選」並仍可測試基本決定流程；示範資料不會冒充附近真實餐廳，也不會送進 AI 個人化流程。

## 架構

```text
瀏覽器（HTML/CSS/Vanilla JS/PWA）
       │
       ├─ navigator.geolocation（只在當次搜尋記憶體使用，不寫入 localStorage）
       ├─ Google Maps JavaScript + Places（browser key 由 server runtime 注入）
       ├─ localStorage：interactions + Taste Profile + 非敏感設定
       └─ POST /api/recommend
              │
              ├─ server 驗證與清理 payload
              ├─ structured filters／active blacklist 過濾候選
              ├─ AI 可用時保留完整候選，由模型理解 currentNeed；不可用時採保守 parser
              ├─ OpenAI-compatible AI（API key 僅 server environment）
              └─ 失敗時 weighted random fallback
```

沒有登入、帳號、Supabase、Firebase、SQL database、vector database、RAG、Agent 或聊天介面。這個版本刻意把穩定的基本決策流程放在 AI 之外。

## 技術

| 類型 | 技術 | 用途 |
| --- | --- | --- |
| 前端 | HTML、CSS、Vanilla JavaScript ES modules | 低依賴的主要體驗 |
| PWA | Web App Manifest、Service Worker | 可安裝與 shell cache；API 永遠走網路 |
| 地點 | Google Maps JavaScript API + Places API (New) | `Place.searchByText()` 取得當下附近真實餐廳 |
| 個人化 | localStorage、可替換 OpenAI-compatible endpoint | 本機口味輪廓與候選選擇 |
| 後端 | Node.js 20+ 原生 `http` server | 靜態檔案、runtime config、AI proxy |

## 安裝與執行

需要 Node.js 20 或以上；本專案沒有必須安裝的 npm dependency。

```bash
cp .env.example .env
# 編輯 .env，只在本機填入 runtime 設定
npm start
```

打開 <http://127.0.0.1:4173>。若不填任何 key，仍可使用示範候選與 weighted random，並可完整測試 interactions 與 Taste Profile。

### Google Places 安全設定

`GOOGLE_MAPS_BROWSER_KEY` 只從 server environment 在執行時傳給瀏覽器，不會出現在 source code、Git 或 README。因為它是 browser key，必須在 Google Cloud Console：

- 設定 HTTP referrer restriction，只允許本機開發網址與正式網域，不要使用 unrestricted。
- API restriction 只允許實際使用的 Maps JavaScript API 與 Places API (New)；若專案另列 legacy Places API，請依實際需求檢查，不要為了方便開放全部 API。
- 設定日／分鐘 quota 與 usage／billing alert。
- 本機與 production 使用不同 key；production key 不要放進 local repository。
- 若舊 `roulette-eater` 的 browser key 曾公開，請在 Google Cloud Console 旋轉或撤銷，不要搬到 `eat`。

目前只要求 Place ID、名稱、地址、位置、評分、評分數、價格、營業狀態、類型、Google Maps URI 與照片欄位，不使用 `fields: ["*"]`。照片 URI 只在目前頁面的 fresh candidate 記憶體中使用，不寫入 localStorage；顯示照片時一併顯示 Google Places 回傳的 photo author attribution。

### AI 設定

正式部署目前採用 Groq 的 OpenAI-compatible API；本專案用原生 `fetch`，不安裝 Groq 或 OpenAI SDK。Groq 的 base URL 與 Chat Completions 路徑遵循其 OpenAI compatibility 介面。

```dotenv
AI_BASE_URL=https://api.groq.com/openai/v1
AI_MODEL=openai/gpt-oss-120b
AI_API_KEY=只存在本機或部署平台的 server environment
AI_TIMEOUT_MS=5000
```

AI adapter 使用一般 `/chat/completions` 介面；保留 `AI_BASE_URL`、`AI_MODEL` 與原生 fetch，之後仍可替換成其他 OpenAI-compatible provider。`AI_API_KEY` 只放在本機 `.env` 或部署平台的 server environment，不會放進前端、README、console log、browser response 或 Git。

每次按「幫我決定」最多發出一次 AI request；`shown`、`rerolled`、收藏、黑名單與背景流程不會另發 AI request。AI timeout、429、HTTP error、invalid JSON、未知 `placeId` 或 provider 不可用時，server 自動回到 weighted random。Groq Console 的 Data Controls／Zero Data Retention 若要使用，請在 provider console 另行設定；本專案不假設該設定已啟用。

### Render Free Web Service

目前部署目標是 Render Free Web Service，使用 Node runtime，不需要 Express、Next.js 或其他 framework。

- Build Command：`npm install`
- Start Command：`npm start`
- Health Check Path：`/api/health`
- Service 必須提供 `PORT`；server 會監聽 `0.0.0.0`，符合 Render Web Service 的對外綁定需求。
- 在 Render Environment Variables 設定 `GOOGLE_MAPS_BROWSER_KEY`、`AI_BASE_URL`、`AI_MODEL`、`AI_API_KEY`、`AI_TIMEOUT_MS=5000`；不要把值寫回 repository。
- 使用者互動與 Taste Profile 仍只存在 browser localStorage；Render 不使用檔案或 database 保存它們。

## 本機資料與隱私

localStorage 只保存最近最多 200 筆互動、由互動重算的 Taste Profile，以及餐期／範圍等非敏感設定。互動不保存 GPS；GPS 只留在當次瀏覽器記憶體，供 Places 搜尋使用。資料不會自動上傳或跨裝置同步。

建議使用瀏覽器的 site data 清除功能移除本機足跡；不要把瀏覽器 profile、localStorage export、`.env` 或任何真實使用紀錄加入 repository。

## 測試與安全稽核

```bash
npm test
git init -b main
git add .
npm run security             # 第一次 commit 前掃描 staged files
git diff --cached --check
git status --short
git commit -m "feat: create local-first eat decision maker"
npm run security:history    # commit 後掃描完整 Git history
```

`.gitignore` 會排除 `.env`、runtime output、local test data 與常見 credential 檔。`scripts/secret-audit.mjs` 會檢查常見 API key／token／private key／JWT、GPS-like 小數與 credential-like 路徑。請在推送 GitHub 前再次於乾淨 checkout 執行 staged 與 history audit。

## 限制與下一步

- Google Places 必須有正確 referrer、API 啟用、quota 與定位權限；否則產品會清楚退回示範候選，不會假裝有附近真實資料。
- 自然語言是 free-form currentNeed：AI 可用時保留結構化篩選後的完整候選，交給模型理解否定、例外與暫時需求；AI 不可用時只對簡單、明確、無例外的排除（例如「不要麵」）採保守 hard filter，避免把複合語意誤刪。
- localStorage 是單一裝置資料，沒有登入、同步與跨裝置 profile；這是刻意的隱私與 12 小時範圍取捨。
- 後續可在不改變核心契約的前提下加入更完整的 Places 欄位、可解釋的 profile 編輯與部署平台 adapter。

## 第三方服務與授權

- Google Maps Platform：執行時由使用者自行設定 project、API、quota 與 billing；請依 Google Maps Platform 條款與顯示要求使用。
- AI provider：由部署者自行選擇 OpenAI-compatible 服務與其條款；本專案不附帶模型、key 或資料集。
- 本專案程式碼採 MIT License，見 [LICENSE](LICENSE)。

## License

MIT
