# 賽事搜尋(Tournament Search)功能設計

日期:2026-08-21

## 目標
在對戰紀錄 App(單一 `index.html` PWA)中新增「賽事搜尋」按鈕與分頁,
自動列出新加坡最近一個月的 Beyblade / 陀螺賽事,可點入看詳情或前往來源網站。

## 架構
GitHub Actions 每天 cron 跑一支 Python 腳本 → 呼叫 Claude API(web search)→
產生 `events.json` → commit 回 main → GitHub Pages 服務。前端只讀取靜態 `events.json`,
無 CORS 問題、無需後端伺服器。

```
GitHub Actions (cron 每天一次)
  └─ scripts/fetch_events.py ──(Claude web search)──▶ events.json ──git push──▶ main
                                                                          └─ Pages 服務
index.html
  └─ 「🔍 賽事搜尋」按鈕 → #events 分頁 → fetch('events.json') → 卡片清單 → 詳情 / 前往網站
```

## 元件

### 1. `scripts/fetch_events.py`
- SDK:`anthropic`;model:`claude-opus-4-8`
- 工具:`{"type":"web_search_20260209","name":"web_search"}`
- 以 `output_config.format`(json_schema)強制結構化輸出;處理 web search 的 `pause_turn` 續跑迴圈
- 每筆欄位:`title, date, location, venue, organizer, description, sourceName, sourceUrl`
- 輸出 `events.json`:`{ "updated": "<ISO8601>", "events": [ ... ] }`
- 找不到 → 寫空 `events` 陣列(不讓流程失敗)
- key 來自環境變數 `ANTHROPIC_API_KEY`

### 2. `.github/workflows/fetch-events.yml`
- 觸發:`schedule: cron '0 0 * * *'`(UTC 0 時 ≈ 台灣 08:00)+ `workflow_dispatch`(手動測試)
- 權限:`permissions: contents: write`
- 步驟:checkout → setup-python → `pip install anthropic` → 跑腳本(帶 `ANTHROPIC_API_KEY` secret)→ 若 `events.json` 有變更則 commit & push
- 金鑰:GitHub repo Secret `ANTHROPIC_API_KEY`(加密、不外露、log 自動遮蔽)——方案 A

### 3. 前端(`index.html`)
- **按鈕**:setup 分頁 `.subbtns` 內、`📄 對戰紀錄` 下方新增 `🔍 賽事搜尋`(`ghostbtn` 樣式)
- **新分頁** `<section class="screen" id="events">`:
  - `.brand` 標題(EVENT / FINDER)
  - 「最後更新:<時間>」列
  - 賽事卡片清單容器 `#eventList`
  - `🏠 回到設定` 按鈕
- **卡片**:標題 + 日期 + 地點;點擊展開詳情(organizer、description);「前往網站 ↗」連結(`sourceUrl`,`target=_blank rel=noopener`)
- **狀態**:載入中 / 讀取失敗 / 空清單 → 友善訊息 + World Beyblade Organization 備用搜尋連結
- 沿用現有 `showScreen(id)` 導航

### 4. `events.json`(初始 placeholder)
先放一份空的 `{ "updated": null, "events": [] }`,讓首次 Action 執行前頁面也能正常顯示訊息。

## 使用者需完成
1. GitHub repo → Settings → Secrets and variables → Actions → 新增 `ANTHROPIC_API_KEY`
2. 確認 GitHub Pages 已從 main 分支根目錄啟用

## 非目標(YAGNI)
- 不做即時前端抓取(改用每日快取)
- 不做多國/多城市(僅新加坡)
- 不做使用者訂閱/通知
