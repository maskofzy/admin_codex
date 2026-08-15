# 弹幕玩法管理台

单一 Vite + Vue 3 + TypeScript 管理 SPA。前端只连接一套独立管理服务，由该服务根据 `x-project-id` 路由到不同玩法的数据源；不再连接或依赖各玩法的直播业务后台。

## 已包含功能

- 独立 `/projects` 玩法入口；选择玩法后使用 `GET /admin/v1/context` 同时验证 token 和 `project_id`，再进入 `/overview` 功能总览。
- 本周榜单 30 秒轮询、暂停、手动刷新及玩家每局详情。
- 只读的上周 Top100 与玩家每局详情。
- 直播事故礼物恢复：按主播昵称和开播时间定位源房间/roundId，核对最新认证的目标房间，按礼物流水快照选择玩家与礼物，可先代玩家发送落座评论，再由服务端按可配置间隔逐笔补发；包含二次确认、持久任务进度、取消、失败续跑与审计记录。
- 行会、加入码、负责人、成员和停用管理；编辑使用 `version` 乐观锁。
- 仅在服务端声明 Mock 能力时显示礼物、评论和点赞调试。
- 配置 JSON 的 CAS 更新、revision 历史，以及当前玩法平台的 access token 读取和强制刷新。
- 塔防玩法共享配置页：基础参数、关卡/怪物、人数系数、等级经验、福利怪、主播跳关和 0–62 怪物图鉴；compact `ld*`/`d*` 使用 SHA-256 revision 做 CAS 更新。

配置修改不是直播客户端热更新。保存后只影响下一次开播或重新连接；已运行客户端需要重新执行开播或恢复流程。

## 本地运行

要求 Node.js 22.13 或更高版本。

```powershell
npm ci
npm run dev
```

质量检查：

```powershell
npm test
npm run typecheck
npm run build
```

默认管理服务地址为 `http://127.0.0.1:8121`。后端必须允许管理台来源的 CORS 请求，并允许 `x-admin-token`、`x-project-id`、`content-type` 请求头及 GET/POST/PUT/PATCH/DELETE 方法。

路由使用 hash history（例如 `/#/guilds`），Vite 资源基址为相对路径，`projects.json` 也跟随当前静态基址。因此整个 `dist` 可挂载到任意子目录，刷新详情页不依赖服务器 SPA rewrite。

## 玩法注册表

`public/projects.json` 在构建产物中保持为独立静态文件，可在部署时修改：

```json
{
  "apiBase": "http://127.0.0.1:8121",
  "projects": [
    { "id": "cars", "name": "个人赛车乱斗", "authRequired": false },
    { "id": "tower-dy", "name": "塔防（抖音）", "authRequired": false },
    { "id": "tower-ks", "name": "塔防（快手）", "authRequired": false }
  ]
}
```

- `apiBase` 是唯一的独立管理服务地址，不按玩法重复配置。
- `projects` 只包含登录前需要展示的稳定玩法 `id`、名称和可选鉴权开关，不包含平台、数据库、能力、礼物、密钥或业务后台地址。
- `authRequired` 省略时默认为 `true`。只有测试环境明确写为 `false` 时才允许无 Token；无论项目数量多少，都必须先在 `/projects` 显式选择玩法。
- 新增玩法只需在管理服务和本注册表中增加同一 `id`，不需要复制页面或 API client。
- `apiBase` 不得包含用户名、密码、查询参数或 URL 片段。
- 只有 `localhost`、`127.0.0.1` 和 `::1` 可使用 HTTP；任何远程地址必须使用 HTTPS，避免管理员 token 明文传输。

## 服务端权威上下文

登录时前端携带所选玩法的 `x-project-id` 请求；要求鉴权的项目还会携带 `x-admin-token`：

```text
GET /admin/v1/context
```

服务端返回并权威决定：

- `project_id`、`project_name`
- `platform`
- `mock_mode`
- `config_key`
- `capabilities`
- `gift_catalog`

前端只校验返回的 `project_id` 必须与所选玩法一致；平台、默认配置键、页面权限和礼物目录均不从静态注册表推断。上下文结构不完整或礼物目录非法时，登录会在保存 token 前失败。

此后每个管理请求（包括 Mock 调试事件）都会发送项目标识；要求鉴权的项目同时发送 Token：

```text
x-project-id: <当前已验证的玩法 id>
x-admin-token: <仅 authRequired=true 时发送>
```

项目 id 和 token 不进入 URL。

## 安全边界

