# Just-eat

## 問題與目標

很多時候不是附近沒有餐廳，而是人在餓的時候不想比較一長串選項。`Just-eat` 是一個 local-first 的吃什麼決定器，讓使用者輸入當下的一句話，再從附近候選中直接選出一家。

目標使用者是想快速決定下一餐、又希望結果慢慢貼近自己口味的人。`Just-eat` 結合餐期、距離、預算、評分與分類等條件，也記住每次看見、接受、重抽、收藏或避開的選擇；口味輪廓只留在使用者的裝置上，沒有登入與跨裝置同步。

## 核心功能

- 以餐期、搜尋半徑、預算、最低評分、分類、營業狀態與連鎖店偏好縮小候選範圍。
- 使用瀏覽器定位與 Google Places API (New) 搜尋附近真實餐廳，並在瀏覽器端再次檢查實際距離。
- 讓使用者用 `currentNeed` 描述當下需求；AI 可用時由 server-side proxy 從既有候選中選一家，不能自行捏造餐廳。
- AI 未設定、逾時、回應錯誤或選擇不合法時，回到加權隨機，基本決定流程仍可使用。
- 將 `shown`、`accepted`、`rerolled`、`favorited` 與 blacklist 等互動寫入本機，重新計算 Taste Profile；`shown` 只代表看過，不會單獨增加偏好分數。
- 沒有 Google key 或定位權限時切換到明確標示的示範候選；PWA 會快取應用程式外殼，但 API 與附近餐廳搜尋仍需要網路。

## 系統架構

```text
[使用者瀏覽器]
  |-- HTML / CSS / Vanilla JavaScript / PWA
  |-- navigator.geolocation（只在當次搜尋使用，不寫入 localStorage）
  |-- Google Maps JavaScript API + Places API (New)
  |-- localStorage（互動、Taste Profile、非敏感設定）
  +-- POST /api/recommend
          |
          v
[Node.js 20+ 原生 http server]
  |-- 驗證與清理 request payload
  |-- 套用結構化條件與 active blacklist
  |-- AI 可用：把當下需求、口味輪廓、近期互動與候選送至 Groq
  |             +-- 只接受候選清單中的 placeId
  +-- AI 不可用或失敗：weighted random fallback
```

瀏覽器先取得候選並套用表單條件；真正的餐廳資料來自 Google Places，示範候選則是程式內建的測試資料。`POST /api/recommend` 只在需要個人化選擇時呼叫 server，API key 留在 server environment。專案沒有登入、伺服器資料庫、向量資料庫或 RAG；互動與口味輪廓由瀏覽器的 `localStorage` 保存。

## 使用技術

| 類型 | 技術／服務 | 用途 |
| --- | --- | --- |
| AI 模型 | Groq OpenAI-compatible Chat Completions；預設 `openai/gpt-oss-120b` | 從已提供的候選中理解 `currentNeed` 並選出一家；失敗時不阻斷主流程 |
| 前端 | HTML、CSS、Vanilla JavaScript ES modules | 低依賴的主要使用介面與互動流程 |
| 後端 | Node.js 20+、原生 `http`、原生 `fetch` | 靜態檔案、runtime config、推薦 API 與 AI proxy |
| 地點服務 | Google Maps JavaScript API、Places API (New) | 取得附近餐廳、距離、評分、價格、營業狀態與照片欄位 |
| 本機資料 | `localStorage`、Web App Manifest、Service Worker | 保存裝置端互動與口味輪廓，提供可安裝的 PWA 外殼 |
| Sponsor 技術 | 無／未參加 | 本專案目前沒有指定 Sponsor Challenge |

## 安裝與執行

需要 Node.js 20 或以上。本專案沒有必須安裝的 npm runtime dependency，但仍可依下列步驟安裝與啟動：

```bash
git clone https://github.com/liyunsiao-tech/Just-eat.git
cd Just-eat
npm install
cp .env.example .env
npm start
```

開啟 <http://127.0.0.1:4173>。不填任何 key 時仍可使用示範候選、加權隨機與本機 Taste Profile。

### 環境變數

```dotenv
PORT=4173

# 選填：Google Maps JavaScript browser key
GOOGLE_MAPS_BROWSER_KEY=

# 選填：server-side AI 設定
AI_BASE_URL=https://api.groq.com/openai/v1
AI_MODEL=openai/gpt-oss-120b
AI_API_KEY=
AI_TIMEOUT_MS=5000
```

