# 霓虹夜行 Neon Night Drive

2D 俯視角霓虹街機賽車。支援電腦、手機（橫向觸控）、可安裝的 PWA、Android App 封裝，以及最多 8 人跨網路即時連線。前端是 HTML、CSS 和 JavaScript Canvas，所有車輛、賽道、城市、特效和圖示都是程式繪製或專案內自製，沒有外部素材。

## 目錄

| 路徑 | 內容 |
|---|---|
| `public/` | 遊戲網頁（也是 PWA 與 App 的內容） |
| `public/shared/` | **單機、AI、伺服器共用**：`data.js`（賽道、車輛、技能、規則、升級資料）、`track.js`（賽道幾何與實體檢查線）、`physics.js`（車輛物理與技能）、`sim.js`（比賽狀態機、計圈、碰撞、排名）、`ai.js`（電腦車手）、`save.js`（具版本號的存檔） |
| `public/js/` | 瀏覽器端：`input.js`（鍵盤＋觸控）、`render.js`（Canvas 繪圖）、`net.js`（連線、預測、插值）、`main.js`（畫面流程） |
| `server/` | Node.js 伺服器：`server.js`（靜態檔案、`/ws`、`/healthz`、`/api/info`）、`rooms.js`（房間與權威模擬） |
| `mobile/` | Android App 封裝專案（Capacitor） |
| `tests/` | 自動測試 |
| `tools/` | 圖示產生器與開發輔助腳本 |

## 啟動方式

需要 Node.js 22.13 以上（使用內建 SQLite 保存車手帳號；玩家不需要安裝，只有開發端與伺服器需要）。

```bash
npm install
npm start            # 開啟 http://localhost:3000
npm test             # 核心規則、存檔、多人伺服器測試
npm run icons        # 重新產生 App 圖示
```

- **只玩單機**：直接用瀏覽器開啟 `public/index.html`（或根目錄的 `index.html`，會自動轉過去）。這種方式沒有多人功能，選單會顯示「沒有多人伺服器」。
- **多人**：必須透過 `npm start` 或部署後的網址開啟。

## 操作

| | 鍵盤 | 手機（橫向） |
|---|---|---|
| 油門／煞車 | `↑`／`W`、`↓`／`S`（停下後倒車） | 右手「油門」「煞車」 |
| 轉向 | `←` `→`／`A` `D` | 左手在左半邊按住左右滑動 |
| 技能 | `Q`、`E` | 右手上方兩個技能鈕 |
| 暫停 | `P`／`Esc` | 右上角 ❚❚ |
| 重新開始 | `R`（僅單機；多人模式無效） | 暫停選單 |

- 可以同時轉向和踩油門，手機支援多指同時按。
- 設定中有「自動油門」。
- 放開按鈕、切換視窗、來電或手勢中斷時，所有輸入都會清除。

## 遊戲內容

- **模式**：
  - 計時挑戰：單人三圈，可挑戰自己的最佳幽靈車。
  - 街機競速：最多 7 台 AI，難度分簡單、普通、困難。
  - 多人房間。
  - 車庫試駕：同一段彎道，按 1 到 4 快速換車比較。
- **賽道與招牌彎**：

  | 賽道 | 招牌彎 |
  |---|---|
  | 霓虹市區 | 百貨霓虹長右彎 |
  | 高雄港灣雨夜 | 碼頭髮夾彎，內側積水 |
  | 山城曙光 | 連續 S 彎接下坡直線 |
  | 未來工業環線 | 長直線盡頭的重煞彎，有 300／200／100 煞車牌 |

- **車款**：夜燕（電動卡丁車）、海霧（四驅拉力車）、墨影（後驅甩尾車）、赤線（高速原型車）。車庫顯示的四項指標由 `physics.measure()` 以實際物理數值量測產生。
- **技能**：每台車從三種技能中裝備兩種，各有能量消耗、冷卻時間和持續時間。能量上限 100。
  - 氮氣加速：消耗 35 能量。
  - 抓地強化：消耗 25 能量。
  - 電能回充：不消耗能量。啟動後 5 秒內完成「有效煞車入彎 → 順利出彎」可回復 40 能量。
