# AGENTS.md

本仓库是统一后台管理系统的独立工作区。开始任何任务前，必须完整阅读 `docs/HANDOFF.md`，再运行 `git status --short` 和 `git log -5 --oneline`。

## 用户核心工程约束

- Do not preserve backward compatibility.
- Choose the simplest implementation that fully meets the current requirements.
- Prefer established, well-maintained libraries over custom implementations.
- Make architectural decisions for the long term. Do not accept a stopgap that only works for now and is meant to be replaced later.

## 仓库范围

- `admin_html_codex/`：Vue 3 管理前端。
- `backend-admin/`：独立 Fastify 管理 API。
- `docs/HANDOFF.md`：当前架构、数据契约、部署状态、已知缺陷和验证矩阵。

cars 与 towerSimplify 的业务后台是外部依赖，不属于本仓库。未经用户明确要求，不修改：

- `D:\xd\backend-codex`
- `D:\xd\newBackend\tower`
- `D:\godot\ideas\cars` 中的游戏客户端、Relay、authority、CAS/WAL/durable 或玩法数值

管理 API 必须继续与业务后台保持独立进程、独立发布和独立重启。不得把平台回调、客户端事件拉取或 UE 业务接口合并进管理 API。

## 安全与数据边界

- 不提交 `.env`、密钥、token、数据库密码、`node_modules`、`dist` 或运行日志。
- 多项目数据库连接只能来自服务端受审查的固定注册表；禁止浏览器提交 DSN、请求时动态 `USE database` 或项目间复用可变连接。
- 修改补偿、Redis 队列、事件 payload、平台 token key 或业务表契约时，必须补跨进程真实集成测试。
- 当前免 Token 仅允许本机 development/test + loopback + Mock 条件；不得放宽生产防线。

## 修改纪律

- 工作区已有修改默认属于用户或其他任务，不得重置、覆盖或清理无关内容。
- 先修根因，再补回归测试；不要只改 mock 断言或隐藏错误。
- 管理前后端同仓同步演进，不为旧管理页面增加兼容层。
- 部署目录和源码基线必须通过发布清单或 SHA-256 核对；未经用户明确要求不推送远端。

## 默认验证

管理前端：

```powershell
cd admin_html_codex
npm test
npm run typecheck
npm run build
```

管理 API：

```powershell
cd backend-admin
npm run check
npm run test:integration
```

涉及页面时还需使用真实浏览器验证；涉及 MySQL、Redis 或业务后台契约时必须运行真实依赖集成测试。验收日志不能只检查 `.err.log`，还要扫描结构化日志中的 `level >= 50` 和意外 HTTP 5xx。
