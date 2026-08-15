# Danmaku Admin Backend

独立的弹幕游戏管理服务。它与直播业务后台使用不同进程和端口，管理代码修改、发布或重启不会中断平台回调、直播事件入队、客户端轮询或结算。

默认监听：`http://127.0.0.1:8121`。

## 架构边界

```text
统一管理 SPA
  -> x-admin-token + x-project-id
  -> 独立 backend-admin :8121
       -> 直播玩法：固定 MySQL pool + 固定 Redis client
       -> 配置型塔防：固定 MySQL pool（不创建 Redis client）

平台回调 / 游戏客户端
  -> 各玩法 backend-business（独立进程，不经过 backend-admin）
```

本服务只注册：

- `GET /health`
- `/admin/v1/*`

它不包含 `/dy/*`、`msg`、`ksmsg`、开播、房间票据、客户端事件拉取、分组上传或结算路由。代码中不使用 `USE database`；每个项目在启动时使用 `mysql2` 的 `database` 参数创建独立连接池。只有需要事件队列或平台令牌的直播玩法才创建独立 `ioredis` 实例。

## 项目注册表

服务从 `config/projects.json` 加载项目。可用 `PROJECTS_CONFIG_PATH` 指向另一个绝对或相对路径。

```json
{
  "projects": [
    {
      "id": "cars",
      "name": "个人赛车乱斗",
      "platform": "dy",
      "database": "normal_codex_next",
      "redisDb": 1,
      "envPrefix": "CARS",
      "configKey": "version1",
      "capabilities": [
        "leaderboards",
        "compensations",
        "guilds",
        "debug",
        "operations"
      ],
      "giftCatalog": [
        { "id": "nitro", "name": "仙女棒", "value": 1 }
      ]
    },
    {
      "id": "tower-dy",
      "name": "塔防（抖音）",
      "platform": "dy",
      "database": "tower_dy_codex",
      "redisDb": 2,
      "envPrefix": "TOWER_DY",
      "configKey": "tower-main",
      "capabilities": ["tower_config"],
      "giftCatalog": [],
      "tower": {
        "mainConfigId": 1,
        "anchorConfigIds": [1]
      }
    }
  ]
}
```

字段含义：

- `id`：稳定的 `x-project-id`，不能复用。
- `database`：该玩法现有业务数据库；相同 MySQL 目标不能被两个项目重复注册。
- `redisDb`：直播玩法使用的 Redis DB；纯 `tower_config` 项目不会创建 Redis 连接，但仍需填写互不重复的显式占位值。
- `envPrefix`：该项目环境变量前缀。
- `configKey`：直播玩法唯一允许读取和 CAS 更新的配置项；纯塔防项目使用固定标签，不参与旧表记录定位。
- `capabilities`：可选值为 `leaderboards`、`compensations`、`guilds`、`debug`、`operations`、`tower_config`。`tower_config` 必须单独使用。
- `giftCatalog`：单笔补礼和 Mock 礼物允许使用的稳定礼物 ID；事故恢复会按历史流水快照补发，不要求旧礼物仍存在于当前目录。
- `tower`：只在 `tower_config` 项目中使用。`mainConfigId`、可选 `welfareConfigId` 与非空 `anchorConfigIds` 必须来自已确认的旧库记录，禁止按数组位置或平台猜测。

## 环境变量

全局配置：

```text
HOST=0.0.0.0
PORT=8121
ADMIN_AUTH_DISABLED=false
ADMIN_API_TOKEN=<至少 32 字符的随机密钥>
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=...
MYSQL_CONNECTION_LIMIT=10
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
EVENT_DEDUPE_TTL_SECONDS=604800
RANK_TIMEZONE_OFFSET_MINUTES=480
```

`envPrefix=CARS` 的项目使用：

```text
CARS_MOCK_MODE=true
CARS_DOUYIN_APP_ID=
CARS_DOUYIN_APP_SECRET=
CARS_KUAISHOU_APP_ID=
CARS_KUAISHOU_APP_SECRET=
```

必要时可用 `CARS_MYSQL_HOST`、`CARS_MYSQL_PORT`、`CARS_MYSQL_USER`、`CARS_MYSQL_PASSWORD`、`CARS_MYSQL_CONNECTION_LIMIT`、`CARS_REDIS_HOST`、`CARS_REDIS_PORT`、`CARS_REDIS_PASSWORD` 覆盖全局连接参数。数据库名和 Redis DB 仍只来自项目注册表，避免环境变量误切项目。

纯塔防项目只需相应前缀的 `MYSQL_*` 可选覆盖与 `<PREFIX>_MOCK_MODE`，不会读取 Redis 或平台密钥。完整示例见 `.env.example`。

平台 access token 继续使用业务后台兼容的 Redis key：

