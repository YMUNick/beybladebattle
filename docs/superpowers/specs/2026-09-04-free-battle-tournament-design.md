# 自由對戰（賽事舉辦）功能設計

日期：2026-09-04
狀態：已核可設計方向，待實作計畫

## 目標

在現有 Beyblade X Battle Scorer（單檔 `index.html`）首頁新增「⚔ 自由對戰」入口，讓使用者能在手機/平板上**舉辦一場比賽**：新增比賽 → 選擇賽制 → 自由新增參賽者 → 開始 → 在賽事頁點選每場勝方，即時看到 Challonge 風格的積分榜與名次。

## 範圍（第一版）

支援 3 種賽制：

1. **循環賽（Round Robin）**
2. **單淘汰（Single Elimination）**
3. **瑞士制（Swiss System）**

資料模型與「賽制引擎」介面**一次設計到位**，涵蓋日後要加的雙淘汰、分組+淘汰、積分賽，但本版不實作那 3 種（UI 上以「即將推出」呈現或不顯示）。

## 非目標（本版不做）

- 不串接現有的官方風格對戰計分面板（`#battle`）。記分採「在賽事頁點勝方」的快速方式。
- 不做雲端同步／多人連線；資料只存在本機 `localStorage`。
- 不做雙淘汰、分組+淘汰、積分賽的排程邏輯。
- 不強制填每場比分（比分為選填，僅用於 tiebreak）。

## 架構總覽

沿用現有慣例：

- 單一 `index.html`、無外部相依。
- 各畫面為 `.screen` 區塊，用既有的 `showScreen(id)` 切換。
- 沿用既有 `askConfirm()`、`toast()`、霓虹樣式變數（`--neon` 等）與 `.ghostbtn` / `.bigbtn` 元件。
- 新增資料層（localStorage）、賽制引擎（純函式）、兩個新畫面。

### 新增畫面

1. **`#freebattle`（賽事列表）**
   - 標題列（沿用 `.brand`）＋「🏠 回到設定」。
   - 頂部一顆 `＋ 新增比賽`。
   - 已建立比賽的卡片清單：名稱、賽制、人數、進度（例：第 2/5 輪 或 已完成）、建立時間；點卡片進入詳情；每張卡可刪除（`askConfirm`）。
   - 空狀態提示文字。

2. **`#tournament`（賽事詳情，仿 Challonge）**
   - 頁首：比賽名稱、賽制、狀態（進行中/已完成）、返回列表。
   - **積分榜區**：表格（見下）。
   - **對戰區**：依輪次分組列出每場對戰，點勝方記錄；已完成場次顯示結果並可「復原」。
   - 完成時於頂部顯示冠軍橫幅。

### 首頁改動

`#setup` 的 `.subbtns` 內新增：`<button class="ghostbtn" id="gotoFreeBattle">⚔ 自由對戰</button>`，事件呼叫 `showScreen('freebattle')`。

## 新增比賽流程（wizard，位於 `#freebattle` 內以彈窗或子畫面呈現）

1. **比賽名稱**（必填；預設「自由對戰 + 日期」）
2. **選擇制度**：3 張可選卡片，附規則頁既有的一段說明文字（循環賽／單淘汰／瑞士制）。
3. **賽制專屬設定**：
   - 循環賽：無（可選「單循環/雙循環」，預設單循環）。
   - 單淘汰：可選「是否打季軍賽」（預設否）、「種子順序＝輸入順序 / 隨機」（預設輸入順序）。
   - 瑞士制：輪數（預設 `ceil(log2(n))`，可調 3–8）。
4. **新增參賽者**：文字輸入框 ＋「新增」；一列一位，可編輯/刪除；人數不限（最少 2 人才能開始；名稱不可重複，重複時自動加序號或提示）。
5. **開始**：驗證（≥2 人）→ 呼叫該賽制引擎 `init()` 產生對戰 → 存入 localStorage → 進入 `#tournament`。

## 資料模型（localStorage）

鍵：`bb_tournaments`，值為陣列。單一比賽物件：

```json
{
  "id": "t_20260904_ab12",
  "name": "週五 4PM 自由對戰",
  "format": "round_robin | single_elim | swiss",
  "options": { "doubleRound": false, "thirdPlace": false, "seed": "input|random", "rounds": 4 },
  "createdAt": 1757000000000,
  "participants": [
    { "id": "p1", "name": "陀螺破壞者" },
    { "id": "p2", "name": "安息滅霸王" }
  ],
  "state": {
    "rounds": [
      {
        "index": 1,
        "matches": [
          { "id": "m1", "p1": "p1", "p2": "p2", "winner": "p1", "score": [4, 2], "bye": false }
        ]
      }
    ],
    "completed": false,
    "champion": null
  }
}
```

- `winner` 為 `null` 表示未打；`bye`（輪空）自動判勝、不需點選。
- `score` 選填（`[勝方分, 敗方分]` 或 `null`）。

## 賽制引擎介面（純函式模組，便於測試）

