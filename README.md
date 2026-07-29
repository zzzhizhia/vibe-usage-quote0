# vibe-usage-quote0

把 Vibe Usage 云端的真实 AI 编码用量，稳定推送到 Quote/0 的 296×152 黑白桌面画板。画面突出今日 Token，并显示今日费用、会话数、活跃时长、近 7 日 Token/费用，以及一个主力工具和模型提示；不会发送项目名。

![Vibe Usage 在 Quote/0 上的用量画板示例](artifacts/quote0-render-4x.png)

## 要求

- macOS 与 Node.js 20+
- 已有可用的 `~/.vibe-usage/config.json`
- Quote/0 设备在线，并已在 Dot. App 内容工坊把“画板 API”加入设备循环任务
- Quote API key 与设备 ID；多个“画板 API”任务时还需要精确的 task key

项目使用 Node.js ESM、内置 `fetch`/`node:test`，没有运行时依赖。

## 配置

Vibe 凭据沿用：

```text
~/.vibe-usage/config.json
```

环境变量 `VIBE_USAGE_API_KEY`、`VIBE_USAGE_API_URL` 可逐项覆盖文件配置。程序只读取该文件；如果权限宽于 `0600`，仅警告，不代为修改。

Quote 凭据优先从环境变量读取：

```bash
export QUOTE0_API_KEY='你的 Quote API key'
export QUOTE0_DEVICE_ID='你的设备 ID'
export QUOTE0_TASK_KEY='可选；多个 CANVAS_API 画板时必填'
```

也可以由用户主动创建 XDG 配置文件：

```bash
mkdir -p ~/.config/vibe-usage-quote0
chmod 700 ~/.config/vibe-usage-quote0
$EDITOR ~/.config/vibe-usage-quote0/config.json
chmod 600 ~/.config/vibe-usage-quote0/config.json
```

```json
{
  "apiKey": "你的 Quote API key",
  "deviceId": "你的设备 ID",
  "taskKey": "可选；多个 CANVAS_API 画板时必填"
}
```

配置文件权限不是精确的 `0600` 时，程序拒绝读取。不要把真实凭据写进仓库、plist 或日志。

## 手动运行

```bash
npm run doctor
npm run dry-run
npm run push
```

- `doctor`：实际读取 Vibe 1 日/7 日数据，确认目标设备循环中存在唯一或精确指定的 `CANVAS_API`，并通过 `/status` 确认设备已唤醒且可用。
- `dry-run`：只访问 Vibe，输出聚合数值、Top 3 与 Canvas payload 的脱敏摘要；不访问 Quote。
- `push`：读取 Vibe，通过 `/loop/list` 精确选择画板，通过 `/status` 检查设备可用性并获取初始状态；休眠、离线、关机或未知状态会在 Canvas POST 前失败。设备可用时才 POST Canvas，再等待最多 90 秒；只有 `renderInfo.last`、渲染图 URL 或同一 URL 返回的图片内容指纹发生变化才成功。

如果 Quote 状态返回渲染图 URL，`push` 会下载到 `artifacts/quote0-render.png`，检查尺寸、彩色像素、墨点覆盖率与是否触碰画布边缘；没有 URL 时只报告“API 已确认，视觉未确认”。自动检查只作为辅助，最终仍需查看真机图确认排版。

## 每 30 分钟更新（仅模板）

[launchd/com.vibeusage.vibe-usage-quote0.plist](launchd/com.vibeusage.vibe-usage-quote0.plist) 已写入本机当前的绝对 Node 路径、脚本路径、工作目录和日志路径，`StartInterval` 为 1800 秒，不含任何秘密。

launchd 通常不继承交互式 shell 的环境变量，因此计划任务建议使用上面的 `0600` Quote 配置文件。安装前请先手动运行 `doctor` 和 `push`。

安装模板：

```bash
mkdir -p ~/Library/LaunchAgents
cp launchd/com.vibeusage.vibe-usage-quote0.plist ~/Library/LaunchAgents/
plutil -lint ~/Library/LaunchAgents/com.vibeusage.vibe-usage-quote0.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.vibeusage.vibe-usage-quote0.plist
```

卸载模板：

```bash
launchctl bootout "gui/$(id -u)/com.vibeusage.vibe-usage-quote0"
rm ~/Library/LaunchAgents/com.vibeusage.vibe-usage-quote0.plist
```

本项目只交付模板和说明，不会自动执行这些命令。

## 验证与故障排查

```bash
npm run build
npm test
npm run security-check
plutil -lint launchd/com.vibeusage.vibe-usage-quote0.plist
```

`security-check` 会扫描整个项目根目录：发现真实凭据或白名单外文件都会非零退出，而不是只检查预期交付目录。

- `401`：Vibe 或 Quote key 无效；客户端不会重试。
- `429`、`5xx`、网络错误：最多退避重试 3 次，仍失败则非零退出。
- “多个 CANVAS_API”：设置精确的 `QUOTE0_TASK_KEY`，程序不会猜目标。
- “设备休眠中”：连接电源或按设备说明唤醒后重试；程序不会把 HTTP 200 误报为设备可用，也不会在休眠状态下发送 Canvas POST。launchd 会在下一个 30 分钟周期再次尝试。
- “设备状态无法确认可用”：API 返回了未识别状态；为避免错误推送，程序会 fail-closed。先确认设备已唤醒、已接入电源和网络，再运行 `doctor`。
- “90 秒内未变化”：Canvas POST 可能已接收，但没有证据证明设备完成新渲染，不能算成功。
- 设备显示“活跃中”但持续“90 秒内未变化”：先在 Dot. App 的循环列表中对 `Vibe Usage` 使用“更多 → 立即显示”，确认循环内容能被设备消费；仍无效时重新连接电源或重启设备。固定内容时段会优先于循环内容，必要时同时检查固定内容配置。
- 只有“API 已确认，视觉未确认”：状态变化已确认，但 API 没返回可下载的渲染图 URL。
- launchd 无法启动：先核对 plist 中的绝对 Node/项目路径，再查看 `artifacts/launchd.stderr.log`。