```text
platform:<dy|ks>:<appId>:access-token
```

抖音和快手分别读取 `expires_in` / `expiresIn`。强刷时先成功取得新 token，再覆盖旧缓存；平台请求失败不会删除旧 token。
token 路由中的 `:platform` 必须与当前 `x-project-id` 注册的 `platform` 一致，不能借一个项目的权限读取另一个平台凭据。

## 数据库顺序与所有权

直播玩法必须按以下顺序初始化：

1. 先运行该玩法业务后台的业务 schema，创建十张业务表（包括只记录礼物的 `live_gift_event`）。
2. 再在本目录运行 `npm run db:schema`。

管理服务的 `database/schema.sql` 只拥有五张表：

- `guild`
- `guild_member`
- `gift_compensation`
- `compensation_job`
- `compensation_job_item`

`guild_member.user_id` 外键依赖业务表 `platform_user`；恢复任务的源场次和源礼物分别依赖业务表 `game_round`、`live_gift_event`。配置、榜单、局详情、用户资料和原始礼物流水继续由业务后台拥有；管理服务不会重复创建或迁移它们。

纯 `tower_config` 项目不执行上述管理表 DDL，只校验旧塔防表、所需列和注册表明确指定的配置记录：`t_config`、`t_anchor_info`、`t_config_recover`，以及配置了 `welfareConfigId` 时的 `t_config_welfare`。

`npm run db:schema` 会按项目注册表逐个建立固定数据库连接。直播玩法在任何管理表 DDL 执行前先只读检查十张业务表；纯塔防项目只执行旧表和固定记录校验。任一项目缺失依赖时立即失败，不会留下半套管理表。SQL 可重复执行，不会重置已有行会、补偿审计或塔防配置。

## 鉴权与项目路由

除 `/health` 外，所有接口都必须同时携带：

```text
x-admin-token: <ADMIN_API_TOKEN>
x-project-id: <config/projects.json 中的 id>
```

本地测试可设置 `ADMIN_AUTH_DISABLED=true` 暂时跳过 `x-admin-token`。服务只在以下
条件全部满足时允许启动：`NODE_ENV` 为 `development` 或 `test`、`HOST` 为本机回环
地址、所有注册项目均为 Mock 模式；同时 CORS 只接受本机管理页面。即使免 Token，
`x-project-id` 仍为必填，数据库和 Redis 仍只能从启动时注册的项目 Map 中选择。

`x-project-id` 只用于从启动时构建好的 Map 中选择项目上下文，不参与 SQL 拼接，也不会动态切换已有连接。

`GET /admin/v1/context` 返回所选项目的权威信息：

```json
{
  "code": 200,
  "data": {
    "project_id": "cars",
    "project_name": "个人赛车乱斗",
    "platform": "dy",
    "mock_mode": true,
    "config_key": "version1",
    "capabilities": {
      "leaderboards": true,
      "gift_compensation": true,
      "guilds": true,
      "gift_debug": true,
      "configs": true,
      "platform_tokens": true,
      "tower_config": false
    },
    "gift_catalog": [
      { "id": "nitro", "name": "仙女棒", "value": 1 }
    ]
  },
  "message": "success"
}
```

所有管理响应带 `Cache-Control: no-store`。

## 管理 API

- `GET /admin/v1/context`
- `GET /admin/v1/leaderboards?period=current_week|previous_week&limit=100`
- `GET /admin/v1/users/:userId/rounds?period=current_week|previous_week|all`
- `GET /admin/v1/compensations`
- `POST /admin/v1/compensations`
- `POST /admin/v1/compensations/:eventId/retry`
- `GET /admin/v1/compensation-rounds?anchor_nickname=...&started_from=...&started_to=...`
- `GET /admin/v1/compensation-rounds/:roundDbId/gifts`
- `GET /admin/v1/compensation-jobs?limit=50`
- `POST /admin/v1/compensation-jobs`
- `GET /admin/v1/compensation-jobs/:jobId`
- `POST /admin/v1/compensation-jobs/:jobId/retry`
- `POST /admin/v1/compensation-jobs/:jobId/cancel`
- `GET /admin/v1/guilds`
- `POST /admin/v1/guilds`
- `PATCH /admin/v1/guilds/:guildId`
- `GET /admin/v1/guilds/:guildId/members`
- `PUT /admin/v1/guilds/:guildId/members/:userId`
- `DELETE /admin/v1/guilds/:guildId/members/:userId`
- `GET /admin/v1/configs`
- `PATCH /admin/v1/configs/:configKey`
- `GET /admin/v1/configs/:configKey/revisions`
- `GET /admin/v1/platform-tokens/:platform`
- `POST /admin/v1/platform-tokens/:platform/refresh`
- `POST /admin/v1/debug-events`
- `GET /admin/v1/tower-config`
- `PUT /admin/v1/tower-config/main`
- `PUT /admin/v1/tower-config/welfare`
- `GET /admin/v1/tower-config/anchors`
- `GET /admin/v1/tower-config/recoveries`
- `POST /admin/v1/tower-config/recoveries`

