# 统一后台管理系统独立任务交接

更新时间：2026-08-15
交接目的：后续使用一个独立于 `D:\godot\ideas\cars` 的任务和工作区，继续优化统一后台管理系统。

本文件最初放在 `D:\xd\newBackend\tower` 作为跨项目交接入口；管理系统仓库建立后，权威副本应放在 `D:\xd\admin_codex\docs\HANDOFF.md`。`D:\xd\newBackend\tower` 本身是塔防玩法业务后台，不是统一管理系统源码目录。本文件不会把管理前端、管理 API、塔防平台回调和 UE 业务接口合并成一个工程，也不应在塔防业务目录创建一份管理系统专用的根 `AGENTS.md`。

## 0. 新任务应如何开始

直接使用现有独立目录作为 Git 工作区：

```text
D:\xd\admin_codex
├─ AGENTS.md
├─ docs\HANDOFF.md
├─ backend-admin
└─ admin_html_codex
```

该目录已经初始化为独立 Git 仓库，`origin` 为：

```text
https://github.com/maskofzy/adminManagement.git
```

尚未合并前，当前最新管理源码仍位于：

```text
D:\godot\ideas\cars\.codex-admin-split\backend-admin
D:\godot\ideas\cars\.codex-admin-split\frontend
```

这两个目录是 cars 工作区中的未跟踪暂存目录，不应继续作为长期 canonical source。新任务第一阶段应先把已确认的新版本差异合并进 `D:\xd\admin_codex`、建立 Git 基线，并逐步把源码工作区与实际发布产物分离，然后再做功能优化。

不要把以下内容复制进新的管理系统仓库：

- `node_modules`
- `dist`
- `.env`
- `runtime-*.log`
- cars 游戏客户端、Pixi 渲染、Relay、authority、CAS/WAL/durable 代码
- 任一玩法的业务后台源码

## 1. 用户核心工程约束

以下四条必须原样保留：

- Do not preserve backward compatibility.
- Choose the simplest implementation that fully meets the current requirements.
- Prefer established, well-maintained libraries over custom implementations.
- Make architectural decisions for the long term. Do not accept a stopgap that only works for now and is meant to be replaced later.

对管理系统的具体解释：如果修改管理 API，应同时修改同仓库前端，不增加旧接口兼容层；但平台回调、UE 接口和玩法数据库属于各业务后台的外部契约，除非该业务后台与客户端一起纳入同一任务，否则管理系统不得擅自改变它们。

## 2. 系统组成与所有权

| 组件 | 当前最新开发源码 | 当前部署目录 | 默认端口 | 所有权 |
|---|---|---|---|---|
| 统一管理前端 | `D:\godot\ideas\cars\.codex-admin-split\frontend` | `D:\xd\admin_codex\admin_html_codex` | `4174` | 管理系统 |
| 独立管理 API | `D:\godot\ideas\cars\.codex-admin-split\backend-admin` | `D:\xd\admin_codex\backend-admin` | `8121` | 管理系统 |
| cars 业务后台 | `D:\godot\ideas\cars\.codex-admin-split\backend-business` | `D:\xd\backend-codex` | `8120` | cars 玩法业务 |
| towerSimplify 业务后台 | `D:\xd\newBackend\tower` | 当前目录/生产另行部署 | 本地默认 `8120`，生产示例 `7034/7035` | 塔防玩法业务 |
| cars 游戏客户端 | `D:\godot\ideas\cars` | 游戏部署另行管理 | `4173/8787` | cars 玩法，不属于管理系统 |

统一管理系统只有前两项。各玩法业务后台必须继续独立进程、独立发布和独立重启。

## 3. 当前架构

```text
管理浏览器 :4174
  -> x-project-id + 可选 x-admin-token
  -> 独立管理 API :8121
       -> 每个项目一个启动时固定的 MySQL pool
       -> 需要事件/令牌能力的项目再创建固定 Redis client

平台回调 / 游戏客户端 / UE
  -> 各玩法自己的业务后台
       -> 该玩法 MySQL + Redis
```

