# 统一弹幕玩法管理系统

仓库：[maskofzy/admin_codex](https://github.com/maskofzy/admin_codex)。唯一源码工作区为 `D:\xd\admin_codex`。

- `admin_html_codex/`：Vue 3 管理台，支持已配置的多个独立管理 API。
- `backend-admin/`：Fastify 管理 API，启动时按服务端固定注册表建立各项目 MySQL / Redis 连接。
- 玩法业务后台独立运行、发布和重启，不属于本仓库。

开始任务先读 [当前交接](docs/HANDOFF.md)，再检查 Git 状态与最近提交。线上路径、回退及保留规则见 [部署说明](docs/DEPLOYMENT.md)；历史发布证据见 [归档索引](docs/archive/README.md)。

## 本地开发与验证

分别在两个子目录安装依赖 `npm ci`。API 的 Node 要求和环境变量见 [API 文档](backend-admin/README.md) 及 `.env.example`；真实凭据放本地 `.env`，不提交。

```powershell
cd backend-admin
npm run dev
# 另一个终端，在仓库根目录开始
cd admin_html_codex
npm run dev
```

前端验证：`npm test`、`npm run typecheck`、`npm run build`。API 验证：`npm run check`、`npm run test:integration`。集成测试需要真实 MySQL/Redis 和适用的外部业务消费者模块；页面修改还需真实浏览器验证。

## 接入玩法

1. 核对玩法真实 schema、事件消费协议及能力，只在服务端固定注册表登记项目和连接变量前缀。
2. 连接凭据放对应管理服务受保护环境，礼物映射放独立 supply-gifts 配置；不得由浏览器提供 DSN。
3. 对目标运行只读 schema preflight 和适用的跨进程验证；不统一新建通用管理表，不盲跑业务 schema。
4. 保存连接/能力配置后重启对应独立管理 API 并验收。已注册玩法由 API 动态返回，前端无需再复制 id/name 列表。
5. 前端公开 projects.json 只配置服务、共享登录和测试映射，保留各部署环境差异，不含凭据。

本地 cars / tower-dy / tower-ks 是开发示例，不能覆盖生产配置。详细功能与接口见 [前端文档](admin_html_codex/README.md) 和 [API 文档](backend-admin/README.md)。