补礼仍采用 `pending -> Redis enqueue -> enqueued|duplicate`，`event_id` 在单个项目数据库内唯一；失败会保留审计记录和原始 payload，retry 不重新解释前端参数。同一个 `event_id` 在不同项目数据库中彼此隔离。

生产补礼量低，因此补礼使用永久 Redis dedupe key；Mock 评论、点赞和礼物仍使用 `EVENT_DEDUPE_TTL_SECONDS`。补礼入队前、失败后和 retry 时都会核对 dedupe key：即使 Redis 已执行原子脚本但响应丢失，任意时间重试也只会收敛到 terminal 状态，不会再次进入礼物队列。数据库更新只允许从 `pending|failed` 进入 terminal，后到的 duplicate 结果不能覆盖已记录的 enqueued。

直播事故恢复使用持久任务，不依赖浏览器页面保持打开：

1. 用主播昵称和 UTC 开播时间范围查找业务库中的房间与场次；结果同时给出该主播最近认证的目标房间。
2. 按 `round_id` 读取原始礼物流水，并补充同房间、`round_id IS NULL` 且发生时间位于该场开始到结算/下一场开始之间的流水。响应同时冻结 `snapshot_max_event_id`。
3. 创建任务时只提交 `user_id + gift_id` 选择和上一步的 `source_snapshot_max_event_id`；服务端在事务中重新读取每条 `id <= snapshot` 的原始礼物，不能信任页面汇总数量，也不会把复核后迟到的新礼物混入任务。
4. 可选择先为每名玩家生成一条代评论落座事件；它保持 `msg_type=1`，但与后续礼物进入同一优先 FIFO，因此严格先于礼物。
5. 单项目、单目标房间只允许一个 `pending|running` 任务。worker 按 500–60000ms 间隔逐条投递，每项使用稳定 event id 和永久 dedupe；进程崩溃后 processing lease 到期会继续，页面关闭不影响。
6. 单项失败会停止任务并保留错误，必须显式 retry；cancel 只取消尚未投递的项目，正在投递的项目按 best-effort 收敛。
7. `payload_hash` 在项目数据库内唯一，因此页面刷新、HTTP 响应丢失或更换浏览器后即使生成了新 `request_id`，同一复核内容仍返回原任务。每条源 `live_gift_event` 也有全局 claim：pending、processing、成功、duplicate 和 failed 都不能被另一批部分重叠地再次补发；只有已确认未发送并被 cancelled 的项目释放 claim。

`POST /admin/v1/compensation-jobs` 的关键字段为：`request_id`、`source_round_id`（数据库主键）、`source_snapshot_max_event_id`、`target_room_id`（平台房间号）、`selections`、`seat_players`、`comment_content`、`interval_ms` 和 `reason`。同一 `request_id` 携带相同规范化 payload 时幂等返回原任务，payload 不同则返回 409；不同 `request_id` 携带相同 payload 也返回已存在的任务。

Mock 入口只支持评论、点赞和注册礼物，仅当项目包含 `debug` capability 且 `<PREFIX>_MOCK_MODE=true` 时开放。生产补礼必须使用补偿接口，不能通过 Mock 绕过审计。

配置使用 version CAS 和 revision 历史。配置保存不是客户端热更新；只影响下一次开播或重连。

塔防主配置和福利配置分别使用原始 JSON 文本 SHA-256 revision 做 CAS。页面只编辑已验证的 compact `ld*/d*` 字段；expanded 结构只读。主播跳关固定写入六个字符串数值字段，并拒绝空值或非数字，避免生成客户端无法消费的未完成记录。

## 启动与验证

```powershell
npm ci
npm run db:schema
npm start
```

仅在本机首次验收两个塔防入口时，可先运行：

```powershell
npm run db:seed:tower-local
```

该命令只允许本机 MySQL，使用两份已留档配置创建 `tower_dy_codex` 与 `tower_ks_codex`，且不会覆盖已有配置行。正式环境不得使用这些本地记录 ID 代替线上确认。

开发自动重启：

```powershell
npm run dev
```

`npm run dev` 是 Node `--watch` 进程重启，不是无中断热替换。

验证：

```powershell
npm run check
npm run test:integration
npm audit --omit=dev
```

单元测试不依赖外部 MySQL/Redis。集成测试会检查全部项目连接、schema、上下文和塔防配置读取；礼物恢复集成用例会写入带随机标识的临时数据，并在结束时逐项清理。
