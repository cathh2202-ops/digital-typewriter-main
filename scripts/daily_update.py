#!/usr/bin/env python3
"""
Daily updater — runs at 11 PM UTC (7 AM MYT)
Fetches Google Calendar events + Notion todos for today
Updates index.html and pushes to GitHub via GitHub Actions
"""

import os
import re
import json
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone, timedelta

# ── Timezone ──────────────────────────────────────────────
MYT = timezone(timedelta(hours=8))
today = datetime.now(MYT)
TODAY_STR = today.strftime("%-m/%-d/%Y")   # e.g. 5/18/2026
TODAY_ISO  = today.strftime("%Y-%m-%d")     # e.g. 2026-05-18
TODAY_START = today.replace(hour=0,  minute=0,  second=0,  microsecond=0)
TODAY_END   = today.replace(hour=23, minute=59, second=59, microsecond=0)

print(f"Running for {TODAY_ISO} (MYT)")

# ── Helpers ───────────────────────────────────────────────
def http_get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())

def http_post(url, data, headers=None):
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, headers={
        "Content-Type": "application/json",
        **(headers or {})
    }, method="POST")
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())

def fmt_time(iso):
    dt = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(MYT)
    return dt.strftime("%H:%M")

def detect_type(title):
    work_kw = ["standup","sync","meeting","review","sprint","planning",
                "retro","1:1","demo","work","interview","call","client"]
    return "work" if any(k in title.lower() for k in work_kw) else "personal"

# ── Google Calendar ───────────────────────────────────────
def fetch_google_events():
    token = os.environ.get("GOOGLE_ACCESS_TOKEN", "")
    if not token:
        print("⚠ GOOGLE_ACCESS_TOKEN not set — skipping Google Calendar")
        return []

    time_min = TODAY_START.isoformat()
    time_max = TODAY_END.isoformat()
    params = urllib.parse.urlencode({
        "calendarId":   "primary",
        "timeMin":      time_min,
        "timeMax":      time_max,
        "singleEvents": "true",
        "orderBy":      "startTime",
    })
    url = f"https://www.googleapis.com/calendar/v3/calendars/primary/events?{params}"
    try:
        data = http_get(url, {"Authorization": f"Bearer {token}"})
        events = []
        for ev in data.get("items", []):
            start = ev.get("start", {})
            end   = ev.get("end",   {})
            title = ev.get("summary", "(no title)")
            s = fmt_time(start["dateTime"]) if "dateTime" in start else "all day"
            e = fmt_time(end["dateTime"])   if "dateTime" in end   else ""
            link = ev.get("hangoutLink") or ev.get("htmlLink", "")
            events.append({
                "title": title,
                "start": s,
                "end":   e,
                "link":  link,
                "type":  detect_type(title),
            })
        print(f"✓ Google Calendar: {len(events)} events")
        return events
    except Exception as ex:
        print(f"✗ Google Calendar error: {ex}")
        return []

# ── Notion ────────────────────────────────────────────────
def fetch_notion_todos():
    token   = os.environ.get("NOTION_API_KEY", "")
    db_id   = os.environ.get("NOTION_DATABASE_ID", "")
    if not token or not db_id:
        print("⚠ NOTION_API_KEY or NOTION_DATABASE_ID not set — skipping Notion")
        return []

    headers = {
        "Authorization":  f"Bearer {token}",
        "Notion-Version": "2022-06-28",
    }

    # Step 1: find today's page by Date property
    try:
        result = http_post(
            f"https://api.notion.com/v1/databases/{db_id}/query",
            {"filter": {"property": "Date", "date": {"equals": TODAY_ISO}}},
            headers,
        )
        pages = result.get("results", [])
        if not pages:
            print(f"⚠ No Notion page found for {TODAY_ISO}")
            return []

        page_id = pages[0]["id"]
        print(f"✓ Found Notion page: {page_id}")
    except Exception as ex:
        print(f"✗ Notion query error: {ex}")
        return []

    # Step 2: fetch blocks inside that page
    try:
        blocks = http_get(
            f"https://api.notion.com/v1/blocks/{page_id}/children",
            headers,
        )
        todos = []
        for block in blocks.get("results", []):
            if block.get("type") != "to_do":
                continue
            td = block.get("to_do", {})
            if td.get("checked"):
                continue
            text = "".join(
                r.get("plain_text", "")
                for r in td.get("rich_text", [])
            ).strip()
            if text:
                todos.append({"title": text, "type": "personal"})
        print(f"✓ Notion todos: {len(todos)} unchecked items")
        return todos
    except Exception as ex:
        print(f"✗ Notion blocks error: {ex}")
        return []

# ── Build HTML snippets ───────────────────────────────────
def build_events_html(events):
    if not events:
        return ('    <li><span class="event-icon event-personal">personal</span>'
                '<span class="label">No event YAYY</span></li>')
    lines = []
    for ev in events:
        time_str = f'{ev["start"]}–{ev["end"]}' if ev["end"] else ev["start"]
        link_html = f'<a href="{ev["link"]}">link</a>' if ev["link"] else ""
        t = ev["type"]
        lines.append(
            f'    <li>'
            f'<span class="event-icon event-{t}">{t}</span>'
            f'<span class="label">{ev["title"]}</span>'
            f'<span class="time">{time_str}</span>'
            f'{link_html}'
            f'</li>'
        )
    return "\n".join(lines)

def build_todos_html(todos):
    if not todos:
        return ('    <li class="todo"><span class="todo-icon todo-personal">personal</span>'
                '<span class="label">Nothing to do YAYYY</span></li>')
    lines = []
    for td in todos:
        t = td["type"]
        lines.append(
            f'    <li class="todo">'
            f'<span class="todo-icon todo-{t}">{t}</span>'
            f'<span class="label">{td["title"]}</span>'
            f'</li>'
        )
    return "\n".join(lines)

# ── Patch index.html ──────────────────────────────────────
def patch_html(html, events_html, todos_html):
    # Replace date
    html = re.sub(
        r'(<span class="receipt-date"[^>]*>)[^<]*(</span>)',
        rf'\g<1>{TODAY_STR}\g<2>',
        html,
    )

    # Replace events list contents
    html = re.sub(
        r'(<ul class="events">).*?(</ul>)',
        rf'\1\n{events_html}\n          \2',
        html,
        flags=re.DOTALL,
    )

    # Replace todos list contents
    html = re.sub(
        r'(<ul class="todos">).*?(</ul>)',
        rf'\1\n{todos_html}\n          \2',
        html,
        flags=re.DOTALL,
    )

    return html

# ── Main ──────────────────────────────────────────────────
def main():
    # Read index.html
    with open("index.html", "r", encoding="utf-8") as f:
        html = f.read()

    # Fetch data
    events = fetch_google_events()
    todos  = fetch_notion_todos()

    # Build HTML
    events_html = build_events_html(events)
    todos_html  = build_todos_html(todos)

    print("\nEvents HTML:")
    print(events_html)
    print("\nTodos HTML:")
    print(todos_html)

    # Patch HTML
    new_html = patch_html(html, events_html, todos_html)

    # Write back
    with open("index.html", "w", encoding="utf-8") as f:
        f.write(new_html)

    print(f"\n✓ index.html updated for {TODAY_STR}")

if __name__ == "__main__":
    main()