`GOOGLE_MAPS_BROWSER_KEY` 只會由 server 在執行時提供給瀏覽器。正式使用時，請在 Google Cloud Console 設定 HTTP referrer restriction、API restriction、quota 與 billing alert，不要使用 unrestricted key，也不要把 key 提交到 Git。

填入 Google key 並允許定位後，應用程式會搜尋附近真實餐廳。AI 設定只放在本機 `.env` 或部署平台的 server environment；AI 逾時、HTTP 錯誤、格式錯誤、未知 `placeId` 或 provider 不可用時，會自動回到 weighted random。

### Render Free Web Service

目前部署環境為 Render Free Web Service，公開展示網址尚未提供。Render 設定如下：

- Build Command：`npm install`
- Start Command：`npm start`
- Health Check Path：`/api/health`
- 在 Render Environment Variables 設定 `GOOGLE_MAPS_BROWSER_KEY`、`AI_BASE_URL`、`AI_MODEL`、`AI_API_KEY` 與 `AI_TIMEOUT_MS=5000`。
- server 會監聽 Render 提供的 `PORT` 與 `0.0.0.0`；Render 不保存使用者的互動或 Taste Profile。

### 測試與安全稽核

```bash
npm test
npm run security          # 對已 staged 的檔案掃描
npm run security:history  # 對 Git history 掃描
```

## 作品展示

- 作品展示網址（選填）：尚未提供
- 評選影片：製作中

## 限制與未來工作

- Google Places 需要有效的 API 設定、referrer restriction、quota、billing 與定位權限；缺少其中一項時，產品會顯示示範候選，不假裝取得附近真實資料。
- `currentNeed` 是自由文字。AI 可用時會保留結構化條件後的候選，交給模型處理否定、例外與暫時需求；AI 不可用時只對簡單且明確的排除條件採保守 hard filter。
- Places 欄位無法可靠判斷候位時間、安靜程度、座位、份量、油膩程度、營養或精確辣度。過敏需求也不能由 Places 資料推導安全性，使用者仍必須向餐廳確認。
- `localStorage` 最多保留最近 200 筆互動，只適用於目前裝置，沒有帳號、跨裝置同步或伺服器備份；GPS 不會寫入互動紀錄。
- PWA 的外殼可在網路不穩時由快取協助載入，但 Google Places 與推薦 API 仍需要網路。Render Free Web Service 也可能因長時間閒置而暫停。
- 後續可加入可解釋的口味輪廓編輯、更完整的 Places 欄位與其他部署平台 adapter；若加入帳號或同步，必須重新設計資料保存與隱私邊界。

## 第三方服務、資料與素材

- [Google Maps Platform／Places JavaScript API 文件](https://developers.google.com/maps/documentation/javascript/reference/place)：執行時搜尋附近餐廳與取得 Places 欄位。使用者或部署者自行管理 Google Cloud project、API、quota 與 billing，並依 [Google Maps Platform 條款](https://cloud.google.com/maps-platform/terms) 及 Google 的 attribution 要求使用；本專案不內建 Google API key，也不把 Places 資料當成靜態資料集提交。
- [Groq API 文件](https://console.groq.com/docs/api-reference)：提供選用的 OpenAI-compatible `/chat/completions` endpoint。API key 由部署者自行申請並只放在 server environment；Groq 服務依其平台條款使用，本專案不附帶模型權重或訓練資料集。
- [Render Web Services 文件](https://render.com/docs/web-services)：作為目前的部署平台；Render 帳號、服務設定、計費與部署條款由部署者管理。
- `icons/` 內的 logo、favicon 與 PWA 圖示：團隊自製或已取得授權，依團隊持有或取得的授權使用。
- `app.js` 內的示範餐廳：僅供沒有 Google key 或定位時測試流程的內建資料，不代表真實店家，也不是外部資料集。
- 本專案程式碼採 MIT License，授權文字見根目錄的 [LICENSE](LICENSE)。

## 團隊成員

| 姓名 | 分工 |
| --- | --- |
| 全對 | AI 控制 |
| 你說的都對 | 規劃 |
| 啊對對對對 | 資料蒐集與提供想法 |

## License

MIT

本專案的程式碼採 MIT License。它允許他人使用、複製、修改、散布與商用，但散布時必須保留著作權與授權聲明；軟體依現況提供，不保證沒有問題。這只適用於本專案程式碼，不會改變 Google Maps、Groq、Render 或其他外部服務各自的條款與資料權利。詳情可參考 [MIT License 官方說明](https://opensource.org/license/mit) 與根目錄的 [LICENSE](LICENSE)。