管理前端不直接调用玩法业务后台。管理 API 也不注册 `/dy/*`、`msg`、`ksmsg`、开播、客户端拉流或结算接口。

“进程隔离”不等于“数据完全隔离”：管理 API 会直接读取玩法业务表，并在 cars 项目中直接写兼容 Redis 队列和平台 token key。事故恢复 worker 也运行在 8121；停止 8121 会暂停尚未完成的恢复任务，但不会中断 8120 的平台回调、客户端轮询或正常直播业务。

管理 API 当前有两种数据模式：

1. 通用直播玩法：要求十张通用业务表，可选榜单、事故补礼、行会、Mock、配置和平台 token 能力。
2. `tower_config`：直接读写旧塔防 `t_config`、`t_config_welfare`、`t_anchor_info`、`t_config_recover`，只创建 MySQL repository，不创建 Redis、EventStore 或普通管理 repository。

当前 `tower_config` capability 被强制单独使用。因此 `D:\xd\newBackend\tower` 的塔防榜单、福利、礼物流水等业务能力不能仅通过给项目追加普通 capability 自动获得；需要显式的塔防管理 adapter/repository 设计。

## 4. 当前项目注册

管理前端 `public/projects.json` 和管理 API `config/projects.json` 当前注册：

| project_id | 名称 | 平台 | 数据库 | 能力 |
|---|---|---|---|---|
| `cars` | 个人赛车乱斗 | `dy` | `normal_codex_next` | 榜单、事故补礼、行会、Mock、配置/token |
| `tower-dy` | 塔防（抖音） | `dy` | `tower_dy_codex` | `tower_config` |
| `tower-ks` | 塔防（快手） | `ks` | `tower_ks_codex` | `tower_config` |

三个前端项目当前均为 `authRequired:false`，只适用于本机测试。后端只有在 `development|test`、loopback HOST、所有项目均 Mock 时才允许 `ADMIN_AUTH_DISABLED=true`；即使免 Token，`x-project-id` 仍必须发送。

两个塔防项目当前仍指向隔离验收数据库，并使用：

```text
mainConfigId = 1
anchorConfigIds = [1]
welfareConfigId = 未配置
```

当前本地种子版本分别为：

```text
tower-dy: seed-2024-06-18
tower-ks: seed-2024-03-29
```

这些值不是生产配置。正式接入前必须确认真实 DSN、`t_config.ID`、普通/超级福利记录 ID 和实际主播 `configID`，不能沿用本地 ID `1`。

## 5. 已交付的管理功能

- `/projects -> /overview -> 功能详情` 三级页面。
- 本周榜监控、上周 Top100、玩家场次详情。
- 直播事故礼物恢复：按主播昵称和开播时间定位场次、读取原始礼物、代玩家评论落座、服务端持久化间隔补发、取消、失败续跑、审计和幂等。
- 行会、加入码、成员和负责人管理。
- Mock 评论、点赞和礼物调试，仅在服务端声明 Mock 能力时开放。
- 配置 CAS/revision 历史，以及抖音/快手独立 access token 查看和强刷。
- 塔防主配置、福利配置、主播跳关恢复和 63 个怪物图鉴。
- 塔防 compact `ld*/d*` 可编辑，expanded 结构只读；未知字段和历史 number/string 类型保留。
- 一套管理 API 通过固定 project Map 管理多个数据库，不使用动态 `USE database`。

## 6. 当前源码与部署状态

### 6.1 管理前端

排除 `node_modules`、`dist` 和运行日志后，最新暂存与正式部署各有 114 个文件，以下 5 个不一致：

```text
README.md
src/styles.css
src/utils/towerConfig.test.ts
src/utils/towerConfig.ts
src/views/TowerConfigPage.vue
```

这 5 个文件是尚未正式部署的“塔防主配置 JSON 导入”功能。不能用正式部署目录覆盖最新暂存源码，否则会丢失该功能。

