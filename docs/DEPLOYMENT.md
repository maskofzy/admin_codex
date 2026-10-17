# 部署与回退

更新时间：2026-10-17。下列状态来自截至 2026-10-16 的已完成发布记录，本次未连接生产巡检；实际操作前重新核对 current、文件 SHA、配置和在途任务。

## 入口与运行位置

| 环境 | 入口 / API | 独立管理进程 | 最近记录的运行路径 |
| --- | --- | --- | --- |
| Windows 静态 | http://43.143.79.195:86/ | IIS commonAdminHtml / commonAdminHtmlPool | C:/a-newCode/commonAdminHtml；含既有 test 子目录 |
| 100.6 静态 | https://pintu.quickdoing.com/admin/ | Nginx | /home/commonAdmin/current → releases/20261016-blue-wand-web |
| 100.6 生产 API | https://pintu.quickdoing.com/common-admin-api | systemd common-admin-personcar.service，127.0.0.1:7009 | /home/commonAdmin/releases/20260924-registry-images/api |
| 100.8 生产 API | https://sgtower.quickdoing.com/common-admin-api | PM2 common-admin-7009，127.0.0.1:7009 | /home/commonAdmin/releases/20260924-registry-images |
| Windows 测试 API | https://testll.quickdoing.com:8122 | PM2 common-admin-test-8122 | C:/a-newCode/commonAdminTest/releases/20260916-181320 |

API 目录名不是代码版本证明：这些目录已多次定点更新，必须核对文件清单。静态 release 的 api 链接保持固定目标，静态发布不需要重启 API。

Windows 公开 services 包含两生产组；pintu 仅含 100.6 组，不擅自扩大 100.8 CORS。根/test 各自保留 projects.json 和 web.config，不能拿本地开发配置覆盖。统一首页不再提供独立测试登录，测试操作走固定服务端代理。

## 已接入项目

| 服务 | 项目 | 固定数据库 / Redis DB | 重要差异 |
| --- | --- | --- | --- |
| 100.6 | PersonCar | 100.7/personcar / 2 | event_store；独立图库；Mock=false |
| 100.6 | sl2 | 100.7/senlinii / 1 | legacy_hash；行会、月度奖励/自动任务 |
| 100.6 | gooseAndDog | 100.7/gooseAndDog / 3 | event_store；榜单/补偿/行会；Mock=false |
| 100.8 | dysgtower | 100.9/dysgtower | 塔防配置/手动补偿；缺旧场次表，不虚报自动补偿 |
| 100.8 | dysjz | 100.9/dysjz / 12 | legacy_hash；榜单/补偿 |
| 100.8 | dycad | 100.9/dycad / 11 | legacy_hash；榜单/补偿 |
| 100.8 | dycow | 100.9/dycow / 13 | legacy_hash；榜单/补偿；礼物事件值为目录抖币价 10 倍 |
| Windows 测试 | PersonCar | BirthdayBattle / 6 | Mock；业务端口 8972 |
| Windows 测试 | gooseAndDog | gooseAndDog / 1 | Mock；业务端口 8109 |
| Windows 测试 | newTrick | newtrick / 13 | Mock；业务端口 8110；不恢复已移除的恢复表 |
| Windows 测试 | toyBattle | toybattle / 14 | Mock；业务端口 8111；生产地址为空 |

100.7 指 192.168.100.7，100.9 指 192.168.100.9；Redis 是各自服务所在主机的固定连接。dysgtower Redis 分配需读实际受保护注册表确认，不从其他项目猜值。表内能力只是关键差异，完整配置以服务端注册表及 preflight 为准。

PersonCar/sl2 对 100.7 的 MySQL 连接使用各自 MYSQL_FLAGS=-CLIENT_QUERY_ATTRIBUTES。不得全项目继承或取消真实驱动检查。

## 配置、数据及证书