- **蓄能**：乾淨過彎或受控甩尾可以蓄能，但必須以時速 180 以上沿賽道正向前進，原地打轉無效。第一次蓄能成功會顯示一次提示。
- **計圈**：檢查線是橫跨路面的實體線段，只涵蓋路面寬度，草地上不算。必須依序由正向穿越所有檢查線和終點線才算一圈。反向穿越會撤銷上一條線。
- **計時**：使用固定步長加上實際經過時間，低幀率時會補足模擬步數，計時不會變慢。單機切到背景會自動暫停；多人比賽不暫停，以伺服器時間為準。
- **升級**：
  - 經驗值來源：完賽、名次、刷新個人紀錄、首次完成地圖。
  - 解鎖內容：車漆、輪框、尾流，以及第 5 級和第 10 級的技能配置欄。
  - 等級**不影響性能**。多人模式所有人使用同一套車輛物理數值，新手也能公平競爭。
- **存檔**：`localStorage` 中的 `neonNightDrive.save`，第 2 版。
  - 第一版的 `neonNightDriveBest` 會讀取並歸入「舊版霓虹市區」，原始鍵不刪除。
  - 成績依「賽道、車款、規則版本」分開保存。
  - 保存範圍是**這個瀏覽器的此網址**。換裝置、換瀏覽器或清除網站資料都不會帶過去；App 和瀏覽器的進度彼此獨立。

## 車手帳號與雲端存檔

- **訪客**：不登入也能玩全部模式，多人只要輸入暱稱就能建立或加入房間。訪客進度存在 `localStorage` 的 `neonNightDrive.save`，介面標示「儲存在此裝置」。
- **登入／註冊**：在主選單按「登入／註冊」。
  - 帳號名稱用來登入，3 到 20 個英文、數字或底線，不分大小寫且不能重複。
  - 密碼至少 8 個字元，伺服器以 scrypt 雜湊保存。
  - 車手暱稱最多 12 字，**可以和別人重複**。
- **雲端保存的內容**：以伺服器產生的唯一**玩家帳號 ID**（UUID）保存暱稱、總經驗值、等級、已解鎖項目和已完成地圖。等級和解鎖項目由總經驗值換算，換算規則在 `public/shared/data.js`。
- **只存在此裝置的內容**：賽道最佳紀錄、幽靈車、設定和車庫搭配。
- **同步狀態**：主選單和帳號畫面會顯示「雲端已同步（時間）」「雲端同步中」或「離線：顯示上次同步的資料」。登入後，此裝置會為該帳號另存一份快取（`neonNightDrive.acct.<帳號ID>`），離線時仍可看到上次同步的進度。
- **多人比賽經驗值**：
  - 由伺服器依正式比賽結果計算（完賽、名次、贏過的人數、首次完成地圖），寫入資料庫的 `awards` 表。
  - 主鍵是「玩家帳號 ID＋比賽 ID」，同一場即使重新整理、斷線重連或封包重送，也只會寫入一次。
  - 結算訊息會依玩家分別傳送，每位玩家只會收到自己的帳號資料。
- **單機比賽經驗值（已登入時）**：
  - 用戶端只回報比賽事實（模式、賽道、是否完賽、名次、車數、是否刷新紀錄），經驗值由伺服器依固定表格計算，並設有上限與節流。
  - 一樣以「帳號 ID＋比賽 ID」去重。離線時先暫存在此裝置，連線後自動補送。
  - 單機結果是用戶端回報的，無法完全防止竄改。多人比賽的結果則完全由伺服器判定。
- **首次登入時此裝置已有訪客進度**：會先並排顯示「此裝置（訪客）」與「雲端帳號」的等級、總經驗、解鎖項目和已完成地圖，再讓玩家選擇其中一項：
  - 「合併本機進度到帳號」：經驗值取兩邊**較高者**，已完成地圖取聯集。兩邊不會相加，雲端進度也不會降低。每台裝置對同一帳號只能合併一次。
  - 「只使用雲端進度」：帳號維持雲端現況。
  - 無論選哪一個，**訪客存檔和舊版紀錄 `neonNightDriveBest` 都不會被刪除或覆蓋**，登出後回到訪客進度。
- **API**（`Authorization: Bearer <登入憑證>`，網頁和 Android App 共用）：
  - `POST /api/auth/register`、`POST /api/auth/login`、`POST /api/auth/logout`
  - `GET /api/me`、`PATCH /api/me`
  - `POST /api/me/import`、`POST /api/me/awards`
- **資料庫**：使用 Node 內建的 SQLite（`node:sqlite`），所以需要 **Node.js 22.13 以上**，不需要另外安裝資料庫套件。資料庫檔案是 `DATA_DIR/neon-night-drive.sqlite`，本機預設在 `./data`。