最新暂存验证（2026-08-15）：

```text
Vitest: 49/49 passed
vue-tsc --noEmit: passed
```

暂存目录已有 2026-08-13 的构建产物：

```text
dist/assets/index-DH9zqyZB.js
dist/assets/index-DfuC0Cfr.css
```

正式部署仍是 2026-08-08 构建：

```text
dist/assets/index-DHCJfpim.js
dist/assets/index-B3xxW7VE.css
```

正式构建不包含 JSON 导入入口。

### 6.2 管理 API

排除 `.env`、`node_modules` 和运行日志后：

```text
暂存文件：50
部署文件：50
SHA-256 不一致：0
```

最新验证（2026-08-15）：

```text
ESLint: passed
unit tests: 78/78 passed
```

单元测试通过不代表真实 MySQL 路径无错误，见“已知缺陷”。

### 6.3 cars 业务后台

排除 `.env`、`node_modules` 和运行日志后：

```text
暂存文件：43
部署文件：43
SHA-256 不一致：0
ESLint + unit tests: 62/62 passed
```

它不属于新的管理系统仓库。事故补礼、Mock 和平台 token 运维虽然由管理 API 发起，但业务回调、礼物 ledger/outbox、评论/点赞队列和 Contract v1 仍由业务后台拥有。

### 6.4 towerSimplify 业务后台

`D:\xd\newBackend\tower` 不是 Git 仓库。最新验证：

```text
ESLint: passed
unit tests: 50/50 passed
```

当前测试集没有真实 MySQL 集成覆盖；`test:integration` 实际只覆盖本机 Redis DB 15。

`tower.sql` 是旧库参考，包含 `DROP TABLE`、旧触发器和废弃结构，禁止当作当前部署脚本执行。当前初始化只能使用：

```powershell
npm run db:schema
```

## 7. 尚未部署的塔防 JSON 导入

当前最新前端暂存已经实现：

- “导入主配置 JSON”按钮。
- 接受 compact 主配置裸对象，或只包含 `config` 的包装对象。
- 文件只加载为浏览器内未保存草稿，不会自动写数据库。
- 保存仍使用当前服务端 SHA-256 revision 做 CAS。
- expanded `levels`、缺少 `monsterConfig`、四组参数数组或 `level2Exp` 时拒绝导入。
- 未知字段和原 number/string 类型继续保留。

真实联调文件：

```text
D:\godot\ideas\sanguo\outputs\tower_balance_tower_simplify_20260809\tower_config_optimized_tower_simplify.json
```

文件事实：

```text
大小：204523 bytes
SHA-256：32EB5585943E1EF7EE142E6E1B9D5EFD2F02F03768AE1ECEFE2D9679D127264F
关卡：90
怪物：404
health/count/speed/attack 参数：各 90 项
level2Exp：300 项
```

尚缺：

- 真实 204KB 文件的浏览器导入证据。
- 导入后保存前的结构化变更摘要。
- 未保存草稿离开提醒。
- 明确导入是否应覆盖原 `Remark`；当前实现会改成 `导入 <文件名>`。
- 带 `remark/revision` 等额外元数据的导出包格式。
- 真实文件 fixture 或端到端自动化。
- 干净构建和正式部署。

## 8. 已知缺陷与阻塞项

### P1：塔防主播/恢复列表在真实 MySQL 下返回 500

历史 `runtime-8121-20260808-0408.out.log` 多次记录：

```text
GET /admin/v1/tower-config/recoveries -> 500
ER_WRONG_ARGUMENTS
Incorrect arguments to mysqld_stmt_execute
```

2026-08-15 使用当前部署代码直连 MySQL 8.0.32 再次复现：`tower-dy`、`tower-ks` 的 `listAnchors` 和 `listRecoveries` 都会因为 mysql2 prepared statement 中的 `LIMIT ?` 失败。

相关源码：

