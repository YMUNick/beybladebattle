# 自由對戰・視訊直播 設計

## 目標
在賽事頁「📡 直播分享」旁加「🎥 視訊直播」:用另一台手機當攝影機,把連結傳給 1–5 位觀眾,觀眾用手機看到「影像 + 即時積分」。連結 2 小時後自動失效。

## 架構
- WebRTC 點對點(攝影機 → 每位觀眾各一條連線),STUN 用 Google 公開伺服器;`BB_LIVE_CONFIG.iceServers` 可覆寫(之後要加 TURN 只改設定)。
- 信令走現有 Firebase Realtime Database REST(匿名登入沿用 `live-share.js` 的 `getAuth`,透過 `BBLive.getAuth` 共用)。
- 非 trickle ICE:等候選收集完成(或 2.5 秒)後,一次寫入完整 SDP。
- 新檔 `js/video-live.js`,UI 加在 `index.html`。

## 角色與網址
| 角色 | 網址 | 行為 |
|---|---|---|
| 主辦(計分裝置) | 賽事頁按 🎥 | 確保文字直播分享已開啟;產生 `videoId` 與到期時間 `exp = 現在 + 2h`(存在本機賽事 `t.videoId / t.videoExp`,未過期重開沿用)。彈窗顯示攝影機 QR、觀眾連結(複製 / 分享)、到期時間 |
| 攝影機 | `?cam={videoId}&s={shareId}&exp={ms}` | 按「開始直播」→ 後鏡頭 720p + 麥克風(失敗則只有影像)、螢幕常亮;建立 `/video/{videoId}`;最多 5 位觀眾;顯示觀眾數、剩餘時間;可分享觀眾連結、停止直播 |
| 觀眾 | `?live={shareId}&video={videoId}` | 賽事頁上方顯示影像(靜音自動播放,點 🔊 開聲音),下方沿用直播分享的積分 |

## 資料結構
```
/video/{videoId}
  owner: 攝影機 uid
  createdAt: 伺服器時間
  peers/{viewerUid}
    offer:  string   (觀眾寫)
    answer: string   (攝影機寫)
    full:   true     (攝影機寫,人數已滿)
```

## 規則(database.rules.json)
- 讀:`createdAt + 2h > now`。
- `$videoId` 寫:建立(不存在時)、擁有者寫入(未過期)或刪除、任何人可刪除已過期節點;`owner`、`createdAt` 不可改。
- `peers/$uid` 寫:未過期且(本人或擁有者)。`offer/answer` 為字串且 < 20000 字,`full` 為 true,其他欄位拒絕。

## 流程
- **攝影機**:PUT 建立節點;若已存在且擁有者是自己(重新整理),先刪除再重建。以 EventSource 監聽 `peers`;新的或 offer 改變的觀眾 → 建立連線並寫 answer;滿 5 人 → 寫 `full`;連線失敗 / 觀眾刪除節點 → 關閉並清掉。到期時間 = min(連結 exp, createdAt + 2h),時間到自動停止並刪除節點。連結已過期時不允許開始。
- **觀眾**:讀取節點;讀不到 → 「等待攝影機開始…」每 4 秒重試。讀到 → 建立 recvonly offer 寫入自己的 peer 節點,監聽 answer;15 秒沒回應或連線失敗 → 刪掉自己的節點後重試(多次失敗顯示「無法連線,請改用 Wi-Fi」)。`full` → 顯示「觀看人數已滿」並每 10 秒重試。`createdAt + 2h` 到 → 斷線顯示「視訊直播已超過 2 小時,連結已失效」。
- **停止**:攝影機按停止 → 關閉所有連線、停止相機、刪除節點。主辦端「停止直播」(文字分享)同時清掉本機 `videoId`。重賽時 `videoId` 跟著新的一場(與 `shareId` 一致)。

## 限制
- 攝影機手機必須停在頁面且螢幕亮著(iPhone 切到背景會關相機)。
- 部分行動網路無法點對點連線(需要 TURN),觀眾會看到提示。

## 測試
- 電腦兩個視窗(攝影機 / 觀眾)驗證流程、人數上限、到期。
- 兩支實機手機實測。