### 重新部署後保留車手進度

資料庫只是一個檔案，**必須把 `DATA_DIR` 放在主機的持久化磁碟上**，重新部署後進度才會保留。若放在容器的一般檔案系統，每次部署資料都會消失。

- **Render**：`render.yaml` 已設定 `disk`（掛載到 `/data`）和 `DATA_DIR=/data`。持久化磁碟需要付費方案。
- **Fly.io**：先執行 `fly volumes create nnd_data --size 1 --region nrt`，再 `fly deploy`。`fly.toml` 已設定 `[mounts]` 掛載到 `/data`。
- **Docker／VPS**：`docker run -d -p 3000:3000 -v nnd-data:/data --restart unless-stopped neon-night-drive`。`Dockerfile` 預設 `DATA_DIR=/data`。
- **備份**：定期複製 `/data/neon-night-drive.sqlite`。資料庫使用 WAL 模式，請連同 `-wal` 和 `-shm` 檔案一起複製，或先停止服務再複製。
- **單一執行個體**：房間狀態和 SQLite 都在同一台機器上，請維持 `numInstances: 1`，不要水平擴充。

## 多人連線

流程：輸入暱稱 → 建立或加入房間（4 碼房號或邀請連結 `/?room=ABCD`）→ 選車與技能 → 準備 → 同步倒數 → 即時競速 → 排名 → 房主按「再戰」。

- **權威伺服器**：玩家裝置只送方向、油門、煞車和技能輸入。位置、能量、計圈、碰撞和排名都由伺服器用同一份 `public/shared` 程式碼以 60Hz 計算，每秒送 20 次快照。
- **本車預測與他車插值**：本車使用本地預測，收到伺服器狀態後重播尚未確認的輸入來校正。其他車輛以約 110 ms 的延遲做插值。
- **名額**：房間名額由伺服器同步判斷，兩人同時搶最後一席也不會超過 8 人。房滿、房號錯誤、比賽進行中都有提示。
- **起跑**：8 個獨立起跑格，起跑後 4 秒內車輛互相穿透。
- **排名與結算**：排名依「完成圈數、已通過檢查線數、到下一條線的進度」排序。第一名抵達後，其他人有 30 秒時限，時間到統一結算。
- **斷線與重連**：
  - 斷線 30 秒內，用同一個分頁的識別碼重連，會回到原車位。
  - 逾時則標記未完賽。
  - 重新整理、重連或重送封包都不會複製車輛。
  - 結算經驗值用比賽 ID 去重，只會發一次。
- **房主**：房主離開或斷線時，自動移交給下一位車手。

### 同一個 Wi-Fi 測試（區域網路）

1. 在電腦執行 `npm start`。
2. 查電腦的區域網路 IP。Windows 用 `ipconfig` 找「IPv4 位址」（例如 `192.168.1.23`），macOS 或 Linux 用 `ifconfig` 或 `ip addr`。
3. 第一次執行時，Windows 防火牆若詢問，請允許 Node.js 使用「私人網路」。
4. 電腦瀏覽器開 `http://localhost:3000` → 多人連線 → 輸入暱稱 → 建立房間。
5. 連同一個 Wi-Fi 的手機開 `http://192.168.1.23:3000/?room=房號`，或在多人畫面輸入房號。
6. 房主設定地圖後，其他人按「準備」，房主再按「開始比賽」。

> 區域網路使用 http，手機上無法安裝 PWA（PWA 必須使用 https），但遊玩和多人都正常。

### 公開網路測試（電腦連家用 Wi-Fi 開房，手機關掉 Wi-Fi 用行動網路加入）

家用 Wi-Fi 的電腦通常在 NAT 後面，行動網路的手機連不到 `192.168.x.x`，所以伺服器必須放在**公開網址**上。可以用下列兩種方式之一。

**方式 A：部署到雲端主機（建議，見下方「部署」）**

