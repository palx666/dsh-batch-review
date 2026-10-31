#!/usr/bin/env python
"""
把一份 JSON 清单渲染成可交互批阅页（HTML）或离线填写表（CSV/TSV）。

用法:
    python build_review.py --data items.json
    python build_review.py --data items.json --out review/foo.html --open
    python build_review.py --data items.json --format csv --out review/foo.csv

JSON 结构:
    {
      "id": "slug",
      "title": "标题",
      "subtitle": "副标题（可选）",
      "mode": "sequential" | "independent",
      "items": [
        {"id": 1, "type": "confirm", "op": "操作", "expect": "预期"},
        {"id": 2, "type": "choice", "label": "问题", "options": [{"v": "A", "t": "选项", "rec": true}]},
        {"id": 3, "type": "bool", "label": "问题", "boolLabel": "勾选文案"},
        {"id": 4, "type": "text", "label": "问题"},
        {"id": 5, "type": "scale", "label": "评分", "min": 1, "max": 5, "caps": ["低", "高"]}
      ]
    }

输出策略:
    1. 先写 --out（默认 review/<slug>.<ext>，相对当前目录）；
    2. 写不了（沙箱常见：子进程无工作区写权限）才回退到系统临时目录，
       并在 stderr 打印 WARNING —— 临时目录会被 DSH 重启清空，不能当持久文件用。
"""
import argparse
import csv
import io
import json
import os
import sys
import tempfile

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(HERE, "..", "assets", "review.html")


def render_html(data):
    with open(TEMPLATE, encoding="utf-8") as f:
        tpl = f.read()
    payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    return tpl.replace("/*__REVIEW_DATA__*/", payload)


def render_csv(data):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "type", "标题", "预期/说明", "状态(通过/不通过/未测/跳过)", "备注"])
    for it in data["items"]:
        title = it.get("label") or it.get("op") or ("第 %s 条" % it["id"])
        sub = it.get("expect") or it.get("boolDesc") or ""
        w.writerow([it["id"], it.get("type", "confirm"), title, sub, "", ""])
    return buf.getvalue()


def write_text(body, out_path, slug, ext, encoding="utf-8"):
    attempts = []
    if out_path:
        attempts.append(os.path.abspath(out_path))
    attempts.append(os.path.join(tempfile.gettempdir(), "review-%s.%s" % (slug, ext)))
    last = None
    for idx, target in enumerate(attempts):
        try:
            folder = os.path.dirname(target)
            if folder:
                os.makedirs(folder, exist_ok=True)
            with open(target, "w", encoding=encoding, newline="") as f:
                f.write(body)
            if idx > 0:
                sys.stderr.write(
                    "WARNING: 无法写入 %s（%r）\n"
                    "WARNING: 已改写到临时目录 %s\n"
                    "WARNING: 临时目录在 DSH 重启时会被清空；需要长期留存请以 danger-full-access 重跑，"
                    "或让 agent 用文件工具把结果搬进工作区。\n"
                    % (attempts[0], last, target)
                )
                sys.stderr.flush()
            return target
        except Exception as exc:
            last = exc
    raise SystemExit("无法写入任何位置: %r" % (last,))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, help="JSON 清单路径")
    ap.add_argument("--out", default="", help="输出路径（默认 review/<slug>.<ext>）")
    ap.add_argument("--format", default="html", choices=["html", "csv"], help="输出格式")
    ap.add_argument("--open", action="store_true", help="写完后用默认浏览器打开（仅 html）")
    args = ap.parse_args()

    with open(args.data, encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data.get("items"), list) or not data["items"]:
        raise SystemExit("items 不能为空")
    data.setdefault("id", "review")
    data.setdefault("mode", "independent")

    slug = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in str(data["id"]))[:60] or "review"

    if args.format == "csv":
        out = args.out or os.path.join("review", slug + ".csv")
        body = render_csv(data)
        final = write_text(body, out, slug, "csv", encoding="utf-8-sig")  # BOM，方便 Excel 直接开
    else:
        out = args.out or os.path.join("review", slug + ".html")
        html = render_html(data)
        body = html.replace("/*__REVIEW_PATH__*/", json.dumps(os.path.abspath(out), ensure_ascii=False).replace("</", "<\\/"))
        final = write_text(body, out, slug, "html")

    print("OUT:", final)
    print("ITEMS:", len(data["items"]))
    if args.format == "html":
        print("NEXT: 告诉用户用「在应用中打开」在浏览器里填；提交失败可用「复制结果」粘回。")

    if args.open and args.format == "html":
        try:
            import webbrowser
            webbrowser.open("file:///" + final.replace("\\", "/"))
        except Exception as exc:
            print("OPEN-FAILED:", exc)


if __name__ == "__main__":
    main()
