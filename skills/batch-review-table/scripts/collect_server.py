#!/usr/bin/env python
"""
L2 回传服务：页面点「提交给我」→ POST JSON → 回执 + 结果落盘 + stdout → 退出。

协议
    GET  /health   → 200 {"ok":true,"service":"review-collect","version":"2"}
    POST /submit   → 200 {"ok":true,"received":<条目数>,"version":"2"}；body 必须含 items[]
    OPTIONS *      → 204 + CORS 头（含 Access-Control-Allow-Private-Network: true，
                     否则 Chrome 会拦 file:// 页面访问 127.0.0.1）

行为
    - 端口从 REVIEW_PORTS 里按顺序挑第一个能绑的（默认 8777–8780），页面用同一组端口探测；
    - 收到第一次提交后再等 REVIEW_GRACE 秒（默认 10）：期间可改答案重提，只保留最后一次；
    - 结果写 <TEMP>/review-l2-result.json 并打到 stdout，调用方任取其一；
    - Windows 控制台下 emoji 可能触发 GBK 编码错误，stdout 已强制 UTF-8 + errors=replace。

环境变量
    REVIEW_PORTS    默认 8777,8778,8779,8780
    REVIEW_OUT      存档路径，默认 <temp>/review-l2-result.json
    REVIEW_TIMEOUT  总共等多久，默认 900 秒
    REVIEW_GRACE    首次提交后再等多久收尾，默认 10 秒
"""
import json
import os
import sys
import tempfile
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

VERSION = "2"
PORTS = [int(p) for p in os.environ.get("REVIEW_PORTS", "8777,8778,8779,8780").split(",") if p.strip()]
OUT = os.environ.get("REVIEW_OUT") or os.path.join(tempfile.gettempdir(), "review-l2-result.json")
TIMEOUT = int(os.environ.get("REVIEW_TIMEOUT", "900"))
GRACE = int(os.environ.get("REVIEW_GRACE", "10"))
MAX_BODY = 1_000_000


class Handler(BaseHTTPRequestHandler):
    def _send_headers(self, code=200, content_type="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=True).encode("utf-8")
        self._send_headers(code)
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send_headers(204)

    def do_GET(self):
        if self.path.split("?")[0] == "/health":
            self._json(200, {"ok": True, "service": "review-collect", "version": VERSION})
        else:
            self._json(404, {"ok": False})

    def do_POST(self):
        if self.path.split("?")[0] != "/submit":
            self._json(404, {"ok": False, "error": "not found"})
            return
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        if n <= 0 or n > MAX_BODY:
            self._json(413, {"ok": False, "error": "bad length"})
            return
        try:
            data = json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception:
            self._json(400, {"ok": False, "error": "bad json"})
            return
        if not isinstance(data, dict) or not isinstance(data.get("items"), list):
            self._json(400, {"ok": False, "error": "payload needs items[]"})
            return

        self.server.latest = data
        self.server.last_submit = time.time()
        self._json(200, {"ok": True, "received": len(data["items"]), "version": VERSION})

    def log_message(self, *args):
        pass


def bind():
    last = None
    for port in PORTS:
        try:
            srv = HTTPServer(("127.0.0.1", port), Handler)
            return srv, port
        except OSError as exc:
            last = exc
    raise last


httpd, port = bind()
httpd.timeout = 1
httpd.latest = None
httpd.last_submit = None
print("listening 127.0.0.1:%d" % port, flush=True)
print("out=%s" % OUT, flush=True)

deadline = time.time() + TIMEOUT
while time.time() < deadline:
    httpd.handle_request()
    if httpd.last_submit is not None and (time.time() - httpd.last_submit) >= GRACE:
        break
httpd.server_close()

if httpd.latest is None:
    print("timeout", flush=True)
    sys.exit(1)

saved = None
try:
    out_path = os.path.abspath(OUT)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(httpd.latest, f, ensure_ascii=False, indent=2)
    saved = out_path
except Exception as exc:
    saved = "write-failed:%r" % (exc,)

print("=== RESULT_JSON_BEGIN ===", flush=True)
print(json.dumps(httpd.latest, ensure_ascii=True), flush=True)
print("=== RESULT_JSON_END ===", flush=True)
text = httpd.latest.get("report_text") or ""
if text:
    print("=== RESULT_TEXT_BEGIN ===", flush=True)
    print(text, flush=True)
    print("=== RESULT_TEXT_END ===", flush=True)
print("=== SAVED ===", flush=True)
print(saved, flush=True)
print("=== DONE ===", flush=True)
print("received", flush=True)
sys.exit(0)
