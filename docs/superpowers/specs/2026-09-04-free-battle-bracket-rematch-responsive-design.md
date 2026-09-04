# 自由對戰：重賽、單淘汰括號圖、比分編輯、響應式 設計

日期：2026-09-04
狀態：已核可設計方向，待實作計畫
前置：延伸 `2026-09-04-free-battle-tournament-design.md`（自由對戰基礎功能已上線）

## 目標

在已上線的「自由對戰」上新增 4 項能力：

1. **依現有玩家重賽**：一鍵用相同名單+賽制開新一場，保留原紀錄。
2. **全面響應式**：所有自由對戰畫面適配手機到桌機。
3. **單淘汰對戰圖**：把單淘汰的對戰區改成左右往中間收斂到冠軍的括號圖。
4. **對戰圖/對戰區可改比數與選贏家**：可改判勝方、選填比分。

## 範圍與非目標

- 括號圖**只用於單淘汰**（`single_elim`）。循環賽（`round_robin`）與瑞士制（`swiss`）沒有淘汰括號結構，**維持**現有「依輪次列出對戰 + 積分榜」，但同樣獲得「改判勝方 + 選填比分」能力。
- 比分為**選填、純顯示 + 同分 tiebreak 用**，不改變勝負判定（**點勝方為主**）。不做「輸入比分自動判勝」。
- 重賽只複製名單+賽制+設定，不複製對戰結果（開全新一場）。
- 不引入任何外部套件或建置工具（維持單檔、無相依、ES5 風格）。

## 功能 1：依現有玩家重賽

- 賽事詳情頁 `#tournament` 的返回列（現有「↩ 賽事列表」）**旁邊**新增按鈕 **`♻ 重賽一次`**（id `tRematchBtn`）。
- 行為：讀取當前比賽 `t`，以 `t.participants`（**深拷貝**，保留相同 `id`/`name`）與 `t.format` + `t.state.options` 呼叫 `BBEngines.get(t.format).init(participants, options)` 產生新 `state` → 建立**新一筆**比賽物件：
  - `id`: 新的 `t_<base36>`
  - `name`: 原名稱去掉既有「(重賽)」尾綴後 + `(重賽)`（避免疊加成「(重賽)(重賽)」）
  - `format` / `participants` / `state`：如上；`createdAt`: 現在
- `upsert(newT)` 存檔（原比賽不動）→ `openTournament(newT.id)` 進入新場。
- 原比賽在列表中完整保留。

## 功能 3+4：單淘汰對戰圖 + 互動

### 引擎：純函式 `singleElim.bracket(state)`

在 `js/tournament-engines.js` 的 `singleElim` 物件新增 `bracket(state)`，把 `state.rounds` 轉為**收斂欄位**結構供 UI 渲染（純函式、可單元測試）：

- 設 `R = state.rounds.length`（如 8 人 → R=3：R1 4 場、R2 2 場、決賽 1 場）。
- 決賽（最後一輪，1 場）為**中央**。
- 對每個非決賽輪 `r`（0-based），把該輪 matches 對半切：前半屬**左側**、後半屬**右側**。
- 回傳：
  ```
  {
    left:  [ 第r輪左半 matches 陣列, ... ]   // r 由外而內：R1左, R2左, ...
    final: match | null                      // 中央決賽（單場）
    right: [ 第r輪右半 matches 陣列, ... ]   // r 由外而內：R1右, R2右, ...
  }
  ```
- 每個 match 物件即現有 match（含 `id,p1,p2,winner,score,bye`）。UI 依此渲染欄位。
- 邊界：2 人（R=1，只有決賽、left/right 為空）、4 人（R=2）、非 2 次方（含 bye 格）皆須正確。

### UI：`renderBracket(t)`（僅單淘汰）

- 版面：外層 `#tMatches` 內放一個**可水平捲動**的括號容器。欄位順序：`R1左 → R2左 → … → 決賽(中央) → … → R2右 → R1右`。
- 每欄用 flex 直向排列，`justify-content: space-around` 讓格子均分；欄與欄之間用偽元素（`::before/::after` 邊框）畫**肘形連接線**收斂。
- 每個 match 格顯示上下兩位選手（`p1` 上、`p2` 下）：
  - 選手列可點：**點某位 = 設該場勝方**；勝方高亮。
  - **已決出後仍可點另一位改判**（呼叫 `recordResult` 以新 winner，單淘汰 `seRecompute` 會自動往後重算晉級與失效下游）。
  - 輪空格顯示「輪空」；未定的格（來源未決）顯示「—」，不可點。
  - 每格一個 **`✎`** 比分控制：點開 inline 小輸入（兩個數字，如 `3` 與 `1`），存成 `score=[勝方分,敗方分]`；可清空。比分僅顯示與 tiebreak。
- 單淘汰在對戰圖出現時：**收起積分榜表**（`#tStandings` 不渲染），只保留冠軍橫幅（`#tChampion`）＋括號圖。

### UI：循環賽/瑞士制對戰列強化