1. 部署完成後取得網址，例如 `https://neon-night-drive.onrender.com`。
2. 開啟 `https://你的網址/healthz`，確認回傳 `{"ok":true,...}`。
3. 電腦（家用 Wi-Fi）開 `https://你的網址` → 多人連線，畫面應顯示「已連線伺服器・延遲 xx ms」→ 建立房間 → 按「複製邀請連結」。
4. 把連結用 LINE 傳到手機。手機**關閉 Wi-Fi**，只用 4G／5G 行動網路開啟連結 → 輸入暱稱 → 加入房間。
5. 電腦端的房間人數會變成 2/8，手機按「準備」後，電腦按「開始比賽」。
6. 比賽中可以把手機切到飛航模式約 5 秒再切回。手機會自動重連並回到原車位，電腦端會看到該車先標示「斷線」，之後恢復。

**方式 B：暫時把本機伺服器分享到網路（不部署）**

1. 電腦執行 `npm start`。
2. 另開終端機，用可轉發 WebSocket 的 HTTPS 通道工具，例如 Cloudflare Tunnel：`cloudflared tunnel --url http://localhost:3000`。它會給一個 `https://xxxx.trycloudflare.com` 網址。
3. 之後步驟同方式 A 的 3 到 6，網址改成通道網址。

## 部署

伺服器把房間狀態保存在記憶體中。請部署到**支援長時間 WebSocket 連線、單一執行個體**的主機，例如 Render Web Service、Fly.io、Railway，或自有的 VPS 加 Docker。不要部署到只支援短連線的 Serverless 平台。

遊戲網頁和 `/ws` 由同一個網域提供。主機終結 HTTPS 後，瀏覽器會自動使用 `wss://同網域/ws`。程式裡沒有寫死 localhost。

- **環境變數**：見 `.env.example`，包括 `PORT`、`HOST`、`ALLOWED_ORIGINS`、`MAX_ROOMS`、`RECONNECT_GRACE_MS`。
- **健康檢查**：`GET /healthz` 回傳 `{ ok, version, uptime, rooms, players }`。
- **Render**：把專案推到 GitHub → Render「New → Blueprint」→ 選擇儲存庫。Render 會讀取 `render.yaml`，`neon-night-drive` 資料夾需設為 Root Directory。
- **Fly.io**：`fly launch --no-deploy --copy-config`，再執行 `fly deploy`（使用 `Dockerfile` 與 `fly.toml`）。
- **Docker／VPS**：
  1. `docker build -t neon-night-drive .`
  2. `docker run -d -p 3000:3000 --restart unless-stopped neon-night-drive`
  3. 前面加 Caddy 或 Nginx 提供 HTTPS。Nginx 需要設定 `proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`。

### 發布新版

1. 修改 `public/sw.js` 的 `VERSION`，並在 `public/shared/data.js` 遞增 `GAME_VERSION`。
2. 若改到物理或計圈規則，也要遞增 `RULES_VERSION`，成績會分開保存。
3. 重新部署。已安裝的 PWA 會在背景下載新版，但**不會在比賽中切換**。玩家回到選單或結算畫面時會看到「有新版本，點此更新」。

## 手機安裝（PWA）

PWA 必須以 **https** 公開網址開啟才能安裝，localhost 除外。安裝後會以獨立全螢幕視窗開啟，單機模式可以離線遊玩，多人需要網路。

- **Android（Chrome）**：開啟網址 → 選單出現「安裝 App」按鈕時直接點，或點右上角「⋮」→「安裝應用程式」或「加到主畫面」。
- **iPhone（Safari）**：開啟網址 → 點下方分享按鈕「□↑」→「加入主畫面」→「新增」。iOS 必須使用 Safari 安裝。

## Android App（Capacitor）

App 內建一份遊戲網頁，所以單機可以離線遊玩。多人會連到與網頁版**相同的正式伺服器**，App 玩家和網頁玩家可以進同一個房間。

需要 JDK 17 以上、Android Studio（或 Android SDK command-line tools，API 35）和 Node.js。

```bash
cd mobile
npm install
# Windows PowerShell：$env:NND_SERVER_URL="https://你的網址"
export NND_SERVER_URL=https://你的網址
npm run add-android        # 第一次：產生 android/ Gradle 專案
npm run sync               # 之後每次更新網頁內容
```

**建置測試版 APK**：執行 `npm run apk:debug`，產出 `android/app/build/outputs/apk/debug/app-debug.apk`。這個檔案可直接安裝測試，但不適合公開發布。

**簽署正式版 APK**：

1. 建立金鑰，只需一次，請妥善備份，遺失後就無法更新 App：

   ```bash
   keytool -genkeypair -v -keystore neon-release.jks -alias neon -keyalg RSA -keysize 2048 -validity 10000
   ```

