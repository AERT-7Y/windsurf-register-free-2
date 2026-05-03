# 参与贡献指南

感谢你愿意改进本仓库。请先阅读根目录 [README.md](README.md) 中的 **「研究与溯源声明」** 与 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

## 如何提交变更

1. **Fork** 本仓库，在独立分支上开发（建议命名：`fix/…`、`feat/…`、`docs/…`）。  
2. 尽量 **小步提交**，提交说明使用清晰的中文或英文短句，说明「做了什么、为什么」。  
3. 发起 **Pull Request** 前请自检：  
   - 未包含 **密码、令牌、API Key、个人邮箱、本机绝对路径、商业软件二进制** 等敏感内容；  
   - 未引入与「交流学习、互操作性」无关的破解或盗版用途代码；  
   - 对行为或配置有变更时，同步更新 **README** 或 **CHANGELOG** 中的相关段落。

## 代码与目录约定

- **browser-extension**：保持 Manifest V3 合规；新增跨域请求必须同步 `host_permissions`。  
- **windsurf-auto-free-main**：主进程与渲染进程边界清晰，避免在渲染进程暴露 Node 能力；网络与文件 IO 集中在 `src/services` 与 `src/main`。

## 报告问题

- **缺陷或功能请求**：使用 GitHub Issues，并尽量提供复现步骤、系统版本、浏览器/Electron 版本（勿贴账号密码）。  
- **安全或合规疑虑**：请优先阅读 [SECURITY.md](SECURITY.md)，按其中方式联系，**勿**在公开 Issue 中披露可利用细节。

再次感谢你的贡献。
