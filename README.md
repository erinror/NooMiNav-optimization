# 🚀 FlarePortal - 极简云端服务导航

<div align="center">

极全能、高颜值、全动态后台的云端导航门户  
零成本部署 · 告别手动改环境变量 · 一键可视化管理

</div>

---

## 📖 项目简介

FlarePortal (原 NooMiNav) 是一个基于 Cloudflare (CF) 生态构建的现代化高级导航站。


---

## ✨ 核心特性

- 🎨 **极致 UI 质感**：原生毛玻璃（Glassmorphism）特效，后台支持 ☀️日间 / 🌙夜间 模式一键切换。
- ⚙️ **全动态可视化后台**：双列宽屏设置面板，支持在网页端直接编辑 JSON 配置、修改密码、更改背景图。
- ⚡ **双擎驱动部署**：一套代码，完美兼容 Cloudflare Pages 和 Cloudflare Workers 部署。
- 💬 **原生互动留言板**：自带 `/contact` 留言板页面，支持无感 AJAX 提交，并可通过 Webhook 推送到微信/TG，点击推送卡片还能查看高级加密的详情页。
- 📊 **智能数据看板**：
  - 实时追踪：精准统计总点击、月点击、今日点击。
  - 访客分析：记录详细的点击时间、IP 地址和设备环境 (UA)。
- 🛡️ **防拉黑机制**：支持自定义微信/TG 推送卡片的跳转域名，保护主域名安全。

---

## 🚀 部署指南 (CF 网页版专属)

跟着下面的步骤，几分钟就能拥有你自己的专属高级导航站！😇

### 第一步：创建项目并粘贴代码

1. 登录 Cloudflare 网页版后台，进入 **Workers & Pages**。
2. 点击 **创建 (Create)**，你可以选择创建一个 Worker 或者 Pages 项目。
3. 将本项目中 `functions/[[path]].js` 里的所有代码，直接复制并粘贴到你新建项目的代码编辑器中，点击 **部署 (Deploy)**。

### 第二步：配置安全入口 (环境变量)

在项目的 **设置 (Settings)** -> **变量和机密 (Variables and Secrets)** 中，添加唯一一个必须要填的环境变量：

| 变量名 | 必填 | 说明 | 示例值 |
| :--- | :---: | :--- | :--- |
| `admin` | ✅ | 后台的访问路径 (注意：这不是密码！)<br>如果你填 `mimi`，你的后台地址就是 `你的域名/mimi` | `mimi` |

(💡 V13.0 之后，诸如 `TITLE`, `LINKS`, `img` 等变量都不需要在这里填了，全部转移到了网页后台！)

### 第三步：创建并绑定 D1 数据库 (核心)

1. 在 CF 左侧菜单找到 **D1 SQL 数据库**，点击创建数据库（例如命名为 `nav_db`）。
2. 回到你的 Worker/Pages 项目设置中，找到 **D1 数据库绑定 (D1 Database Bindings)**。
3. 添加绑定：
   - **变量名称 (Variable name)**: 必须填 `db` (小写)。
   - **命名空间 (Namespace)**: 选择你刚才创建的数据库。

⚠️ **重要**：绑定完成后，请务必重新部署一次项目以便生效！

### 第四步：初始化数据库表

进入你刚才创建的 D1 数据库的 **控制台 (Console)**，按顺序粘贴并执行以下 SQL 语句：

#### 1. 创建日志表 (Logs)
```sql
CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id TEXT,
    click_time TEXT,
    month_key TEXT,
    ip_address TEXT DEFAULT 'unknown',
    user_agent TEXT DEFAULT 'unknown'
);
```

#### 2. 创建统计表 (Stats)
```sql
CREATE TABLE IF NOT EXISTS stats (
    id TEXT PRIMARY KEY,
    name TEXT,
    type TEXT,
    total_clicks INTEGER DEFAULT 0,
    year_clicks INTEGER DEFAULT 0,
    month_clicks INTEGER DEFAULT 0,
    day_clicks INTEGER DEFAULT 0,
    last_year TEXT,
    last_month TEXT,
    last_day TEXT,
    last_time TEXT
);
```

#### 3. 创建性能优化索引 (强烈建议执行，告别卡顿！)
```sql
CREATE INDEX IF NOT EXISTS idx_logs_time ON logs(click_time);
CREATE INDEX IF NOT EXISTS idx_logs_month ON logs(month_key);
```

(注：`settings` 表代码会在首次运行时自动帮你创建，无需手动执行。)

---

## 🎮 新手上路：如何使用后台？

部署完成啦！现在你可以开始装修你的导航站了：

1. **进入后台**：访问 `https://你的域名/你设置的admin变量名`（例如 `https://nav.example.com/mimi`）。
2. **首次登录**：默认的初始密码是 `123456`。
3. **全局设置**：
   - 登录成功后，点击页面上方的 **「⚙️ 系统设置」**。
   - 在这里，你可以立刻把登录密码修改成你自己的安全密码！
   - 你还可以直接在这个全屏面板里修改网站标题、背景图、邮箱、推送接口，以及编辑你的导航链接 JSON。
   - 点击右上角的 **「💾 保存并生效」**，所有更改瞬间完成！

---

## 📝 JSON 格式参考模板

在后台的「系统设置」面板中，你可以参考以下格式来配置你的精选资源和友链：

### 💎 LINKS (精选资源配置)

支持 `tag` 属性，可生成高颜值的发光小标签（例如：“🚀 免费试用”）。  
支持 `backup_url`，可生成备用线路按钮。

```json
[
  {
    "id": "cloud-drive",
    "name": "极速云盘",
    "emoji": "☁️",
    "note": "企业级安全云端存储",
    "url": "https://drive.example.com",
    "tag": "✨ 极速响应"
  },
  {
    "id": "design-tool",
    "name": "在线协作设计",
    "emoji": "🎨",
    "note": "支持多人实时同步画板",
    "url": "https://design.example.com",
    "backup_url": "https://backup.design.example.net",
    "tag": "🚀 免费试用"
  }
]
```

### 🔗 FRIENDS (合作伙伴配置)

```json
[
  {
    "id": "tech-blog",
    "name": "前沿技术博客",
    "url": "https://blog.example.com/"
  },
  {
    "id": "open-source",
    "name": "开源社区导航",
    "url": "https://opensource.example.org/"
  }
]
```

---

## 🛠️ 本地开发与测试

本项目包含完整的本地模拟环境，无需部署即可体验所有功能。

1. 进入 **本地测试专用** 目录。
2. 运行安装脚本：
   - **Windows**: 双击 `install_dependencies.bat`
   - **Mac/Linux**: 运行 `npm install express`
3. 启动服务器：
   - **Windows**: 双击 `start_local_test.bat`
   - **Mac/Linux**: 运行 `node local_server_full_cf_simulation.js`
4. 浏览器访问 `http://localhost:8787` 即可预览。

---

## 📄 开源协议

基于 MIT License 开源。如果你觉得这个项目对你有帮助，欢迎点个 Star ⭐！