- Linux shared：`/home/commonAdmin/shared`；Windows 测试 shared：`C:/a-newCode/commonAdminTest/shared`。环境、礼物、注册表、用户目录和图片目标属于部署配置。
- 100.6 以 common-admin 用户运行；替换文件必须保留 owner/group/mode，只有 600 但属主错误也会导致服务启动失败。
- 生产补偿状态：`/home/commonAdmin/shared/legacy-compensation.sqlite` 及 WAL/SHM。不是 release 文件，不删除、不以旧副本回退；重启前核对全量 queued/running/dispatching，不能只查最近 100 条 API 列表。
- 100.6 sl2 自动任务 `SL2_MONTHLY_AUTO_START=2026-09-01`，不得因发布前移；10-01 已记录 9 月 backup/rewards/rights 三项审计完成，不重复发放。
- 两 Linux Nginx 证书：`/etc/nginx/ssl/_.quickdoing.com.pem` 和 `.key`；Windows 测试 HTTPS 使用专用 `shared/tls-20261007`，更新后仅重启测试管理服务重读。
- 最近证书有效至北京时间 **2027-04-16 09:30:17**。Linux 换证不会同步更新 Windows Node HTTPS；不恢复已过期旧证书作为可用性修复。
- 私钥、Token、env 及其备份不输出、不提交。普通文档只保存路径、非秘密哈希与操作边界。

## 最新静态发布证据

2026-10-16 `blue-wand-20261016`：Windows 根/test 共 184 文件，pintu 92 文件，发布时完整 SHA、公网 200/no-store 通过。

- JS：`assets/index-bD5oM4gp.js`，SHA-256 `FF0BFEB3DA28AC2B57AD80EDBBB4EF31D284717CD2AD3FA9301B18B9B2BCFCD7`。
- 蓝色图标 SHA-256：`E3D738333FE8E0C33F32739AE9CA8C230085103A8E42B8232ED14EA7A2011C49`。
- 本机清单：`%TEMP%/test-blue-wand-deployed.json`、`%TEMP%/prod-blue-wand-deployed.json`。这些是既有证据位置，本次未重新验证是否仍存在。
- 两生产日流水/单刷 API 证据、dycow 接入清单，以及历次来源/回退 SHA 见 [历史交接](archive/HANDOFF-2026-10-16.md) 第 56–58 节。dycow 远端证据在 `/home/commonAdmin/backups/dycow-20261015`；其中 env 副本含密钥。

## 发布和回退规则

1. 检查目标当前源码/配置/清单及补偿队列，记录实际基线。三个 API 历史上存在功能差异，不直接用本地包覆盖。
2. 制作与当前目标匹配的候选，按受影响契约运行验证；备份代码/配置并保留权限。配置备份留服务器受限目录，不放 Git。
3. API 先就绪再切依赖新接口的静态页；仅操作对应独立管理服务。静态文件逐 SHA 核对、保留环境配置，检查公网缓存策略。
4. 核对鉴权/能力/项目隔离、健康、业务 PID 未变；扫描结构化 level>=50 和意外 5xx，记录失败尝试与恢复，不只检查 stderr。
5. 回退前核对后续发布和活动任务；前后端契约成套协调。静态回退不代表 worker 已停止，不回退 SQLite/WAL、业务库或图库。

Windows `C:/a-newCode/commonAdminHtml-releases` **只保留最近三个完整历史站点，当前站不计入**。最近记录的三个为：

- before-blue-wand-20261016
- before-test-principal-20261016
- before-single-refresh-20261015

每次清理重新盘点，核对绝对路径、无重解析链接、无 IIS 物理引用，并验证当前/保留版本 SHA。该规则不适用于 Linux release、API/shared、SQLite/WAL、图库或业务数据。旧文档列出的更早 Windows 静态目录可能已删除。

原 `admin_codex.pre-*` 等源码/部署备份不因远端建成就自动可删：当前后续代码尚未提交/推送，发布流程及恢复演练也没有完成证据。本次仅整理文档，未删除任何实际备份、重启或发布服务。

一次性 TEMP 发布/清理脚本不是可重复部署工具，不盲目重跑。后续按发布版本保存脱敏清单（提交 SHA、目标、文件 SHA、验证结果、回退指向），更新本页当前状态；过程历史不再追加到必读 HANDOFF。
