# 图片能力与调试玩法接入配置

状态：2026-09-24 已发布，证据见 [历史交接第39节](../../docs/archive/HANDOFF-2026-10-16.md)。下方验证与发布步骤为当时记录，不能当成尚待执行任务；当前运行状态见 [部署说明](../../docs/DEPLOYMENT.md)。
权威源码已按校验后的最小差异合入 D:/xd/admin_codex/backend-admin，保留原有其他脏改动。

## 接口契约
- 注册 capabilities 数组支持 images，默认未包含即关闭；context.capabilities.images 始终 boolean。
- 图片GET /admin/v1/images、POST /admin/v1/images/upload、DELETE /admin/v1/images/:name路径不变。
- 只有所选项目显式images=true并有服务端独立目标时可访问，无PersonCar fallback。
- 启用但未配置独立目标，保存注册配置400，message=images_target_unavailable: <id>。
- 受审查目标由 IMAGES_TARGETS_CONFIG_PATH 指向独立JSON，不能在浏览器注册表里配置URL/密钥。
  示例 {"PersonCar":{"url":"http://127.0.0.1:7005","publicOrigin":"https://pintu.quickdoing.com","tokenEnv":"PERSONCAR_IMAGES_API_TOKEN"}}。
  测试URL使用本机8972，publicOrigin保留测试原值；生产用本机7005。目标凭据沿用现有服务端token变量。
- 调试配置GET/PUT /admin/v1/test-debug/:testProjectId/project-registry。
  data:{revision,projects:[唯一项目],gift_catalogs:{目标平台:gift[]}}；PUT:{expected_revision,projects:[唯一项目]}。
- 调试补偿目录GET/PUT /admin/v1/test-debug/:testProjectId/supply-gifts。
  GET data:{revision,project_id,gifts}；PUT:{expected_revision,gifts}。
- 不允许额外项目、改id、adapter/database/redisDb/envPrefix重绑定；最终解析后必须仍是Mock项目。
- 固定代理只到testll.quickdoing.com:8122。受限接收端 /internal/admin/test-projects/:id/... 使用独立 TEST_REGISTRY_API_TOKEN。
  独立token不可等于admin或既有debug token，不能访问完整注册表。生产服务没有把测试注册信息转发给生产注册表的路径。
- 允许测试目标固定为PersonCar/gooseAndDog/newTrick/toyBattle（toyBattle 于 2026-10-07 接入）。礼物目录仍按原legacy_t_v1限制。
- 全表、单条保存共享锁/CAS；冲突409，不自动重试覆盖。
- 保存注册表仍返回 restart_required:true，不热加载或自动重启；后续已提供显式网页重启接口，见当前交接。

## 验证
- 权威源码 npm run check：137/137。
- 新契约定向测试：生产9/9、测试9/9、sgtower3/3；三个候选src/test/scripts lint均通过。
- 本机隔离MySQL临时库+Redis专用key+SQLite补偿链路集成：1/1；未使用线上业务库。
- 借用最新仓库全套旧测试对较老线上分支检查时，测试分支有4项、sgtower有13项历史不匹配。
  用只读服务器原始文件重建基线运行，失败测试名称完全相同，无本轮新增失败。
  主要是旧分支没有新版debug-preview/mock-users、MySQL flags和持久补偿模块；不借机升级这些无关功能。
- 不把上述旧分支全套借用测试声称为全绿；精准契约和基线对比证据见 *-contract-check.log、*-baseline-check.log。

## 历史协调发布步骤（已执行，禁止直接重跑）
1. 与网页任务锁定窗口；重新读取所有current和源文件SHA，按*-changes.json逐文件校验，不覆盖漂移。
2. 每个受影响管理服务核对补偿任务：持久化worker使用SQLite只读查询queued/running，以及运行item/worker状态；有任务则等待，不取消、不强停。
   不能只检查最近100条API列表；需覆盖完整队列。旧服务如没有持久worker先核实实际进程/代码，不假装已有接口。
3. 备份各服务原API、.env与projects配置、受审查目标映射；只读记录业务PID/启动时间与图库SHA。
   不备份回滚SQLite业务状态、不重置补偿状态。
4. 测试API先发布候选最小文件差异：配置专用scoped token与PersonCar独立映射，注册PersonCar显式images；其他项目关闭。
   原测试服务端 token 保留，新增独立token只用于固定生产代理；不触碰PersonCar玩法API、图片目录或数据库。
5. 100.6管理API发布prod差异并配置同一scoped token与生产PersonCar映射/显式能力；当前静态web完整保留。
   100.8管理API只发布sgtower差异；无受审查图库目标，context.images=false、不能启用。
6. 仅在补偿队列空闲时重启对应独立管理API，逐台检查health、context字段类型、权限、图片只读、固定代理目标。
   网络联调写配置仅在单独临时测试文件/候选进程进行，不为验证覆盖生产或真实测试注册表。
7. 验证三API契约可用后通知网页任务发布静态；扫码/浏览器验收由网页任务完成。
8. 日志检查level>=50、HTTP5xx、健康与业务PID不变。保留旧API/配置可回滚，绝不回退SQLite、图库或业务库。

## 锁文件说明
写配置短事务使用<config>.lock；正常异常路径会释放。进程崩溃留下锁时先核实无写进程和配置完整，再由运维处理；不自动抢占可能仍活跃的锁。