```text
backend-admin/src/services/tower-config-repository.js
```

当前 78 项单元测试使用 mock SQL，没有覆盖真实驱动行为。必须补真实 MySQL 回归测试，不能只改 mock 断言。

注意：Pino/Fastify 错误写入 `.out.log`；空的 `.err.log` 不代表没有错误。验收时必须扫描结构化日志中的 `level >= 50` 和 HTTP 5xx。

### P1：主播跳关恢复没有被新塔防业务后台消费

管理 API 会向 `t_config_recover` 写记录，但 `D:\xd\newBackend\tower\src\routes\gameplay.js` 的 `startRoomV2` 仍固定返回：

```js
hasrecoverconfig: 0,
recoverconfig: {}
```

业务后台没有读取、消费或标记 `t_config_recover`。因此管理页中的“主播跳关恢复”对这套新塔防业务后台尚未形成完整闭环。

### P1：塔防配置版本与客户端轮询契约不一致

管理 API 当前只更新：

```sql
UPDATE t_config SET Config = ?, Remark = ? WHERE ID = ?
```

没有修改 `t_config.Version`。塔防业务后台的 `getConfigByVersion` 使用 `Version` 判断是否返回新配置。

当前结果：新开播或重新登录能读到最新 JSON，但已运行客户端通常不能通过版本轮询感知修改。配置保存不能宣称为热更新。独立任务需要明确产品语义，并由管理 API 与业务后台共同实现和测试，而不是只改页面文案。

### P1：福利配置模型不一致

塔防业务后台固定读取 `t_config_welfare` ID `1` 和 `2`，分别表示普通福利和超级福利；管理 API 每个塔防项目目前只支持一个可选 `welfareConfigId`，当前项目甚至未配置该字段。

需要先确认真实业务语义，再决定管理端是支持两个显式 ID，还是业务后台改为统一结构。不能继续依赖数组位置或默认 ID。

### P1：管理系统尚未连接真实 towerSimplify 数据源

当前管理注册仍指向 `tower_dy_codex`、`tower_ks_codex` 两份本地验收库，不是 `D:\xd\newBackend\tower` 实际使用的生产数据库。

正式接入前必须确认：

- 抖音、快手是否独立数据库。
- 每个平台真实 MySQL DSN。
- `t_config.ID`。
- 普通/超级福利记录 ID。
- 主播真实 `configID` 列表。
- 端口和 Redis DB 分配。

### P2：没有独立 canonical Git 仓库

管理源码藏在 cars 的未跟踪目录，部署目录又是旧版本，已经形成双源漂移。任何进一步优化前都应先迁移并建立可审计基线。

### P2：当前服务未运行

2026-08-15 只读检查：

```text
http://127.0.0.1:8120/health -> 无法连接
http://127.0.0.1:8121/health -> 无法连接
http://127.0.0.1:4174/       -> 无法连接
```

浏览器里已有页面可能只是此前加载的静态页面。新任务不要把当前标签页当作服务健康证据。

### P2：本地端口和 Redis DB 可能冲突

cars 与 towerSimplify 的本地示例都默认使用业务端口 `8120` 和 Redis DB `1`。并行运行必须显式分配不同端口和 Redis DB；生产 tower 示例为 `7034/7035` 两实例。

### P2：当前免 Token 配置只适用于本机测试

生产必须恢复：

```text
ADMIN_AUTH_DISABLED=false
ADMIN_API_TOKEN=<至少 32 字符随机值>
前端 authRequired=true 或省略
HTTPS
受限 CORS
```

不得把 token、平台 secret、数据库密码写入项目注册表、源码、URL 或日志。

### P2：管理后端存在高冲突热点和运维缺口

当前主要热点：

```text
backend-admin/src/services/admin-repository.js  约 1623 行
backend-admin/src/routes/admin-v1.js             约 1051 行
```

