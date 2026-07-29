# vibe-usage-quote0

把 Vibe Usage 云端的真实 AI 编码用量，稳定推送到 Quote/0 的 296×152 黑白桌面画板。画面突出今日 Token，并显示今日费用、会话数、活跃时长、近 7 日 Token/费用，以及一个主力工具和模型提示；不会发送项目名。总 Token 与网页面板口径一致，包含缓存输入 Token。

![Vibe Usage 在 Quote/0 上的用量画板示例](https://raw.githubusercontent.com/zzzhizhia/vibe-usage-quote0/main/artifacts/quote0-render-4x.png)

## 快速开始

```bash
npm install -g vibe-usage-quote0
vibe-usage-quote0 doctor
vibe-usage-quote0 push
```

也可以临时运行：

```bash
npx vibe-usage-quote0 doctor
```

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

## 用法

```bash
vibe-usage-quote0 doctor
vibe-usage-quote0 dry-run
vibe-usage-quote0 push
```

| 命令 | 作用 |
|---|---|
| `doctor` | 读取 Vibe 1 日/7 日数据，确认目标 `CANVAS_API` 与设备可用状态 |
| `dry-run` | 只访问 Vibe，输出聚合数值、Top 3 与 Canvas payload 脱敏摘要 |
| `push` | 推送 Canvas，并在 90 秒内等待真实渲染变化 |

`push` 会先通过 `/loop/list` 精确选择画板，再用 `/status` 检查设备。休眠、离线、关机或未知状态会在 Canvas POST 前失败；设备可用时才推送。只有 `renderInfo.last`、渲染图 URL 或同一 URL 的图片内容指纹发生变化才算成功。

如果状态返回渲染图 URL，图片会保存到 `${XDG_DATA_HOME:-~/.local/share}/vibe-usage-quote0/quote0-render.png`，并检查尺寸、彩色像素、墨点覆盖率和画布边缘；没有 URL 时只报告“API 已确认，视觉未确认”。

## 每 30 分钟更新

[launchd/com.vibeusage.vibe-usage-quote0.plist](launchd/com.vibeusage.vibe-usage-quote0.plist) 是不含凭据和本机路径的 launchd 模板，`StartInterval` 为 1800 秒。计划任务必须使用全局安装；不要引用 `npx` 的临时路径。

先完成全局安装、配置和手动验证：

```bash
vibe-usage-quote0 doctor
vibe-usage-quote0 push
```

再生成本机 plist：

```bash
PLIST="$HOME/Library/LaunchAgents/com.vibeusage.vibe-usage-quote0.plist"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/vibe-usage-quote0"
PACKAGE_DIR="$(npm root -g)/vibe-usage-quote0"
mkdir -p "$HOME/Library/LaunchAgents" "$STATE_DIR"
cp "$PACKAGE_DIR/launchd/com.vibeusage.vibe-usage-quote0.plist" "$PLIST"
plutil -replace ProgramArguments.0 -string "$(command -v node)" "$PLIST"
plutil -replace ProgramArguments.1 -string "$(command -v vibe-usage-quote0)" "$PLIST"
plutil -replace WorkingDirectory -string "$HOME" "$PLIST"
plutil -replace StandardOutPath -string "$STATE_DIR/launchd.stdout.log" "$PLIST"
plutil -replace StandardErrorPath -string "$STATE_DIR/launchd.stderr.log" "$PLIST"
plutil -lint "$PLIST"
launchctl bootstrap "gui/$(id -u)" "$PLIST"
```

launchd 通常不继承交互式 shell 环境变量，因此应使用前述 `0600` Quote 配置文件。稳定自动刷新要求 Quote/0 持续接入电源和网络；电池休眠时程序会在 POST 前停止，launchd 下个周期再重试。

卸载：

```bash
launchctl bootout "gui/$(id -u)/com.vibeusage.vibe-usage-quote0"
rm "$HOME/Library/LaunchAgents/com.vibeusage.vibe-usage-quote0.plist"
```

## 开发验证

```bash
pnpm build
pnpm test
pnpm security-check
plutil -lint launchd/com.vibeusage.vibe-usage-quote0.plist
```

## 故障排查

`security-check` 会扫描整个项目根目录：发现真实凭据或白名单外文件都会非零退出，而不是只检查预期交付目录。

- `401`：Vibe 或 Quote key 无效；客户端不会重试。
- `429`、`5xx`、网络错误：最多退避重试 3 次，仍失败则非零退出。
- “多个 CANVAS_API”：设置精确的 `QUOTE0_TASK_KEY`，程序不会猜目标。
- “设备休眠中”：连接电源或按设备说明唤醒后重试；程序不会把 HTTP 200 误报为设备可用，也不会在休眠状态下发送 Canvas POST。launchd 会在下一个 30 分钟周期再次尝试。
- “设备状态无法确认可用”：API 返回了未识别状态；为避免错误推送，程序会 fail-closed。先确认设备已唤醒、已接入电源和网络，再运行 `doctor`。
- “90 秒内未变化”：Canvas POST 可能已接收，但没有证据证明设备完成新渲染，不能算成功。
- 新渲染图 URL 短暂返回 `404`：通常表示图片仍在生成；程序会继续轮询，不会立即误报失败，直到图片可下载或达到 90 秒上限。
- 设备显示“活跃中”但持续“90 秒内未变化”：先在 Dot. App 的循环列表中对 `Vibe Usage` 使用“更多 → 立即显示”，确认循环内容能被设备消费；仍无效时重新连接电源或重启设备。固定内容时段会优先于循环内容，必要时同时检查固定内容配置。
- 只有“API 已确认，视觉未确认”：状态变化已确认，但 API 没返回可下载的渲染图 URL。
- launchd 无法启动：先核对 plist 中的 Node/CLI 绝对路径，再查看 `${XDG_STATE_HOME:-~/.local/state}/vibe-usage-quote0/launchd.stderr.log`。

## License

MIT
