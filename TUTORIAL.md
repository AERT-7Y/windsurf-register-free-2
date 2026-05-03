# 使用与发布教程

本文是**分步操作手册**；架构说明、研究声明与图示见 [README.md](README.md)。

---

## A. 浏览器扩展（批量注册）

### A1. 准备

1. 确认 `browser-extension/icons/` 下有 `icon16.png`、`icon48.png`、`icon128.png`（与 `manifest.json` 一致）。  
2. 使用 **Chrome** 或 **Edge**。

### A2. 加载扩展

1. 地址栏打开：  
   - Chrome：`chrome://extensions`  
   - Edge：`edge://extensions`
2. 打开右上角的 **开发者模式**。  
3. 点击 **加载已解压的扩展程序**。  
4. 选择本仓库里的 **`browser-extension`** 文件夹（不是上一级 `windsurf-register`）。

### A3. 使用侧栏

1. 点击工具栏上的扩展图标。  
2. 按浏览器提示打开 **侧边栏（Side Panel）**。  
3. 在「数量」里填本批要跑的条数 → 点 **开始注册**。  
4. 需要停时点 **停止**。  
5. 在 **导出 JSON** 里保存结果，供桌面管理程序导入。

### A4. 常见问题

- 页面改版后填表失败：看侧栏日志与当前页面文案，必要时改 `content.js` 选择器。  
- 已登录同一产品时跳个人页：可先退出站点登录或依赖扩展里的清理逻辑后再试。

---

## B. 桌面管理程序（Electron）

### B1. 安装依赖

打开终端，进入 **`windsurf-auto-free-main`**：

```bash
cd windsurf-auto-free-main
npm install
```

### B2. 两种启动方式

| 方式 | 命令 / 操作 | 适用 |
|------|----------------|------|
| 普通 | `npm start` | 添加账号、导入导出、刷新列表；**不必**管理员。 |
| 管理员 | 双击 **`start.bat`**（会 UAC 提权） | 需要 **切换 Windsurf 登录账号**（要结束进程并写本机用户数据）时建议用。 |

### B3. 推荐第一次使用顺序

1. 启动后看一眼界面上的 **代理/网络** 提示是否和本机一致。  
2. **添加账号**：输入邮箱 + 密码 → 等待完成（失败看窗口/控制台日志）。  
3. **从扩展衔接**：扩展里 **导出 JSON**，在管理台用 **从文件导入** 或粘贴导入。  
4. **刷新**：单条「刷新数据」或「刷新全部」，用于更新令牌。  
5. **切换账号**：列表里点切换；若失败，确认已用 **管理员方式** 启动，且本机已安装 Windsurf。

### B4. 导出备份

使用管理台自带的导出功能保存到本机；文件含敏感信息，勿上传网盘或发到公开处。

---

## C. 按需改配置（进阶）

### 扩展

- 换临时邮箱 API：改 **`background.js`** 里的请求基址，并同步改 **`manifest.json`** 的 `host_permissions`。  
- 换注册页域名：改 **`manifest.json`** 的 `content_scripts.matches` 与后台里打开的标签页 URL。

### 桌面程序

- HTTP 行为、超时：看 **`windsurf-auto-free-main/src/services/`** 里负责请求的模块。  
- 本地数据库位置：与工作目录有关，见 [README.md](README.md)「配置」一节。

---

## D. 推到 GitHub（首次）

### D1. 本地应已排除的内容

已用根目录 **`.gitignore`** 忽略例如：`node_modules/`、`data/`、`*.db`、`.env`、部分导出文件名等。**不要**把个人账号导出、数据库用 `git add -f` 强推上去。

### D2. 若尚未初始化 Git

在 **`windsurf-register`**（仓库根目录）执行：

```bash
git init
git branch -M main
git add -A
git status
git commit -m "Initial commit"
```

### D3. 在 GitHub 新建空仓库

- 不要勾选「用 README 初始化」（避免和无 remote 的历史冲突）。

### D4. 关联远程并推送

把下面的地址改成你的仓库：

```bash
cd windsurf-register
git remote add origin https://github.com/你的用户名/仓库名.git
git push -u origin main
```

若提示 `remote origin already exists`：

```bash
git remote remove origin
git remote add origin https://github.com/你的用户名/仓库名.git
git push -u origin main
```

**登录**：HTTPS 一般用浏览器或 PAT；若用 SSH，把 `origin` 改成 `git@github.com:你的用户名/仓库名.git`，并先在 GitHub 配好 SSH 公钥。

### D5. 以后有修改再推送

```bash
git add -A
git status
git commit -m "说明本次改了什么"
git push
```

---

## E. 相关文档

| 文档 | 内容 |
|------|------|
| [README.md](README.md) | 架构图、底层逻辑、研究声明、免责声明 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 如何参与贡献 |
| [SECURITY.md](SECURITY.md) | 安全与版权联系 |