- 維持現有依輪次的對戰列（`matchrow`），但：
  - 已決出的場次除「復原」外，**也可點另一位選手改判**（RR/swiss 的 `recordResult` 直接改 winner；不需先復原）。
  - 每列加 **`✎` 比分**控制，同上（選填、`score=[勝方分,敗方分]`）。
- 積分榜維持顯示（RR/swiss 需要）。

### 比分編輯共用元件

- 引擎新增純工具 `BBEngines.setScore(state, matchId, score)`：只設定該場 `match.score`（`[勝方分,敗方分] | null`），**不觸碰 winner**（可單元測試、與賽制無關）。
- UI 端 `openScoreEditor(matchId, onSave)`：於該場附近顯示兩個 `number` 輸入 + 確定/清除；確定時呼叫 `BBEngines.setScore` → `upsert` → 重新渲染。
- 因「點勝方為主」，比分編輯**不改變 winner**；若該場尚未決出勝方，先提示「請先選勝方」再允許填分。

## 功能 2：全面響應式

對所有自由對戰畫面補強（新增/調整 CSS media query，沿用專案既有響應式手法）：

- **通用**：容器流式寬度（`width:100%`、`max-width`）、點擊區 ≥ 40px、字級用相對單位/在窄螢幕縮放。
- **賽事列表 `#freebattle`**：卡片在窄螢幕堆疊、刪除鈕不擠壓標題。
- **積分榜 `.sttable`**：窄螢幕可水平捲動（已 `display:block;overflow-x`），或隱藏「勝率」欄以精簡。
- **新增比賽精靈 `#fbWizard`**：小螢幕彈窗 `max-height:90vh` 可捲動、輸入與按鈕不溢出（沿用現況並補強）。
- **括號圖**：窄螢幕水平捲動；格子 `min-width`；桌機時完整收斂版面置中。
- 斷點建議：`<=480px`（手機直向）、`<=768px`（平板/手機橫向）；與現有 battle 面板斷點一致。

## 架構與檔案

- `js/tournament-engines.js`
  - 新增 `singleElim.bracket(state)` 純函式（收斂欄位結構）。
  - 新增 `BBEngines.setScore(state, matchId, score)` 純工具（只設比分、不動 winner）。
  - （現有 `recordResult` 已支援「改判已決出場次」與單淘汰連動，無需改）。
- `js/free-battle.js`
  - 新增 `rematch()`、`renderBracket(t)`、比分編輯（`openScoreEditor` / `setScore`）、改判勝方的點擊處理。
  - 調整 `renderDetail(t)`：單淘汰走 `renderBracket` 並隱藏積分榜；RR/swiss 走現有 `renderMatches`（強化改判+比分）。
- `index.html`
  - `#tournament` 返回列加入 `♻ 重賽一次` 按鈕。
  - `<style>` 加入括號圖樣式、比分編輯樣式、響應式 media query。

## 資料模型影響

- 沿用現有 tournament 物件。`match.score` 已存在（`[勝方分,敗方分] | null`），比分編輯只是讓它可由 UI 設定。
- 重賽產生的新比賽是獨立一筆，無反向關聯欄位（YAGNI；如日後要「系列賽」再加）。

## 錯誤處理與邊界

- 重賽時若原名單 < 2（理論上不會發生，因原比賽已開始）：仍防呆，提示並中止。
- 改判：把已決出的勝方改成另一位 → 單淘汰須連動清掉下游失效結果（引擎已處理）；UI 重新渲染。
- 比分編輯：非數字/負數 → 視為清空或忽略；未選勝方時不允許存比分（提示）。
- 括號圖在極端人數（2 人）時 left/right 為空，只顯示中央決賽，不可破版。
- localStorage 寫入失敗：沿用現有 `toast` 提示。

## 測試策略

- 引擎純函式（Node `node --test`）：
  - `singleElim.bracket(state)`：2/4/8 人與含 bye 時，left/final/right 欄位數與內容正確；決賽置中；左右各半分配正確。
  - 改判已決出場次：單淘汰改半決賽勝方 → 下游決賽對手更新、失效的決賽結果被清除（延伸現有連動測試）。
  - `BBEngines.setScore`：設定/清空某場比分、不影響 winner。
- jsdom 端到端煙霧測試（延伸現有 `drive.mjs` 手法，臨時安裝、不落 repo）：
  - 重賽：點 `♻ 重賽一次` → 新增一筆比賽、原比賽仍在、進入新場且對戰全未定。
  - 括號圖：單淘汰詳情渲染出括號容器；點選手設勝方；改判翻轉；比分編輯寫入 `score`。
  - 響應式屬 CSS，主要以桌機/手機視窗手動檢視（controller 執行）。

## 分階段實作建議（供實作計畫參考）

1. 引擎 `singleElim.bracket()` 純函式 + 測試。
2. 重賽 `rematch()` + 按鈕（低風險、先落地）。
3. 比分編輯 + 改判勝方（RR/swiss 對戰列先套用，端到端可驗）。
4. 單淘汰括號圖 `renderBracket()` + 樣式 + 連接線（含比分/改判在括號圖內）。
5. 全面響應式打磨 + jsdom 煙霧測試補齊。