2. 在 `mobile/android/key.properties` 寫入以下內容。這個檔案不要提交到 Git：

   ```properties
   storeFile=../../neon-release.jks
   storePassword=你的密碼
   keyAlias=neon
   keyPassword=你的密碼
   ```

3. 在 `mobile/android/app/build.gradle` 的 `android { }` 中加入 `signingConfigs.release`，讀取 `key.properties`，並把 `buildTypes.release.signingConfig` 設為 `signingConfigs.release`。也可以用 Android Studio 的「Build → Generate Signed App Bundle / APK」。
4. 執行 `npm run apk:release`。
5. 驗證簽章：`apksigner verify --print-certs android/app/build/outputs/apk/release/app-release.apk`。

**發布下載**：

1. 執行 `npm run publish-apk`。它會把 APK 複製到 `public/downloads/neon-night-drive.apk`，並寫入版本資訊。
2. 重新部署伺服器。只有在 `/api/info` 確認 APK 檔案真的存在時，網頁主選單才會顯示「下載 Android App（APK）」按鈕。目前沒有 APK，所以按鈕不會出現。
3. 玩家安裝時，Android 需要允許「安裝未知應用程式」。

若伺服器設定了 `ALLOWED_ORIGINS`，請加入 `https://localhost`，這是 App 內建網頁的來源。

> 目前 `mobile/android/` 已由 `npx cap add android` 產生，內建網頁使用的是佔位網址 `https://example.invalid`。部署取得正式網址後，請用 `NND_SERVER_URL=正式網址 npm run sync` 重新同步，再建置 APK。

## 驗收紀錄

| 分類 | 結果 | 方式 |
|---|---|---|
| 本機自動測試 | 46 項全部通過 | `npm test`（Windows、Node 22.23） |
| 本機瀏覽器實測 | 24 項全部通過，前端沒有 JavaScript 錯誤 | `node tools/browser-check.js`（Chrome 無頭模式，含手機橫向觸控模擬與兩個獨立瀏覽器的多人連線），截圖在 `tools/browser/` |
| 本機多客戶端（8＋1 條 WebSocket） | 通過 | `tests/server.test.js` |
| 車手帳號與雲端存檔（API＋多人結算＋重新啟動） | 7 項全部通過 | `tests/account.test.js` |
| 帳號瀏覽器實測（電腦、手機、同名玩家、訪客、模擬重新部署） | 17 項全部通過 | `node tools/browser-account.js`，截圖 `tools/browser/11`～`14` |
| 正式主機上重新部署後資料保留 | **尚未執行** | 需要實際主機與持久化磁碟；本機以「關閉伺服器後用同一個資料夾重新啟動」模擬 |
| 跨網路真機測試 | **尚未執行** | 需要公開主機與實體手機，步驟見「公開網路測試」 |
| 手機安裝（PWA／Android／iPhone） | **尚未執行** | 需要 https 公開網址與實體裝置 |
| Android APK 建置與簽署 | **尚未執行** | 需要 JDK 17、Android SDK 與簽署金鑰；目前沒有 APK，下載按鈕不會顯示 |

## 測試

`npm test` 執行 `tests/` 下的三組測試：

- `core.test.js`：
  - 四張賽道不自我重疊。
  - 沿中心線正向跑恰好計三圈。
  - 逆向三圈、起點來回 30 次、從草地繞過檢查線、直線切過港灣髮夾彎，都不計圈。
  - 四台車由 AI 以實際物理跑完四張賽道各三圈。
  - 倒數期間不移動、不計時；完賽後成績鎖定。
  - 車款實測指標與試駕彎道表現不同。
  - 原地打轉無法取得能量；技能的消耗、冷卻與能量上限。
- `save.test.js`：舊紀錄升級、經驗值只發一次、重新開啟後等級與解鎖仍在、損毀存檔可以恢復。
- `server.test.js`：使用真實 WebSocket 的本機多客戶端測試。
  - 8 個獨立連線同場跑完比賽，第 9 個收到房滿，兩人同時搶最後一席只有一人成功。
  - 比賽中禁止加入，結算只送一次。
  - 斷線重連回到原車位且不複製車輛；同一識別碼從第二個分頁連線不會多出車輛。
  - 重複封包被忽略，逾時標記未完賽，多人無法重開整場。
  - 房主離開與斷線時移交房主。
  - 健康檢查與 API；未產生 APK 時不提供下載；靜態檔案不能越界讀取。
