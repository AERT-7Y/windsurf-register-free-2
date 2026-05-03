# 变更记录

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 建议，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- **反检测系统（Anti-Detect）**：新增 `anti-detect.js` 模块，实现完整的机器标识符重置
  - 重置 `storage.json` 中的 `telemetry.machineId`、`telemetry.macMachineId`、`telemetry.devDeviceId`、`telemetry.sqmId`
  - 重置 `installation_id`（`.codeium/windsurf/installation_id`）
  - 自动在账号切换流程中触发反检测重置，降低多账号关联风险
  - 提供 IPC 接口 `antidetect:reset` 和 `antidetect:checkStatus` 供 UI 调用
- **浏览器反指纹保护**：新增 `antifingerprint.js` 注入脚本
  - 隐藏 `navigator.webdriver` 自动化标志
  - 随机化 Canvas 指纹（注入微小噪声）
  - 随机化 WebGL 渲染器信息（ANGLE/显卡型号轮换）
  - 防止 WebRTC 本地 IP 泄漏
  - 干扰 AudioContext 音频指纹检测
  - 保护硬件并发数和设备内存信息
  - 在 `document_start` 阶段注入，覆盖所有 windsurf.com 页面
- **加密安全密码生成**：浏览器扩展使用 `crypto.getRandomValues()` 替代 `Math.random()` 生成密码，采用 Fisher-Yates 洗牌算法

### Changed

- 扩展 Manifest V3 配置：新增 `antifingerprint.js` 作为首个内容脚本，优先级最高
- 账号切换流程：`direct-switch.js` 中 `switchAccountToDB()` 完成后自动调用 `antiDetect.fullReset()`
- 密码生成算法：从 `Math.random()` 升级为加密安全的 `crypto.getRandomValues()`
- 修复 `background.js` 中第 449-461 行的死代码（`return` 后的重复代码块）

### Fixed

- 移除 `background.js` 中永远不会执行的重复发送消息代码
- 密码生成使用 Fisher-Yates 标准洗牌算法，消除 `sort(() => Math.random() - 0.5)` 的非均匀分布问题

---

## [1.0.0] - 2026-03-xx

### Added

- 初始发布：浏览器扩展批量注册 + Electron 桌面管理程序
- 支持临时邮箱 + 自动化填表 + OTP 验证码接收
- 账号管理：增删改查、刷新、导入导出
- 一键切换 Windsurf 账号（协议唤起 + 直接修改本地状态库）
- 开源治理文档：`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`、`SECURITY.md`、`CHANGELOG.md`
- README：架构图文档、使用教程、底层逻辑说明、研究与溯源声明

---

发版时请在本节上方新增 `## [x.y.z] - YYYY-MM-DD]`，并保留 `[Unreleased]` 占位。
