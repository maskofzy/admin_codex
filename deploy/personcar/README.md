# PersonCar 独立生产管理服务（历史部署记录）

> 本文记录 2026-09 的部署过程，不代表当前 release。当前路径、项目范围与回退规则见 [部署说明](../../docs/DEPLOYMENT.md)，后续不再向本文追加流水。

2026-09-22 部署到 192.168.100.6，不依赖 192.168.100.8。

- 页面：https://pintu.quickdoing.com/admin/
- API：https://pintu.quickdoing.com/common-admin-api
- 固定数据库：192.168.100.7:3306/personcar；MySQL flags=-CLIENT_QUERY_ATTRIBUTES。
- 固定 Redis：127.0.0.1:6379/2；直接本机连接，无 SSH 隧道。
- 项目：PersonCar，Mock=false，榜单与补偿，event_store；6 个生产表礼物映射，默认分成展示比例 8%。
- 独立服务：common-admin-personcar.service，启用开机自启，仅监听 127.0.0.1:7009。
- 独立进程账户：common-admin；独立 Node /home/commonAdmin/runtime/node，v22.23.2。
- Node SHA-256：e05c383ab2589f46e5c79d148e170d4ef83c8ecc50af460514e5cbf4922f8441。
- current：/home/commonAdmin/releases/20260924-newtrick；api/ 为独立管理 API，web/ 是统一登录静态站。
- 运行配置：/home/commonAdmin/shared/.env、projects.json、supply-gifts.json；shared 0700，凭据文件 0600，禁止提交。
- 生产管理员 Token 已按用户要求统一为 100.8 现有生产 Token，保存在 shared/admin-token.txt；本机交付副本为 C:\Users\Administrator\.codex\private-personcar-production\admin-token.txt（仅 Administrator/SYSTEM）。不复用测试 Token。
- CORS 精确允许 https://pintu.quickdoing.com 和 http://43.143.79.195:86。
- 包：/home/commonAdmin/releases/20260922-personcar.tar.gz，SHA-256 be0e16b88e51b099c48567a75374d8bcb6a7a3120a7a95e925e4f0eabde8c81e。
- source-manifest.json 记录 107 个发布文件 SHA-256（27 个 API src、package/lock、78 个静态文件）；服务器逐文件核对通过。

## 运行

```sh
systemctl status common-admin-personcar.service
systemctl restart common-admin-personcar.service
journalctl -u common-admin-personcar.service --no-pager -o cat
curl -fsS https://pintu.quickdoing.com/common-admin-api/health
```

不运行 PersonCar 的 PM2 来管理本服务，不重启或修改业务 7005/7006、Redis、旧 /home/backend-admin。

Nginx /etc/nginx/conf.d/pintu.conf 新增精确管理路径；业务 location / 和 upstream 均保持不变。片段源码见 nginx-admin-location.conf，修改后必须 nginx -t 再平滑 reload。静态资源返回 no-store，管理页及 API 均为 HTTPS。

## 验证

- 本地后端 ESLint、113 项单元测试、3 项真实 MySQL 集成测试通过；前端 92 项测试、typecheck/build 通过。
- 真实 100.7 prepared query、schema、总览、榜单、场次/礼物查询、Redis PING 全部通过。
- 公网 health/projects/context/overview/榜单 200；未登录 401，其他项目 404，Mock 调试 403；CORS 精确匹配。
- 首页、projects.json、入口 JS/CSS 的 HTTPS 内容 SHA 与清单相同，no-store 生效。
- 6 个礼物与 1 个评论经管理 HTTPS -> 独立随机 Redis 房间 -> 独立的真实业务 EventStore 进程 -> ACK，全量 payload 相等。未向真实房间投递，未写 SQL，精确清理测试房间键。证据 backups/verification.json。
- 独立重启管理服务后健康通过，业务 PID 始终 14153/13903。检查业务健康时先有 10 秒公网及 6 秒 7006 超时，后续 7005/7006 和公网均恢复 200；没有修改或重启业务服务，暂未定位瞬时超时原因。
- 管理 journald 首次审计 49 条结构化记录，level>=50=0、HTTP5xx=0。证据 backups/log-audit.json。
- 内置浏览器超时；Windows Computer Use 随后因不能可靠识别当前浏览器 URL 而停止。未完成真实页面登录、390px 和 console 验收，接口验证不替代该项。