每個賽制實作同一組函式，UI 只依賴此介面：

```
engine.init(participants, options) -> state
engine.recordResult(state, matchId, winnerId, score?) -> state   // 記錄；必要時解鎖/產生下一輪
engine.undoResult(state, matchId) -> state
engine.standings(state, participants) -> [{ rank, playerId, name, wins, losses, winPct, diff }]
engine.isComplete(state) -> boolean
engine.champion(state) -> playerId | null
engine.view(state) -> { type: 'rounds'|'bracket', rounds:[...] }   // 給 UI 渲染
```

### 循環賽（round_robin）
- 以 circle method 排程：人數為奇數時加一個虛擬 BYE，輪數 = n−1（奇數則 = n，含輪空）。
- `init()` 直接產生所有輪次與對戰。
- 排名：勝場多者優先；同分 tiebreak 依序為 對戰勝負（head-to-head）→ 得分差 → 名稱。
- `isComplete`：所有非輪空對戰皆有 winner。

### 單淘汰（single_elim）
- bracket 大小 = 不小於 n 的 2 次方；不足者由高種子先輪空（bye）。
- `init()` 產生第 1 輪；`recordResult()` 在該場所屬配對兩場皆決出後，把勝者填入下一輪對戰（動態填充）。
- 種子：`seed==='input'` 依輸入順序標準種子排列（1 vs N, 2 vs N−1…）；`random` 則先洗牌。
- 排名：冠軍=1、亞軍=2、四強並列 3、八強並列 5…（依淘汰輪次定名次）。
- 選填季軍賽（`thirdPlace`）。

### 瑞士制（swiss）
- 固定 `options.rounds` 輪。人數為奇數時每輪一人輪空（自動判勝，同一人不重複輪空優先）。
- 第 1 輪：依種子（輸入順序）上下對半配對（1 vs n/2+1…）。
- 之後每輪：依目前勝場排序，相鄰配對，**避免重賽**（若相鄰已對戰過，往下找可行對手；找不到時允許重賽並提示）。
- 下一輪在**本輪所有對戰記錄完**後才產生（`recordResult` 觸發）。
- 排名：勝場 → （選配）對手勝場和（Buchholz）→ 得分差 → 名稱。第一版 tiebreak 先做 head-to-head/得分差即可，Buchholz 標記為之後可加。

## 積分榜（Challonge 風）UI

表格欄位：**排名 | 選手 | 勝-敗 | 勝率 | 積分差**

- 循環賽／瑞士制：即時排名，隨每場記錄更新。
- 單淘汰：以最終/目前名次呈現（未定名次者標「—」）。
- 樣式沿用霓虹風：表頭用 `--neon`，列間交錯底色，冠軍列高亮。
- 手機上可橫向捲動或精簡欄位（勝率可在窄螢幕隱藏）。

## 對戰區 UI

- 依輪次分段（「第 N 輪」標題）。
- 每場一列：`選手A  [ 記為勝 ]  vs  [ 記為勝 ]  選手B`；已決出者顯示 `勝方 ✓ (比分)` 與小「復原」鈕。
- 輪空場次顯示「輪空（自動晉級）」。
- 淘汰制可用簡易括號視圖（依 `view()` 的 rounds 逐輪呈現）；第一版以「逐輪對戰列表」即可，括號連線為加分項。
- 選填比分：點勝方後可再點小圖示輸入比分（非必填）。

## 錯誤處理與邊界

- 參賽者 < 2：不可開始，提示。
- 名稱重複：自動加序號（例「小明」「小明 2」）或即時提示，擇一（實作時採自動加序號）。
- localStorage 寫入失敗（容量/隱私模式）：`toast` 提示，仍可在記憶體中繼續本場。
- 刪除比賽：`askConfirm` 二次確認。
- 記錄勝方後允許「復原」；淘汰/瑞士制復原時需一併清掉其連動產生的後續輪次/晉級。

## 測試策略

- 將 3 個賽制引擎抽為純函式（不碰 DOM），針對關鍵邏輯加輕量測試：
  - 循環賽：n 為奇/偶時每人對戰場數正確、無重複配對。
  - 單淘汰：bye 分配、勝者晉級、名次計算。
  - 瑞士制：輪數正確、避免重賽、奇數輪空不重複、排名排序。
- UI 與 localStorage 手動驗證（沿用專案無建置的現況）。
- 測試載體：新增一個獨立的小型測試頁或 `<script type="module">` 斷言片段；不引入建置工具。

## 分階段實作建議（供實作計畫參考）

1. 資料層 + `#freebattle` 列表 + 新增比賽 wizard 骨架 + 首頁按鈕。
2. 循環賽引擎 + 積分榜 + 對戰區（端到端可跑一場）。
3. 單淘汰引擎（含 bye 與晉級、名次）。
4. 瑞士制引擎（含動態下一輪與避免重賽）。
5. 收尾：復原連動、比分選填、樣式打磨、測試補齊。
