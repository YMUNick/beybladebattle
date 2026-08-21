#!/usr/bin/env python3
"""每天執行一次:用 Claude 的 web search 找出新加坡最近一個月的陀螺(Beyblade)賽事,
寫入 repo 根目錄的 events.json。前端(index.html)直接讀取這個檔案。

需要環境變數 ANTHROPIC_API_KEY。
"""

import json
import os
import re
import sys
from datetime import datetime, timezone

import anthropic

MODEL = "claude-opus-4-8"
OUT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "events.json")

# 注意:web search 會在回應文字加入 citation,與 output_config.format(結構化輸出)不相容,
# 因此改為在提示中要求純 JSON 輸出,並在下方以容錯方式解析。
PROMPT = """搜尋新加坡(Singapore)最近一個月到未來即將舉辦的陀螺(Beyblade / Beyblade X)賽事、比賽或聚會。

請使用網路搜尋查找真實、可驗證的活動,務必查看以下已知來源(以及其他你搜尋到的相關來源):
- Instagram 帳號:@beykita.sg、@sg_beyblade、@beyblade_singaporeofficial、@beyblade_singapore
- Facebook:Singapore Beyblade Society 社團(facebook.com/groups/singaporebeybladesociety,2,500+ 成員,常辦賽事/工作坊)
- 常態賽事主辦:
  - Game Academia「GA Cup」每週五 @ *SCAPE(scape.sg/whats-on/ga-cup-beyblade)
  - Beycoolen Beyblade Club 每週四晚 @ Rocks Cafe(98 Arab Street)
- Takara Tomy Asia 官方 Beyblade X 活動時程(takaratomyasia.com)——找新加坡場次
- 官方 Beyblade X 活動(beyblade.com)、Beyblade X SEA CUP、以及動漫/玩具展(如 Conjutsu)內的陀螺賽
- World Beyblade Organization(worldbeyblade.org)新加坡討論區
- 當地玩具/模型店家、Eventbrite、Peatix、以及新加坡國家圖書館活動(nlb.libcal.com)

規則:
- 只列出你能從搜尋結果實際找到的活動,不要杜撰。
- 每筆都要有可點擊的來源網址(sourceUrl)。
- date 用活動日期(找不到確切日期就用你能找到的最接近描述,例如 "2026 年 9 月")。
- location 填城市/區域,venue 填確切場地(若有)。
- 若真的找不到任何近期活動,回傳空的 events 陣列。
- 最多列出 15 筆,依日期由近到遠排序。

重要:Instagram 等社群頁面用一般關鍵字搜尋常常抓不到內容。請「主動使用 web_fetch 工具直接讀取」這些頁面,
尤其是 https://www.instagram.com/beykita.sg/(以及 @sg_beyblade、@beyblade_singaporeofficial、@beyblade_singapore
的 IG 頁面),從貼文中把賽事名稱、日期、地點、報名資訊整理出來。sourceUrl 可用該 IG 頁面或貼文網址。

搜尋完成後,最後只輸出一段 JSON(不要有任何其他文字、說明或 Markdown 標記),格式如下:
{
  "events": [
    {
      "title": "賽事名稱",
      "date": "日期",
      "location": "城市/區域",
      "venue": "確切場地(可省略)",
      "organizer": "主辦者(可省略)",
      "description": "簡短描述(可省略)",
      "sourceName": "來源名稱",
      "sourceUrl": "來源網址"
    }
  ]
}"""


def extract_json(message):
    """把所有 text block 串起來,容錯地抓出 JSON 物件並解析。"""
    text = "".join(b.text for b in message.content if b.type == "text" and b.text)
    if not text.strip():
        raise ValueError("回應中找不到文字內容")
    # 移除可能的 ```json ... ``` 圍欄
    text = re.sub(r"```(?:json)?", "", text)
    # 抓第一個 { 到最後一個 } 之間的內容
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("回應中找不到 JSON 物件")
    return json.loads(text[start:end + 1])


def main():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("錯誤:缺少 ANTHROPIC_API_KEY 環境變數", file=sys.stderr)
        sys.exit(1)

    client = anthropic.Anthropic()
    tools = [
        {"type": "web_search_20260209", "name": "web_search"},
        {"type": "web_fetch_20260209", "name": "web_fetch"},
    ]
    messages = [{"role": "user", "content": PROMPT}]

    # web search / fetch 是伺服器端工具,可能回傳 pause_turn,需要續跑
    message = None
    for _ in range(10):
        message = client.messages.create(
            model=MODEL,
            max_tokens=8000,
            tools=tools,
            messages=messages,
        )
        if message.stop_reason == "pause_turn":
            messages.append({"role": "assistant", "content": message.content})
            continue
        break

    if message is None:
        print("錯誤:沒有取得任何回應", file=sys.stderr)
        sys.exit(1)

    if message.stop_reason == "refusal":
        print("警告:請求被拒絕,寫入空清單", file=sys.stderr)
        events = []
    else:
        try:
            data = extract_json(message)
            events = data.get("events", []) if isinstance(data, dict) else []
        except (json.JSONDecodeError, ValueError) as e:
            print(f"警告:無法解析輸出({e}),寫入空清單", file=sys.stderr)
            events = []

    out = {
        "updated": datetime.now(timezone.utc).isoformat(),
        "events": events,
    }
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"已寫入 {OUT_PATH}:{len(events)} 筆賽事")


if __name__ == "__main__":
    main()
