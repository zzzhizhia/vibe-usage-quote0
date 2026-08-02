# Changelog

本项目的所有重要变更均记录在此文件中。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.4.0] - 2026-08-03

### Added

- 新增 `vibe-usage-quote0 display <main|secondary> <range>`，主要与次要数据可独立配置 `today`、`24h`、`7d`、`30d`、`90d`、任意 `Nd`（1-3650）或 `yyyyMMdd-yyyyMMdd` 自定义日期。

### Changed

- 主要区域的 Token、费用、会话、活跃时长与主力工具/模型现在统一跟随 `main` 档位，次要区域的 Token/费用跟随 `secondary` 档位；旧配置默认保持“今天 + 近 7 日”。
- “今天”改为当前系统时区的本地零点至现在，并与滚动 24 小时严格区分；所有 Vibe 时间查询都会携带本地时区，自定义范围包含首尾日期。

### Fixed

- 修复 Windows CI 将跨平台显示配置测试误判为 Unix 权限错误的问题，并让安全检查精确接受仓库中的 Codex 与 Entire 配置文件。

## [0.3.2] - 2026-07-31

### Fixed

- 修复 Windows 上 `vibe-usage-quote0 update` 直接启动 `npm.cmd` 时出现 `spawnSync npm.cmd EINVAL` 的问题；现在通过系统命令解释器执行 npm 更新。

## [0.3.1] - 2026-07-31

### Fixed

- 修复 Windows 普通用户运行 `enable` 或 `interval` 时，配置 ACL 写入错误要求 `SeSecurityPrivilege` 的问题；现在只更新文件 DACL，不再尝试重设 owner 或写入审计安全描述符。
- 修复 launchd 模板使用 CRLF 换行时未写入持久化环境变量的问题。

## [0.3.0] - 2026-07-31

### Added

- `vibe-usage-quote0 enable` 现已支持 macOS 与 Linux：macOS 自动安装当前用户 launchd 任务，Linux 自动安装无需 root 的 systemd user timer。
- Linux 的 `interval` 与 `disable` 现可更新和解除本项目的 systemd 用户级自动刷新。

### Changed

- README 改为 macOS/Linux 优先的三平台一键配置流程，删除 JSON、权限和调度器的繁杂手工安装步骤。

## [0.2.0] - 2026-07-31

### Added

- 新增 `vibe-usage-quote0 interval <minutes>`，可安全保存 1-44640 分钟的推送刷新间隔，并同步更新已安装的 Windows 计划任务或 macOS launchd 任务。
- 新增 `vibe-usage-quote0 disable`，可幂等解除本项目的 Windows/macOS 定时任务而不删除配置与数据。
- 新增 `vibe-usage-quote0 update`，可通过 npm 全局更新至最新版。

### Changed

- 将 `vibe-usage-quote0 setup` 重命名为 `vibe-usage-quote0 enable`，不保留旧命令兼容。
- Windows enable、手工安装器与 macOS launchd 继续默认使用 30 分钟；后续安装会沿用已保存的 `intervalMinutes`。
- macOS/Linux 加载已有 Vibe 配置时会静默将过宽权限收紧为 `0600`；无法收紧时拒绝继续使用该凭据。

## [0.1.2] - 2026-07-30

### Added

- 新增 Windows `vibe-usage-quote0 setup` 交互式向导：隐藏输入凭据、复用或明确替换现有配置、发现并精确选择 `CANVAS_API`、确认脱敏设备目标、执行真实 push，并在确认渲染变化后安装 PT30M 当前用户计划任务。
- 新增可注入 setup 核心与 Windows tarball CI 场景，覆盖 401 不落盘、秘密不输出、两份配置 ACL、失败回滚和重复安装。

### Changed

- README 将 Windows 新用户快速开始缩减为全局安装与一条 setup 命令；手工 JSON、ACL、`doctor`/`push` 和安装器命令移至高级/故障排查。
- 今日与近 7 日 Token 改用中文单位显示，至多保留四位有效数字，并在进位时自动切换到更高单位。

### Fixed

- 修复 Windows setup 在无需安装计划任务的路径上过早解析全局运行时路径的问题。
- 修复 Windows 凭据 ACL 设置失败时未能完整上报错误、清理临时文件的问题。
- 隔离 Windows PowerShell 模块加载与命令入口，避免测试和 setup 组合时发生意外执行。

## [0.1.1] - 2026-07-30

### Added

- 支持 Windows 10/11、PowerShell 5.1+ 和 Node.js 20+。
- 提供当前用户级 Windows 计划任务，每 30 分钟自动刷新 Quote/0 画板。
- 增加 Windows、macOS、Ubuntu 三平台 CI，以及 Windows 安装、失败码、日志脱敏、幂等更新和定向卸载检查。

### Fixed

- 修复 Windows PowerShell 5.1 重定向原生命令 stderr 时，将成功的 `.cmd` 错误记录为失败的问题。
- 修复计划任务无法继承临时 XDG 配置路径的问题；安装前会校验路径已持久化。
- Windows 改用当前用户 ACL 保护凭据，不再显示无意义的 Unix `0600` 权限警告；macOS/Linux 权限检查保持不变。
- 项目与 GitHub Actions 统一使用兼容 Node.js 20 的 pnpm 版本，确保三平台 CI 和 tag 发布流程能够完成工具链初始化。
- 测试脚本改用零依赖 Node.js 启动器枚举 `*.test.js`，避免 Windows 将 shell 通配符当作字面量路径，同时排除 fixture 文件。

### Changed

- npm 包加入 Windows 安装、运行和卸载脚本，并补充对应使用与安全说明。

## [0.1.0] - 2026-07-29

### Added

- 首次公开发布：将 Vibe Usage 云端用量生成为中文 296x152 黑白 Quote/0 Canvas。
- 提供 `doctor`、`dry-run`、`push` 命令和 macOS launchd 30 分钟自动刷新模板。
- 推送前检查设备状态，推送后等待真实渲染变化，并对凭据和日志执行防泄漏检查。

[Unreleased]: https://github.com/zzzhizhia/vibe-usage-quote0/compare/v0.3.2...HEAD
[0.3.2]: https://github.com/zzzhizhia/vibe-usage-quote0/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/zzzhizhia/vibe-usage-quote0/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/zzzhizhia/vibe-usage-quote0/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/zzzhizhia/vibe-usage-quote0/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/zzzhizhia/vibe-usage-quote0/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/zzzhizhia/vibe-usage-quote0/releases/tag/v0.1.1
[0.1.0]: https://www.npmjs.com/package/vibe-usage-quote0/v/0.1.0