## 统一生产入口

Windows 网页由任务“部署网页端到新服务器”发布；两处共用同一前端构建。Windows 配置 PersonCar 和原三项目服务，pintu 只配置 PersonCar，避免依赖 100.8 的 CORS 或可用性。管理员只输入一次生产 Token，验证通过后显示首页；礼物调试由 100.6 固定代理转发测试地址，不需要测试登录。旧导航片段 production-navigation.html 不再发布。

## 回滚

这是新加的管理服务。撤销时先确认 Nginx 文件没有后续修改，再恢复 /home/commonAdmin/backups/pintu.conf.before-admin，nginx -t 后 reload，只停止/禁用 common-admin-personcar.service。保留 release/shared/backups 以便恢复。不要回退业务源码、删除业务数据、关闭 Redis 或停止业务进程。

100.8 上上一方案未激活；其 runtime/shared 三份配置与原备份逐字节一致。仅清理本任务未使用的 PersonCar 中间凭据、candidate.env 和 SSH 隧道密钥，原候选目录标记 SUPERSEDED，不能再发布。

## 测试调试代理（2026-09-22 后续发布）

用户要求礼物调试不再单独验证测试Token。当前 API release 为 `/home/commonAdmin/releases/20260922-test-debug-proxy`，复制上一已验证版本后仅修改 app.js/config.js 并增加 routes/test-debug.js，静态站已同步统一前端 r2。测试Token只保存在shared/.env的 TEST_DEBUG_API_TOKEN，不能与生产Token相同；未改旧生产Mock能力或测试CORS。

仅生产PersonCar登录可访问 `/admin/v1/test-debug/{PersonCar|gooseAndDog|newTrick}/{context|users|events}`；GET context/users、POST events。固定测试HTTPS地址、白名单项目/路由、每次校验测试Mock/debug/identity、8秒超时、不跟随重定向、不重试事件。前端无须测试Token。

备份 `/home/commonAdmin/backups/test-debug-proxy-20260922` 含 original.env/candidate.env（0600）、预检及公网验证证据。只重启独立管理服务，业务PID保持14153/13903；公网两项目context/users均200，各8礼物、80模拟玩家、10主播，未登录/测试Token作为生产认证401、错误项目/路径404、原生产debug-users403、原生产context Mock=false/gift_debug=false，health200。后端118测试、ESLint、真实MySQL集成3项通过。跨进程事件验收已由 Windows 网页部署任务完成：两项目各 10 种动作经生产代理到测试业务 HTTP /dy/getHash，完整 envelope 与前端预览一致；重复事件 accepted=0/duplicates=1，随机房间测试键精确清理，不写 SQL。

回滚先确认无后续发布，再将current恢复到 `/home/commonAdmin/releases/20260922-personcar`、恢复备份original.env并保持common-admin所有权/0600，仅重启common-admin-personcar.service。前端若已更新代理功能，应同步回退网页或去掉对应测试调试配置，不能把代理错误改成生产调试直发。

## 统一登录 r2 发布

前端 98 项测试、typecheck/build 通过。源 ZIP SHA-256 a5ed63260718b1058d4414044b04bc5b726308e3f5f145a153bb0926e228c7ed，78 个静态文件；pintu 仅定制 projects.json，保留 sharedToken:true 和两测试调试项目。备份和验证证据在 /home/commonAdmin/backups/unified-web-20260922-r2。纯静态发布未重启 API 或业务。

生产 Token 统一前备份在 /home/commonAdmin/backups/unified-production-token-20260922；只重启独立管理服务，同一 Token 对 PersonCar 和 dysgtower context 均 200，旧 PersonCar Token 返回 401，测试代理继续 200。测试凭据未改，100.8 未修改。不要恢复旧 .env 来单独回滚静态页面；静态回滚仅切换 current 到上一已验证版本。

## gooseAndDog 待部署项目入口

2026-09-22 仅更新网页至 /home/commonAdmin/releases/20260922-goose-entry，API 固定复用上一已验证版本，没有重启管理或业务服务。生产地址为空的 gooseAndDog 显示独立卡片并标记未部署，不创建生产会话、不请求其生产数据；调试按钮直达 /debug?project=gooseAndDog，经既有测试代理访问测试环境。配置保留 sharedToken:true，pintu 仅首个 service，pendingProjects 与 testDebugProjects 同 ID 匹配。

