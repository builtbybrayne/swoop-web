#!/usr/bin/env python3
"""Streaming TTFT probe for the Puma orchestrator.

Sends session -> consent -> chat, reading the SSE stream incrementally so we
can timestamp the FIRST visible text token (TTFT) vs the tool loop. Use it to
decompose first-turn latency into setup (first tool-call frame) vs the
query-dependent content loop. See ttft-prewarm-handover.md.

Usage: python3 product/scripts/ttft-probe.py "<message>" [label]
Requires the orchestrator on http://localhost:8080 (override with ORCH_URL).
"""
import json, os, sys, time, urllib.request

BASE = os.environ.get("ORCH_URL", "http://localhost:8080")
MSG = sys.argv[1] if len(sys.argv) > 1 else "Tell me about Patagonia"
LABEL = sys.argv[2] if len(sys.argv) > 2 else ""


def post(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    return urllib.request.urlopen(req, timeout=30)


def patch(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="PATCH")
    return urllib.request.urlopen(req, timeout=30)


# 1. session + consent
j = json.load(post("/session", {}))
sid, cv = j["sessionId"], j.get("disclosureCopyVersion")
patch(f"/session/{sid}/consent", {"granted": True, "copyVersion": cv})

# 2. chat — stream, timestamp frames
req = urllib.request.Request(BASE + "/chat",
                             data=json.dumps({"sessionId": sid, "message": MSG}).encode(),
                             headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
                             method="POST")
t0 = time.monotonic()
resp = urllib.request.urlopen(req, timeout=180)

cur_event = "message"
t_first_frame = t_first_tool = t_first_text = t_done = None
n_tool = n_text = n_reasoning = 0
text_before_tool = 0
first_answer = []

while True:
    raw = resp.readline()
    if not raw:
        break
    line = raw.decode("utf-8", "replace").rstrip("\n")
    now = time.monotonic() - t0
    if line.startswith("event:"):
        cur_event = line[6:].strip()
        continue
    if not line.startswith("data:"):
        continue
    data = line[5:].strip()
    if t_first_frame is None:
        t_first_frame = now
    if cur_event == "done":
        t_done = now
        break
    cur_event_local, cur_event = cur_event, "message"
    try:
        p = json.loads(data)
    except Exception:
        continue
    t = p.get("type")
    if t == "tool-call":
        n_tool += 1
        if t_first_tool is None:
            t_first_tool = now
    elif t == "text":
        n_text += 1
        if t_first_text is None:
            t_first_text = now
            if n_tool == 0:
                text_before_tool += 1
        if len("".join(first_answer)) < 120:
            first_answer.append(p.get("text", ""))
    elif t == "reasoning":
        n_reasoning += 1

if t_done is None:
    t_done = time.monotonic() - t0


def ms(x):
    return f"{x*1000:6.0f}ms" if x is not None else "   n/a"


print(f"--- TTFT probe {('['+LABEL+'] ') if LABEL else ''}msg={MSG!r}")
print(f"  TTFT (first visible text) : {ms(t_first_text)}   <-- the number that matters")
print(f"  first SSE frame           : {ms(t_first_frame)}")
print(f"  first tool-call frame     : {ms(t_first_tool)}   (~= setup; pre-warmable)")
print(f"  total (done)              : {ms(t_done)}")
print(f"  tool frames={n_tool}  text frames={n_text}  reasoning-on-wire={n_reasoning}  text-before-tool={text_before_tool}")
print(f"  answer head: {''.join(first_answer)[:110]!r}")
