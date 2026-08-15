# 通用弹幕管理系统

本目录由两个彼此独立的服务组成：

- `backend-admin`：独立管理 API，默认监听 `8121`。它根据每个请求的 `x-project-id` 选择预先注册的独立 MySQL pool 和 Redis 连接。
- `admin_html_codex`：统一 Vue 管理台，只连接一套管理 API；新增玩法不复制页面。

直播业务继续由同级的 `D:\xd\backend-codex`（默认 `8120`）承载。管理服务修改、停止或重启不会重启直播业务进程。

## 启动

```powershell
cd D:\xd\admin_codex\backend-admin
npm start
```

开发管理页面：

```powershell
cd D:\xd\admin_codex\admin_html_codex
npm run dev
```

生产静态文件由以下命令生成：

```powershell
npm run build
```

## 新增玩法

1. 在 `backend-admin/config/projects.json` 注册稳定的项目 id、数据库名、Redis DB、平台、能力和礼物目录。
2. 在 `backend-admin/.env` 增加该项目 `envPrefix` 对应的平台凭据和可选连接覆盖项。
3. 先在目标数据库运行该玩法业务后台的 schema，再运行管理服务的 `npm run db:schema` 创建三张管理表。
4. 在 `admin_html_codex/public/projects.json` 增加相同的 `{ "id", "name" }`，然后重新构建前端。

每个项目必须使用不同的 MySQL 数据库和 Redis DB。服务不会执行动态 `USE database`，也不会根据客户端传入数据库名。

配置修改不是客户端热更新：它只会被后续开播或重新连接读取。
