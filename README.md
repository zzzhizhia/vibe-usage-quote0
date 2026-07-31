# vibe-usage-quote0

把 Vibe Usage 云端的真实 AI 编码用量，稳定推送到 Quote/0 的 296×152 黑白桌面画板。画面突出今日 Token，并显示今日费用、会话数、活跃时长、近 7 日 Token/费用，以及一个主力工具和模型提示；不会发送项目名。总 Token 与网页面板口径一致，包含缓存输入 Token。

![Vibe Usage 在 Quote/0 上的用量画板示例](https://raw.githubusercontent.com/zzzhizhia/vibe-usage-quote0/main/artifacts/quote0-render-4x.png)

## 快速开始

开始前，请在 Dot. App 内容工坊把“画板 API”加入 Quote/0 的设备循环任务，并保持设备在线。

### macOS/Linux

需要 Node.js 20+。Linux 自动刷新还需要可用的 systemd 用户会话。

```bash
npm install -g vibe-usage-quote0
vibe-usage-quote0 enable
```

### Windows 10/11

需要 Node.js 20+ 和 Windows PowerShell 5.1+。

```powershell
npm install -g vibe-usage-quote0
vibe-usage-quote0 enable
```

`enable` 会在交互式终端中隐藏读取 Vibe API Key、Dot API Key 和设备 ID，然后自动完成：

1. 验证 Vibe 1 日与 7 日用量接口及 Dot/Quote 凭据。
2. 发现设备上的 `CANVAS_API`；存在多个画板时要求按脱敏编号选择，不猜测目标。
3. 原子写入受保护的配置，不把凭据放进命令参数、日志或定时任务。
4. 执行一次真实 push，等待最多 90 秒并确认渲染确实发生变化。
5. 安装当前用户的 30 分钟自动刷新：macOS 使用 launchd，Linux 使用 systemd user timer，Windows 使用 Limited 计划任务。

已有配置默认复用；替换时必须再次确认。新凭据验证失败不会覆盖旧配置。设备休眠或调度安装失败时，有效配置会保留，命令会明确说明失败阶段；修复后重新运行同一条 `vibe-usage-quote0 enable` 即可。

## 常用命令

```bash
vibe-usage-quote0 doctor
vibe-usage-quote0 dry-run
vibe-usage-quote0 push
vibe-usage-quote0 interval 60
vibe-usage-quote0 disable
vibe-usage-quote0 update
```

| 命令 | 作用 |
|---|---|
| `enable` | 安全配置、真实推送并安装当前平台的自动刷新 |
| `doctor` | 读取 Vibe 1 日/7 日数据，确认目标画板与设备状态 |
| `dry-run` | 只访问 Vibe，输出聚合数值与 Canvas payload 脱敏摘要 |
| `push` | 立即推送，并等待真实渲染变化 |
| `interval <minutes>` | 设置 1-44640 分钟的刷新间隔，并更新已安装的调度任务 |
| `disable` | 解除本工具的定时任务，保留配置、日志和渲染图 |
| `update` | 通过 npm 全局更新至最新版 |

`push` 会先精确选择画板，再检查设备状态。休眠、离线、关机或未知状态会在 Canvas POST 前失败。只有 `renderInfo.last`、渲染图 URL 或同一 URL 的图片内容指纹发生变化才算成功；HTTP 2xx 本身不算渲染完成。

## 平台与安全

| 平台 | 自动刷新 | 配置保护 |
|---|---|---|
| macOS | 当前用户 launchd LaunchAgent | 配置文件严格为 `0600` |
| Linux | 当前用户 systemd service + timer，无需 root | 配置文件严格为 `0600` |
| Windows 10/11 | 当前用户、Limited 计划任务 | 关闭 ACL 继承，仅允许当前用户 |

Vibe 配置写入 `~/.vibe-usage/config.json`。Quote 配置在 macOS/Linux 写入 `${XDG_CONFIG_HOME:-~/.config}/vibe-usage-quote0/config.json`，Windows 默认写入 `%APPDATA%\vibe-usage-quote0\config.json`。这些文件由 `enable` 自动创建和保护，无需手工编辑。

macOS/Linux 的渲染图保存到 `${XDG_DATA_HOME:-~/.local/share}/vibe-usage-quote0/quote0-render.png`；Windows 默认保存到 `%LOCALAPPDATA%\vibe-usage-quote0\quote0-render.png`。下载后会检查 296×152 尺寸、黑白像素、墨点覆盖率和画布边缘。没有可下载 URL 时只报告“API 已确认，视觉未确认”。

macOS launchd 和 Linux systemd unit 会保存显式设置的 XDG 路径，但不会保存 API Key 或设备 ID。请使用全局安装；不要用临时 `npx` 路径创建长期自动刷新任务。

## 故障排查

- `enable 需要交互式终端`：直接在 Terminal、shell 或 PowerShell 窗口中运行，不要通过管道、CI 标准输入或命令参数传递凭据。
- 没有 `CANVAS_API`：先在 Dot. App 内容工坊把“画板 API”加入该设备循环任务，再重新运行 `enable`。
- “设备休眠中”或“状态无法确认可用”：唤醒设备，确认持续接电联网后重试；程序不会在不确定状态下推送。
- “90 秒内未变化”：API 可能已接收，但没有证据证明 Quote/0 完成了新渲染。先在 Dot. App 对 `Vibe Usage` 使用“更多 → 立即显示”，再检查固定内容时段、电源和网络。
- macOS 调度失败：确认当前命令运行在图形登录用户会话，并查看 `${XDG_STATE_HOME:-~/.local/state}/vibe-usage-quote0/launchd.stderr.log`。
- Linux 调度失败：确认 `systemctl --user` 可用；容器、精简发行版或没有用户 bus 的会话可在 `enable` 最后选择不安装自动刷新，配置和手动 `push` 仍可使用。
- Windows 调度失败：确认 PowerShell 5.1+ 可用，并从同一当前用户会话重新运行 `enable`。
- `401`：Vibe 或 Dot API Key 无效；客户端不会重试。
- `429`、`5xx` 或网络错误：最多退避重试 3 次，仍失败则非零退出。

## 开发验证

```bash
pnpm build
pnpm test
pnpm security-check
pnpm pack --dry-run
```

项目使用 Node.js ESM、内置 `fetch`/`node:test`，没有运行时依赖。`security-check` 会扫描整个项目根目录，发现疑似真实凭据或白名单外文件时非零退出。
