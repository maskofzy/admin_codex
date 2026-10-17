# 统一后台管理系统交接

更新：2026-10-17。本文只维护当前状态、关键契约和未完成事项；历史证据按需查阅，不再逐次追加发布流水。

## 工作区与 Git

- 唯一管理源码工作区：`D:\xd\admin_codex`；前端 `admin_html_codex/`，独立 API `backend-admin/`。
- origin：`https://github.com/maskofzy/admin_codex.git`。2026-10-17 已替换旧 `adminManagement.git`；已按用户要求推送 main，初始基线及文档整理提交 `d3ad83b` 已上传，main 跟踪 origin/main。
- 本地已有基线 `e0abc99`（`chore: establish admin management baseline`）；截至本次整理，后续功能仍有大量未提交修改和新增文件。建了远端不等于这些内容已进 Git，不能据此删除源码副本或回滚材料。
- cars 下的 `.codex-admin-split` 不再作为管理源码来源；不要按旧迁移步骤重新覆盖本工作区。
- 开始任务先完整读本文，再运行 `git status --short`、`git log -5 --oneline`。已有修改属于原任务，不能重置或混入无关提交。未经明确要求不推送远端。
- 原交接全文已逐字节归档至 [历史交接](archive/HANDOFF-2026-10-16.md)。其中“尚未发布”、旧 PID、旧回滚目录均为当时记录，不代表当前状态。

## 工程与安全边界

- Do not preserve backward compatibility.
- Choose the simplest implementation that fully meets the current requirements.
- Prefer established, well-maintained libraries over custom implementations.
- Make architectural decisions for the long term. Do not accept a stopgap that only works for now and is meant to be replaced later.

管理前后端同仓演进。管理 API 与玩法业务后台保持独立进程、发布、重启；平台回调、客户端拉取、开播及 UE 接口属于业务后台。未经明确要求不修改 `D:\xd\backend-codex`、`D:\xd\newBackend\tower` 或 cars 游戏客户端/Relay/authority/CAS/WAL/durable/数值。

- 浏览器只选择固定 project ID；数据库和 Redis 连接从服务端受审查注册表在启动时创建，禁止浏览器 DSN、动态 `USE database`、项目间共享可变连接。
- 免 Token 仅限 development/test + loopback + 所有项目 Mock。生产强鉴权、HTTPS API、受限 CORS；凭据不写源码、URL、静态配置或日志。
- 不提交 `.env`、密钥、Token、数据库密码、用户目录、依赖、构建产物、运行日志或 SQLite/WAL。
- 不通过回退 SQLite、删除审计记录或新 request_id 重放已发送补偿。

## 当前架构与配置

Vue 3 管理台 → 已配置的独立 Fastify 管理 API → 每项目固定 MySQL pool / Redis。前端公开 `projects.json` 配置 services、共享登录与测试入口映射；实际已注册玩法由 API `/admin/v1/projects` 返回，不再维护前后端两套玩法清单。

- 当前仍同时存在 `generic_live_v1` 与 `legacy_t_v1`，不要误报通用适配器已移除。旧玩法直接访问原 `t_*` 表，不要求复制成通用业务表。
- 本地示例注册为 cars / tower-dy / tower-ks；前端默认 `http://127.0.0.1:8121`。这些不是生产配置，禁止直接覆盖部署侧配置。
- 注册表和礼物目录以 revision/CAS 保存。连接、能力变更需重启对应管理 API；名称显示和礼物目录可即时读取。图片目标由服务端 `IMAGES_TARGETS_CONFIG_PATH` 固定映射，默认关闭，不允许前端提供任意上游。
- 网页重启接口仅重启当前管理 API，检查 revision、依赖和在途任务，退出后由 supervisor 恢复；确认新的 instance_id 和健康后才算成功。没有任意命令或业务进程重启入口。
- 生产登录使用统一管理员 Token，仅向公开配置中允许 sharedToken 的服务传递；本地保存按 API Base 隔离。测试 Token 留在服务端代理，不发给浏览器。
- 测试代理固定目标：PersonCar / gooseAndDog / newTrick / toyBattle。pending 玩法请求经同 service 的 PersonCar 身份鉴权，URL 保留实际目标，不改变当前生产会话。生产项目访问测试目标仍受服务端授权约束。

## 必须保留的数据契约

### 补偿与调试

- 补偿按主播搜索并选择精确 openUID 后查场次，列表仅列有有效礼物的场次；最多选 50 场，同主播同玩家跨场汇总，不同主播隔离。
- 场次结束优先 endTime → 同房下一场 → 同主播下一不同房的首场 → 当前北京时间；已取消六小时兜底。无真实结束边界的列表显示“未知”，勾选时通过 `/dy/getCompensationRound` 冻结服务端截止点。
- 同 roomid 精确匹配、时间半开区间 `[start,end)`；旧业务 DATETIME 是北京时间，管理连接 UTC，不得直接用 `NOW()` 替代北京时间表达式。
- 最终任务 POST 使用顶层 players，rounds 仅作来源证据。允许编辑启用礼物和数量；服务端重新核验来源身份/目标，SQLite 持久执行。页面进度明细只存本页内存，刷新不恢复明细；提交前仍检查后台活动任务以防重复。
- “已入队”不等于游戏已消费；未知发送结果停止并人工核对，不自动重发。评论/礼物只重投 Redis，不再次写业务 `t_msg_info`。
- `replayMode` 显式选择 `legacy_hash`（`roomid_<roomid>_gift|other`）或 `event_store`（FIFO/dedupe/claim/ACK），禁止双写。
- 礼物平台 ID/内部档位/价值以各玩法受审查配置为准，不能套用其他玩法。dycow 的事件 value 保持原业务目录抖币价的 10 倍。
- 调试六类动作共用真实事件契约；count 为字符串，无 source。网页本地预览需与服务端及真实消费者比对，预览本身不发送。

