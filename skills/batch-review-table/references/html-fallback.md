# HTML 批阅页（回退通道）

面板不可用、条目很多、或需要留档时使用本通道。脚本随技能安装，位于技能目录的 `scripts/`。

## 触发条件

- `batch_review` 不在工具列表里（`UNKNOWN_TOOL`）、调用失败或面板超时（`PANEL_TIMEOUT`）；
- 条目很多且批阅面板不可用（客户端未加载 / 用户不在会话页）；
- 需要把结果持久化成文件（JSON / CSV / Excel）留档。

> 面板本身是首选：条目 ≥2 时 `batch_review` 会自动走一屏面板，只有面板确实不可用才需要本通道。

## 动手前先告诉用户（一次性说清）

1. **页面要用浏览器打开**（「在应用中打开」），不要用应用内预览；
2. **别把页面放临时目录**：宿主重启会清空它，重启后表就没了——要留档就 `--out` 到工作区；
3. **「提交给我」失败不丢数据**：页面自带「复制结果」「下载 JSON」，把 JSON 贴回聊天即可；
4. 回传服务是**一次性的**：提交后 10 秒内可改可重交，之后进程退出；提交前关掉服务就没有回传通道。

## 步骤

```sh
python scripts/build_review.py --data items.json --out review/<slug>.html
python scripts/collect_server.py
```

- 输出 `WARNING` 说明 `--out` 写不了、回退到了临时目录（重启即清空），按上面第 2 条处理；
- 收集器启动后打印 `listening 127.0.0.1:<port>`，页面会自动探测同一组端口；
- 提交失败就让用户用页面上的「复制结果」把 JSON 贴回来。

## 离线导出（不开浏览器）

用户更愿意在文件里改时，导 Excel（xlsx，状态列**自带下拉**：通过 / 不通过 / 待定 / 跳过）：

```sh
python scripts/build_review.py --data items.json --format xlsx --out review/<slug>.xlsx
```

没装 `openpyxl` 时脚本会提示并自动降级为 csv（仍可填写，只是没有下拉）；也可以显式 `--format csv`。

填完把文件发回来即可。Excel/CSV 没有进度条 / 阻塞联动，适合条数多但逐条独立的场景。

## 回传协议（排错用）

| 项 | 行为 |
|---|---|
| 端口 | `REVIEW_PORTS`，默认 `8777,8778,8779,8780`，按序取第一个可绑的；页面用同一组端口探测 |
| `GET /health` | `200 {"ok":true,"service":"review-collect","version":"2"}` |
| `POST /submit` | body 必须含 `items[]`；返回 `200 {"ok":true,"received":<n>,"version":"2"}` |
| `OPTIONS *` | `204` + CORS 头（含 `Access-Control-Allow-Private-Network: true`，否则 Chrome 会拦 `file://` 页面访问 127.0.0.1） |
| 收尾 | 首次提交后再等 `REVIEW_GRACE`（默认 10s），只保留最后一次；结果写 `REVIEW_OUT`（默认 `<temp>/review-l2-result.json`） |
| 超时 | `REVIEW_TIMEOUT`（默认 900s）内没有提交 → 打印 `timeout`，退出码 1 |

## 结果契约（HTML 回退提交的 JSON）

```json
{
  "title": "验收：…", "id": "slug", "mode": "sequential | independent",
  "generated_at": "ISO-8601",
  "items": [
    { "id": 1, "type": "confirm", "title": "…", "state": "pass | fail | skip | block | open",
      "answer": "用户选/填的文本", "blocked_by": 2, "assumed_pass": false, "note": "备注" }
  ],
  "summary": { "pass": 0, "fail": 0, "skip": 0, "block": 0, "open": 0, "assumed": 0 },
  "report_text": "【批阅】…可直接贴回聊天"
}
```

- `state`：`pass` 通过 / `fail` 不通过 / `skip` 待定 / `block` 被前一条阻塞 / `open` 未表态；
- `assumed_pass: true` = 用户点了「全部通过」但没实测，转述时必须说明；
- `blocked_by`：顺序模式下被哪条阻塞（1-based id）；
- 最省事的是直接读 `report_text`；需要逐条处理再读 `items`。