榜单、补偿、行会、配置和塔防领域混在同一文件，后续适合按 capability/adapter 拆分；但拆分时不得改变补偿幂等、Redis key、事件 payload 或数据库状态迁移语义。

同时存在：

- 前后端分别维护项目注册表，存在 project ID、名称和鉴权配置漂移风险。
- 没有版本化数据库迁移工具，只有综合、幂等的 `schema.sql`。
- 没有正式 Windows service/部署脚本、日志轮转和发布清单。
- `/health` 聚合所有项目，一个依赖故障会返回 503；其他项目接口可能仍可工作。
- 每个项目常驻一个 MySQL pool，连接上限随项目数线性增长。
- Fastify body limit 当前为 1 MiB；现有 204KB 配置可用，但更大配置导入必须加入门禁。
- `D:\xd\admin_codex\README.md` 已过时，仍记录旧的管理表数量，不能作为权威文档。
- 正式前端 `dist/assets` 留有旧哈希资源；后续发布应使用干净构建目录。

### P2：测试通过但跨进程契约缺少持续集成

管理 API 与业务后台共享以下稳定边界：

- MySQL 业务表和管理表结构。
- Redis 队列、dedupe、claim/ACK 和平台 token key。
- 事件 payload 与礼物补偿 event ID。

独立仓库后必须保留跨仓集成测试，不能因为管理代码移出 cars 就只保留 mock repository 单测。

## 9. 推荐的独立仓库迁移顺序

1. 使用已经初始化的 `D:\xd\admin_codex` 独立 Git 工作区，不在 cars 下继续开发。
2. 复制最新 `backend-admin` 暂存源码作为管理 API 基线。
3. 复制最新 `frontend` 暂存源码作为前端基线，保留尚未部署的 JSON 导入功能。
4. 不复制 `node_modules`、`dist`、`.env`、日志或任何业务后台。
5. 保存现有正式部署快照，分别标记“2026-08-08 deployed baseline”和“2026-08-13 import staging baseline”。
6. 执行依赖安装、单测、typecheck、build 和真实 MySQL 定向复现。
7. 建立第一个基线 commit 后，再修复真实 MySQL `LIMIT ?` 问题。
8. 完成 towerSimplify 的恢复、版本、福利和 DSN 契约设计。
9. 通过全部门禁后发布到 `D:\xd\admin_codex`；部署目录只作为发布目标，不再直接开发。
10. 使用 SHA-256 或发布清单验证源与部署一致，并保留可恢复备份。

## 10. 推荐的长期结构

保留“一套管理前端 + 一套管理 API + 多玩法固定数据源”的总体方向。

管理 API 建议使用显式项目类型或 adapter，例如：

```text
generic_live_v1
legacy_tower_v1
```

由 adapter 选择 repository、schema preflight 和能力实现。前端继续只消费服务端返回的 capabilities，不复制玩法页面。这样可以避免在共享 route 中散落数据库表名判断，也避免把 `tower_config` 永久限制成一个无法扩展的特殊分支。

项目注册仍应在服务启动时建立固定连接。不要为了减少重启而允许浏览器动态创建数据库连接；新增项目可以通过受审查的配置文件、schema preflight 和明确重启完成。

不要实现：

- 浏览器提交任意 DSN。
- 请求时动态 `USE database`。
- 项目间复用同一个可变数据库连接。
- 把平台回调或客户端事件拉取重新放进管理 API。
- 浏览器关闭即丢失的补礼定时循环。
- 为兼容旧管理页面继续保留 GET 修改状态、URL token 或浏览器硬编码密钥。

## 11. 验证矩阵

### 管理前端

```powershell
npm ci
npm test
npm run typecheck
npm run build
npm run preview -- --host 127.0.0.1 --port 4174
```

浏览器至少验证：

- `/projects -> /overview -> 详情页`。
- cars 与两个塔防项目能力菜单隔离。
- 真实 204KB compact JSON 导入不自动写库。
- 保存前变更摘要和 CAS 冲突。
- 重新加载/切换玩法时的未保存草稿处理。
- 390px 移动布局无横向溢出。
- console warn/error 为 0。

