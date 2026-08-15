# 本地塔防配置种子

这两个 JSON 仅用于本机管理台验收，不会自动连接或覆盖任何直播业务库：

- `tower-dy-main.json`：来自 `D:\xd\code\tower\config-90生产环境2024-06-18.txt`。
- `tower-ks-main.json`：来自 `D:\xd\code\tower-ks\config-90关-加经验系数-降低关卡难度-降80关及以后.txt`。

`scripts/seed-local-tower-projects.js` 只允许连接本机 MySQL，并创建独立的
`tower_dy_codex`、`tower_ks_codex` 数据库。已有配置行使用 `INSERT IGNORE` 保留，脚本重复运行不会覆盖人工修改。

正式环境必须在项目注册表中填写经过确认的数据库和 `mainConfigId`、
`welfareConfigId`、`anchorConfigIds`，不得把本地种子数据库当成线上配置源。