源 ZIP SHA-256 c641f3b71b7caf5235e7cadc48172563296ed8abe3748501054391414e42e737，78 文件；前端 103 测试、typecheck/build 通过。部署和公网 SHA/no-store/健康验证证据在 /home/commonAdmin/backups/goose-entry-20260922。静态回退仅将 current 恢复为 20260922-unified-web-r2，不恢复旧凭据或操作业务服务。浏览器视觉验收仍未完成。

## 多场按玩家汇总补偿（2026-09-22）

- 100.6 API /home/commonAdmin/releases/20260922-compensation-jobs/api；最终current为 /home/commonAdmin/releases/20260922-compensation-players，其api为前述固定链接、web为新114项测试通过的前端。100.8 current为 /home/commonAdmin/releases/20260922-compensation-jobs（API直接在根目录）。各从自己既有release复制，仅本次6个源文件差异，无其他未发布开发功能混入。
- 两主机shared/.env仅增加 LEGACY_COMPENSATION_PATH=/home/commonAdmin/shared/legacy-compensation.sqlite；数据库及WAL属于管理服务，持久放shared，不能随着网页或API回滚删除。Token/项目注册/礼物目录未变，未写业务SQL或向生产房间发送验收事件；只重启独立管理服务，业务PID未变。
- 源场次区间改[start,end)，重新核对来源礼物后按同主播/目标房间/玩家合并礼物。同玩家占座评论仅一次，跨场冲突拒绝。POST持久批次、GET列表/详情、POST取消；完整接口与故障语义见backend-admin/README.md。发送前持久化、未知结果停止不自动重发，专用Redis连接禁止自动重发/离线排队；已入队不等于客户端已消费。
- API备份与证据两机均为 /home/commonAdmin/backups/compensation-jobs-20260922，含original.env/candidate.env、deployment.json、preflight.json、public-validation.json、log-audit.json。SQLite文件0600，目录受限。Node22.23.2内置SQLite已实测；其experimental警告为已知运行时提示。
- 后端最终127单测、ESLint、4真实集成通过；独立随机本机MySQL schema证实边界2+3=5不重不漏，真实Redis→独立现有业务EventStore进程消费/ACK与payload一致，且验证Hash传输。没有修改玩法源码；schema和精确Redis键均清理。
- PersonCar/dysjz/dycad的真实生产只读源场次及礼物SQL通过。dysgtower既有库缺t_room_round/t_topgift_group，场次补偿仍明确409，仅原手动直补可用，不创建业务表。全部四项目context/overview/jobs读取、health、未登录401通过。
- 静态包 compensation-players-20260922.zip SHA-256 86dd5b82305ec70fb3a46b6d6654b7e08d2a62018c72c6ccbb111309dba5cc6e；78文件及公网SHA/no-store通过。pintu配置SHA66d97968c3da940fe94239a31cfacb063b75a3fadbe29f29635c6868843cbdb9不变。静态证据 /home/commonAdmin/backups/compensation-players-20260922。
- 首次发布验证用ps按进程名匹配未识别部分PM2进程，触发管理API自动回退；改用/proc和业务启动时间核对后重新发布成功，无业务重启或数据写入。日志最终审计见上述log-audit.json，level>=50与HTTP5xx均0。真实浏览器视觉验收仍待完成。

回滚须先停止接收新批次并检查现有任务，取消/等待活动任务，协调先回退依赖新接口的两处网页。100.6原current=20260922-goose-entry，100.8原current=20260816-152236；仅切回管理release并重启对应管理服务。可保留新增SQLite环境项和全部持久任务数据，不能通过删除SQLite清除未完成/不确定发送记录，也不能重新投递旧任务。只回退静态时保留新API，100.6可使用20260922-compensation-jobs的原web。

## 可编辑补偿礼物与数量（2026-09-22）

本节覆盖上一版按源流水限制补偿数量的请求契约。顶层 players 提交每主播+玩家最终编辑的礼物及数量；rounds 仅提供来源证明，不再包含 players。同一主播目标房间必须一致，玩家须出现在所选来源礼物记录中，身份由服务端读取；可添加任意当前启用的配置礼物、补偿超过原流水数量，单种数量1至1000000。顺序、幂等、持久化、取消及不确定结果不重试的策略保持。旧的嵌套请求明确400，既有持久任务执行已冻结事件，不重算或重发。