### 管理 API

```powershell
npm ci
npm run check
npm run test:integration
npm run db:schema
npm start
```

真实依赖至少验证：

- `/health` 分项目报告 MySQL/Redis。
- `listAnchors`、`listRecoveries` 在目标 MySQL 版本下返回 200。
- 主/福利配置 CAS 成功与冲突。
- 项目间数据库、主播和恢复记录隔离。
- 免 Token 只在 loopback + Mock 条件成立。
- 停止/重启 8121 不影响任一业务后台。
- 日志中没有 `level >= 50` 或意外 5xx。

### towerSimplify 业务契约

只有修改共享契约时才需要在 `D:\xd\newBackend\tower` 验证：

```powershell
npm run check
npm run test:integration
```

必须新增真实 MySQL 覆盖：恢复记录读取/消费、配置 Version 更新、两个福利 ID 和旧表迁移。

## 12. 部署与备份

当前管理部署目录：

```text
D:\xd\admin_codex\backend-admin
D:\xd\admin_codex\admin_html_codex
```

历史备份：

```text
D:\xd\admin_codex.pre-tower-20260808-0408
D:\xd\admin_codex.pre-admin-split-20260807
D:\xd\admin_codex.pre-refactor-20260807
D:\xd\backend-codex.pre-recovery-20260808-0408
D:\xd\backend-codex.pre-admin-split-20260807
D:\xd\backend-codex.pre-admin-20260807
D:\xd\backend-codex.pre-ops-20260807
```

不要删除这些备份，直到独立仓库、基线提交、发布流程和恢复演练全部建立。

配置变更不是默认热更新：管理 API 的项目注册在进程启动时加载，修改项目注册需要重启 8121；前端修改需要重新构建和发布 4174。业务后台继续独立运行。

## 13. 可直接用于新任务的启动指令

```text
请在 D:\xd\admin_codex 独立优化统一后台管理系统，不要把任务放在 D:\godot\ideas\cars，也不要修改 cars 游戏客户端、Relay、authority、CAS/WAL/durable 或玩法数值。

先完整阅读：
D:\xd\newBackend\tower\ADMIN_MANAGEMENT_SYSTEM_HANDOFF.md

第一阶段先确认 D:\xd\admin_codex 的 Git 基线，只合并最新 admin_html_codex 和 backend-admin 源码，逐步把实际发布产物与源码工作区分离。保留未部署的塔防 JSON 导入功能，不纳入 node_modules、dist、.env、日志或任何玩法业务后台。

建立基线后，优先修复真实 MySQL 下 tower listAnchors/listRecoveries 的 LIMIT prepared statement 500，并补真实驱动回归测试；随后完成 towerSimplify 的恢复记录消费、配置 Version、普通/超级福利 ID 和真实 DSN/record IDs 契约。所有改动都要通过前端 test/typecheck/build、管理后端 check/integration、真实浏览器和源/部署一致性验证。
```

## 14. 本次独立仓库交接状态

已执行：

- 已在 `D:\xd\admin_codex` 初始化 `main` 分支并绑定 GitHub `origin`。
- 已将 cars 暂存区中 5 个较新的管理前端文件合入 `admin_html_codex`，管理前端 114/114、管理 API 49/49 个非依赖文件与暂存源一致。
- 已把本交接文档复制到 `D:\xd\admin_codex\docs\HANDOFF.md`。
- 合并后前端 49/49 测试、`vue-tsc --noEmit`、管理 API lint 和 78/78 单元测试通过。

未执行：

- 未修改 cars 玩法代码、管理 API 或任一玩法业务后台代码。
- 未修改数据库、Redis、项目注册或 `.env`。
- 未启动、停止或重启 8120、8121、4174。
- 未覆盖正式前端 `dist`，因此尚未部署 JSON 导入功能。
- 未推送 GitHub 远端。
