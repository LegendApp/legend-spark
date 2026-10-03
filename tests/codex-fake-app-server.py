#!/usr/bin/env python3
import json
import os
import sys
import time

mode = os.environ.get("CODEX_TEST_MODE", "stall")
marker = os.environ["CODEX_TEST_MARKER"]
count_path = marker + ".count"
try:
    with open(count_path) as f: count = int(f.read())
except FileNotFoundError:
    count = 0
with open(count_path, "w") as f: f.write(str(count + 1))
def mark(value):
    with open(marker, "w") as f: f.write(value)
def read():
    line = sys.stdin.readline()
    return json.loads(line) if line else None
def reply(message, result):
    print(json.dumps({"id": message["id"], "result": result}), flush=True)

msg = read()
mark("initialize")
if mode == "cancel-init": time.sleep(20)
reply(msg, {"userAgent": "fake"})
read()
msg = read()
if msg is None: sys.exit(0)
if msg.get("method") != "thread/start": sys.exit(2)
mark("thread")
if mode == "cancel-thread": time.sleep(20)
reply(msg, {"thread": {"id": "thread-1"}, "model": "fake"})
if mode in ("stall", "write-restart", "cancel-restart") and count == 0:
    mark("blocked")
    time.sleep(20)
msg = read()
if msg is None: sys.exit(0)
if msg.get("method") != "turn/start": sys.exit(3)
mark("turn")
if mode == "cancel-turn": time.sleep(20)
if mode == "preack":
    print(json.dumps({"method": "turn/completed", "params": {"turn": {"id": "turn-1", "status": "completed", "items": [{"type": "agentMessage", "text": "preack"}]}}}), flush=True)
    reply(msg, {"turn": {"id": "turn-1"}})
    time.sleep(0.2)
    sys.exit(0)
if mode == "postack":
    reply(msg, {"turn": {"id": "turn-1"}})
    print(json.dumps({"method": "turn/completed", "params": {"turn": {"id": "turn-1", "status": "completed", "items": [{"type": "agentMessage", "text": "postack"}]}}}), flush=True)
    time.sleep(0.2)
    sys.exit(0)
if mode == "oversize-preack":
    large = "x" * (9 * 1024 * 1024)
    print(json.dumps({"method": "item/completed", "params": {"turnId": "turn-1", "item": {"type": "agentMessage", "text": large}}}), flush=True)
    print(json.dumps({"method": "error", "params": {"turnId": "turn-1", "error": {"message": large}, "willRetry": False}}), flush=True)
    reply(msg, {"turn": {"id": "turn-1"}})
    print(json.dumps({"method": "turn/completed", "params": {"turn": {"id": "turn-1", "status": "completed", "items": [{"type": "agentMessage", "text": "ok"}]}}}), flush=True)
    time.sleep(0.2)
    sys.exit(0)
if mode in ("late", "restart", "write-restart", "cancel-restart"):
    print(json.dumps({"method": "turn/completed", "params": {"turn": {"id": "turn-1", "status": "completed", "items": [{"type": "agentMessage", "text": "done"}]}}}), flush=True)
    reply(msg, {"turn": {"id": "turn-1"}})
    if mode == "late":
        time.sleep(0.1)
        print(json.dumps({"method": "item/completed", "params": {"turnId": "turn-1", "item": {"type": "agentMessage", "text": "orphan"}}}), flush=True)
        for index in range(1000):
            print(json.dumps({"method": "item/completed", "params": {"turnId": f"unknown-{index}", "item": {"type": "agentMessage", "text": "orphan"}}}), flush=True)
        with open(marker, "w") as f: f.write("late")
    continue_server = True
    while continue_server:
        next_msg = read()
        if next_msg is None: break
        if next_msg.get("method") == "initialize":
            reply(next_msg, {"userAgent": "fake"}); read(); continue
        if next_msg.get("method") == "thread/start":
            reply(next_msg, {"thread": {"id": "thread-1"}, "model": "fake"}); continue
        if next_msg.get("method") == "turn/start":
            print(json.dumps({"method": "turn/completed", "params": {"turn": {"id": "turn-1", "status": "completed", "items": [{"type": "agentMessage", "text": "done"}]}}}), flush=True)
            reply(next_msg, {"turn": {"id": "turn-1"}})
            continue
        sys.exit(4)
    sys.exit(0)
time.sleep(20)
