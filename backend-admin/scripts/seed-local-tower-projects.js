import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const SEEDS = Object.freeze([
  {
    database: 'tower_dy_codex',
    mainConfigId: 1,
    version: 'seed-2024-06-18',
    remark: '本地隔离副本：抖音塔防 2024-06-18 生产参数备份',
    file: fileURLToPath(new URL('../database/seeds/tower-dy-main.json', import.meta.url)),
  },
  {
    database: 'tower_ks_codex',
    mainConfigId: 1,
    version: 'seed-2024-03-29',
    remark: '本地隔离副本：快手塔防 2024-03-29 参数备份',
    file: fileURLToPath(new URL('../database/seeds/tower-ks-main.json', import.meta.url)),
  },
]);

const host = process.env.MYSQL_HOST || '127.0.0.1';
if (!LOOPBACK_HOSTS.has(host)) {
  throw new Error('Local tower seeds may only be created on a loopback MySQL host');
}

const connection = await mysql.createConnection({
  host,
  port: numberFromEnv('MYSQL_PORT', 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  charset: 'utf8mb4',
  multipleStatements: true,
});

try {
  for (const seed of SEEDS) {
    const configText = await readFile(seed.file, 'utf8');
    JSON.parse(configText);
    const database = quoteIdentifier(seed.database);
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS ${database}
       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    await connection.query(`
      CREATE TABLE IF NOT EXISTS ${database}.t_config (
        ID INT NOT NULL AUTO_INCREMENT,
        Version VARCHAR(32) NULL,
        Config LONGTEXT NULL,
        Remark VARCHAR(255) NULL,
        PRIMARY KEY (ID)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      CREATE TABLE IF NOT EXISTS ${database}.t_config_welfare (
        ID INT NOT NULL,
        config TEXT NULL,
        PRIMARY KEY (ID)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      CREATE TABLE IF NOT EXISTS ${database}.t_config_recover (
        ID INT NOT NULL AUTO_INCREMENT,
        openUID VARCHAR(100) NOT NULL,
        nickname VARCHAR(255) NOT NULL,
        recoverconfig TEXT NOT NULL,
        isUsed VARCHAR(1) NOT NULL DEFAULT '0',
        Time DATETIME NOT NULL,
        PRIMARY KEY (ID),
        KEY idx_tower_recover_open_unused (openUID, isUsed, ID)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      CREATE TABLE IF NOT EXISTS ${database}.t_anchor_info (
        ID INT NOT NULL AUTO_INCREMENT,
        openUID VARCHAR(100) NOT NULL,
        nickName VARCHAR(100) NULL,
        configID INT NULL,
        isDelete VARCHAR(2) NULL DEFAULT '0',
        PRIMARY KEY (ID),
        UNIQUE KEY uq_tower_anchor_open_uid (openUID),
        KEY idx_tower_anchor_config_nickname (configID, nickName)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    const [result] = await connection.execute(
      `INSERT IGNORE INTO ${database}.t_config (ID, Version, Config, Remark)
       VALUES (?, ?, ?, ?)`,
      [seed.mainConfigId, seed.version, configText, seed.remark],
    );
    const action = result.affectedRows === 1 ? 'seeded' : 'kept-existing';
    process.stdout.write(`${seed.database}: ${action}\n`);
  }
} finally {
  await connection.end();
}

function quoteIdentifier(value) {
  if (!/^[A-Za-z0-9_]+$/u.test(value)) throw new Error(`Unsafe MySQL identifier: ${value}`);
  return `\`${value}\``;
}

function numberFromEnv(key, fallback) {
  const value = process.env[key];
  const parsed = value ? Number(value) : fallback;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${key} must be a valid TCP port`);
  }
  return parsed;
}