- 管理员 token 仅保存在当前标签页的 `sessionStorage`，关闭标签页后自动清除。
- `authRequired:false` 不是前端安全边界；独立管理服务必须对同一测试项目明确允许免 Token，生产配置应省略该字段或保持 `true`。
- 登录只有在管理服务返回相同 `project_id` 后才保存会话。
- token 不进入源码、URL、日志或玩法注册表。
- access token 只保存在运维页面的组件内存中，默认遮挡，离开页面即释放。
- 所有写操作使用 POST/PUT/PATCH/DELETE；没有通过 GET 修改状态的旧接口。
- 生产恢复页不提供任意评论或点赞注入；落座评论只能作为已选源场次玩家的恢复任务前置项，并与礼物恢复一起审计。
- 新任务依赖稳定 `request_id` 幂等，服务端为每个落座/原始礼物事件生成确定性 `event_id`；请求结果不确定时必须复用原 `request_id`，失败续跑不会重放已成功项。
- 礼物选择由 `source_snapshot_max_event_id` 冻结；任务不会吸收操作者加载页面之后才到达的礼物流水。目标房间的最近认证时间只作为核对依据，操作者仍须确认客户端当前连接房间。
- 批量恢复的间隔调度和进度保存在管理服务端。浏览器只提交一次任务并轮询状态，关闭或刷新页面不会停止已经创建的任务。
- 取消会终止等待项；已经进入 processing 的当前项无法撤回，最多仍可能再发送 1 项。

## Canonical 管理接口

- `GET /admin/v1/context`
- `GET /admin/v1/leaderboards`
- `GET /admin/v1/users/:userId/rounds`
- `GET /admin/v1/compensation-rounds`
- `GET /admin/v1/compensation-rounds/:roundDbId/gifts`
- `GET|POST /admin/v1/compensation-jobs`
- `GET /admin/v1/compensation-jobs/:jobId`
- `POST /admin/v1/compensation-jobs/:jobId/retry`
- `POST /admin/v1/compensation-jobs/:jobId/cancel`
- `GET|POST /admin/v1/guilds`、`PATCH /admin/v1/guilds/:guildId`
- `GET|PUT|DELETE /admin/v1/guilds/:guildId/members/:userId`
- `GET /admin/v1/configs`、`PATCH /admin/v1/configs/:configKey` 与 revision 查询
- `GET /admin/v1/platform-tokens/:platform`
- `POST /admin/v1/platform-tokens/:platform/refresh`
- 塔防：`GET /admin/v1/tower-config`
- 塔防：`PUT /admin/v1/tower-config/main`、`PUT /admin/v1/tower-config/welfare`，请求携带各自 `expected_revision`
- 塔防：`GET /admin/v1/tower-config/anchors`、`GET|POST /admin/v1/tower-config/recoveries`
- Mock 环境：`POST /admin/v1/debug-events`

管理台不调用旧 `/dy/getConfig`、`/dy/updateConfig` 或通过 GET 强刷 token 的接口。

塔防页面只对已验证的 compact `monsterConfig[].ld1/ld2/ld3/ld4[].d1..d22`、人数系数、等级经验、福利怪和主播恢复字段提供编辑。保存时从完整原 JSON 克隆后只覆盖这些已知字段，未知字段及历史数字/数字字符串类型保持不变。若服务端返回 expanded `levels`/`monsters` 结构，页面会展示原 JSON 和只读警告并禁止保存；两种结构尚无可靠等价映射，前端不会猜测转换或覆盖。

塔防主配置支持从本地 `.json` 文件导入未保存草稿，既接受 compact 主配置裸对象，也接受 `{ "config": { ... } }` 包装。导入不会自动写入数据库；确认页面内容后仍需点击“保存主配置”，并使用当前服务端 revision 做 CAS 更新。福利配置保持独立记录和独立保存，不会被主配置文件覆盖。

主配置与福利配置分别保存并只刷新自己的 revision，不会清掉另一侧未保存草稿。主播跳关沿用客户端已验证的六字段字符串结构；基地当前/最大血量必须填写，全部字段必须是数值文本，空记录不会写入数据库。

## 目录

```text
public/projects.json       唯一管理服务地址和玩法展示列表
src/services/api.ts       统一响应、双请求头、错误与查询处理
src/services/projects.ts  注册表与服务端 context 校验
src/services/session.ts   当前标签页管理员会话
src/router/               `/projects`、功能页 hash 路由与服务端能力守卫
src/layouts/              共享管理台外壳
src/components/           loading/error/empty、确认框、用户展示
src/views/                各功能页与详情页
```