两API release=/home/commonAdmin/releases/20260922-compensation-edit（100.6使用api子目录），各仅替换src/services/legacy-compensation-jobs.js一个运行源文件，其余基线逐SHA核对。候选/原发布路径与证据保存在两机/home/commonAdmin/backups/compensation-edit-20260922。shared .env/projects/supply-gifts逐SHA未变，SQLite文件/schema不替换，切换前后jobs/items均0；只重启独立管理API，/proc核对业务PID未变，没有向生产房间投递验收事件。

100.6最终网页current=/home/commonAdmin/releases/20260922-compensation-edit-web，api固定链接上述版本；静态证据backups/compensation-edit-web-20260922。源ZIP SHA-256 55e20150aa539cd003d4f7e29032a3ca6fb9c1b2f82d73aad8cb7531ce847165，78文件；保留pintu首service/sharedToken和goose待部署配置，Windows由网页任务同步两service版本。菜单同时标记生产功能和测试调试。

后端128单测/ESLint、4真实集成通过：本机独立schema的原流水2+3=5，编辑补偿20并新增无原流水的配置礼物7，HTTP任务→SQLite恢复→真实Redis→独立业务EventStore消费/ACK完整payload一致，另验证legacy_hash；原流水逐行保持，临时schema/精确Redis键清理。前端候选120测试/typecheck/build通过。公网4项目context/overview/jobs读取、401与health通过；dysgtower既有缺表409/手动直补限制不变。真实视觉验收未完成。

回退时两处网页与两API必须协同回退请求契约；API前版100.6为20260922-compensation-players/api，100.8为20260922-compensation-jobs。保留同一shared SQLite及所有任务状态，不恢复旧数据副本。检查正在执行的任务后仅操作独立管理服务，不修改玩法服务。

已修复本地backend-admin/.gitignore先前添加SQLite规则时覆盖原规则的问题：完整恢复node_modules/.env/coverage/logs/run/*.log，再追加SQLite规则，git check-ignore验证通过，没有提交或输出凭据。

## newTrick 测试调试接入（2026-09-24）

当前 release 为 `/home/commonAdmin/releases/20260924-newtrick`，从 `20260922-compensation-edit-web` 的网页和 `20260922-compensation-edit/api` 构建；110 个文件逐 SHA 核对。运行代码只在固定代理白名单增加 `newTrick`，静态只改 `projects.json`，入口 JS/CSS 不变。pintu 保留首个 service 与 sharedToken；newTrick 生产地址为空，只在统一首页提供原礼物调试功能，不增加测试入口或测试登录，不注册虚假的生产业务项目。

Windows 测试管理服务注册 `newTrick`（数据库 `newtrick`、Redis DB13、Mock=true、legacy_t_v1），配置由 Windows 部署任务负责。能力为 leaderboards/compensations/debug，不启用 tower_config，不查询或写入已移除的 t_config_recover。代理继续每次验证项目身份与 Mock/debug 能力，测试 Token 仅在服务端。

后端128单测/lint、4真实集成及候选生产只读预检通过。上线后16项公网检查通过，三测试项目各8礼物/80玩家/10主播，生产仍Mock=false/6礼物；未登录及测试Token冒用生产认证401，未知目标404，生产直接调试403。只重启 common-admin-personcar.service，其他 Node PID 不变；shared 三配置 SHA 未变，SQLite jobs/items 均25，前后保持。100.8未改动。

证据在 `/home/commonAdmin/backups/newtrick-20260924`：preflight.json、deployment.json、public-validation.json、log-audit.json。静态配置 SHA-256 为 `cdce31f899178530931387f62b664e15c67c4fee3c07d86117c5e854f99bfe76`。回滚前确认后续发布与任务状态，仅将 current 恢复为 `20260922-compensation-edit-web` 并重启独立管理服务；同步移除 Windows newTrick 测试映射或协调代理版本，保留所有 shared 配置和 SQLite/WAL，不回退业务数据。Windows 真实链路及页面验收结果见 [历史交接第35节](../../docs/archive/HANDOFF-2026-10-16.md)。