### 配置、榜单、行会与流水

- 塔防配置主表保存递增数字 Version，福利固定 ID 1/2；compact JSON 导入只形成未保存草稿，未知字段/number-string 类型保留，expanded 结构只读。
- 旧表当前榜读取 `t_user_info` 最新数值排序的 turn，上期榜读取 `t_last_top`；没有快照赛季证据时不猜上一期 turn。流水赛季仅使用明确配置的 `SCORE_SEASON_FIELD`，不按时间推测。
- 行会读写 `t_team_info` 与 `t_user_info_unique`，`joinID=team`、teamDuty 自由文本；删除事务先解除成员 team=-1，再删行会，保留其他玩家字段。列表及成员服务端分页/搜索。
- 原 `#/projects` 保留卡片；独立 `#/revenue` 仅直链访问，不添加菜单入口。跨服务以 service+ID 隔离，支持单玩法刷新；标题进入按日流水详情。
- 日流水按北京时间当天半开区间聚合 live_gift 的 gift_value/100，按精确房间汇总后关联最新房间/主播记录，避免重复行放大。详情保留费率%、流水，不展示服务费金额和三方拆分；公会/主播/房间按流水递减。
- sl2 月度奖励、亲密度备份、权益为独立操作，共用命名锁/事务/审计幂等；修改已发权益只更新原两条记录。自动起始月固定 `2026-09-01`，禁止前移或补发更早月份。
- sl2 自动月末 23:58 备份/权益、次月 1 日 00:00 月榜奖励，停机后追补。相邻月补算用累计差值和严格期初基准（9 月为已确认 copy13）；缺基准/跨多个未知月/归属变化等拒绝盲算。手动发放仅月末当月或月初上月，备份/已发权益修改不受该窗口限制。

## 最近确认的部署

详见 [部署与回退](DEPLOYMENT.md)。以下为历史发布证据归纳，2026-10-17 仅整理本地文档和 Git remote，未重新巡检线上。

- 最新静态发布：2026-10-16 `blue-wand-20261016`；Windows 根/test 共 184 文件，pintu 92 文件，发布时逐 SHA、公网 200/no-store 通过。
- 两生产 API 最新公共功能：2026-10-15 日流水与单玩法刷新；100.8 同日新增 dycow。部署 API 存在环境差异，不能拿本地整包无核对覆盖。
- newTrick 最终礼物为蓝色和绿色仙女棒（gift_id 8/9，各 value=1），黄色变更已撤回；测试目录共 10 项。toyBattle 保留独立 11 项目录。
- 最近记录的全量验证：前端 207 项 + typecheck/build（10-16）；API 158 项 + 真实依赖集成 8 项（10-15）。这些不是本次重新执行结果。

## 尚未完成与后续优先项

1. Git：审查、验证并建立后续功能提交，再按用户明确指令推送；远端已含初始基线和整理文档，但尚未包含工作区后续功能，不能作为当前完整源码备份。旧源码/部署快照清理还需发布清单与恢复能力核对，不能仅凭仓库存在删除。
2. 真实浏览器验收：近期工具反复超时，未完成最终桌面/390px/console、补偿场次点击、流水及 pending 调试切换验收；API/组件/静态 SHA 不替代浏览器验证。
3. 部署基线：三个运行 API 历史上定点合入不同功能；下一次发布先核对实际源码/清单，再决定差异，不直接整包覆盖。长期需建立可重复的版本化发布与恢复流程。
4. 通用适配器整体移除尚未完成，应单独评估并实施，文档整理不等于代码已删除。
5. 塔防恢复消费闭环：旧记录指出新 tower `startRoomV2` 未消费恢复表，尚无后续闭环证据；业务仓库不在本任务范围。dysgtower 生产缺 t_room_round/t_topgift_group，自动场次查询保持明确 409，手动直补可用。
6. 塔防 JSON 导入仍缺结构化变更摘要、离开草稿提醒、完整导出包约定及真实大文件浏览器验收；当前导入会把 Remark 改为“导入 文件名”。配置 Version 的真实客户端热更新闭环也需核对。
7. Windows 静态入口仍为 HTTP；API HTTPS 不消除入口页面被篡改的风险。证书到期与换证位置见部署文档。

## 验证与文档维护

前端在 `admin_html_codex` 运行 `npm test`、`npm run typecheck`、`npm run build`；API 在 `backend-admin` 运行 `npm run check`、`npm run test:integration`。Node 要求见各 package.json，API 当前 >=22.13.0。

- 页面修改必须真实浏览器验证；共享 MySQL/Redis/事件/补偿/token key 契约修改必须真实依赖及跨进程集成测试。使用独立随机 schema/房间并精确清理，不向真实房间投递验收事件。
- 跨进程 EventStore 测试依赖外部业务模块，可通过 `BUSINESS_EVENT_STORE_PATH` 指定；不可改成 mock 代替真实消费者。
- 日志检查同时覆盖结构化 `level >= 50` 和意外 HTTP 5xx，不只看 `.err.log`。发布核对文件 SHA、健康/权限、业务 PID 未变及完整补偿队列。
- `db:schema` 是数据写入，不是通用验证步骤；只在审查目标 adapter/schema 后明确执行，禁止把旧 tower.sql 当初始化脚本。
- 后续直接更新本文对应当前状态；源码变更原因和验证放 Git 提交，发布清单按版本留存并从 DEPLOYMENT 引用。不要再次追加重复的命令过程、PID、过时状态或每次完整测试流水。
