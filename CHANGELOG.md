# Changelog

本项目的所有重要变更均记录在此文件中。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 新增 Windows `vibe-usage-quote0 setup` 交互式向导：隐藏输入凭据、复用或明确替换现有配置、发现并精确选择 `CANVAS_API`、确认脱敏设备目标、执行真实 push，并在确认渲染变化后安装 PT30M 当前用户计划任务。
- 新增可注入 setup 核心与 Windows tarball CI 场景，覆盖 401 不落盘、秘密不输出、两份配置 ACL、失败回滚和重复安装。

### Changed

- README 将 Windows 新用户快速开始缩减为全局安装与一条 setup 命令；手工 JSON、ACL、`doctor`/`push` 和安装器命令移至高级/故障排查。

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

[0.1.1]: https://github.com/zzzhizhia/vibe-usage-quote0/releases/tag/v0.1.1
[0.1.0]: https://www.npmjs.com/package/vibe-usage-quote0/v/0.1.0
