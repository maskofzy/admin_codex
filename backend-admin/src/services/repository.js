import mysql from 'mysql2/promise';

export class ConfigConflictError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ConfigConflictError';
    this.code = code;
  }
}

export function createRepository(config) {
  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    charset: 'utf8mb4',
    timezone: 'Z',
    waitForConnections: true,
    connectionLimit: config.connectionLimit,
    queueLimit: 0,
    enableKeepAlive: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
  });
  pool.on('connection', connection => {
    connection.query("SET SESSION time_zone = '+00:00'", error => {
      if (error) connection.destroy();
    });
  });

  return new Repository(pool);
}

export class Repository {
  constructor(pool) {
    this.pool = pool;
  }

  async health() {
    await this.pool.query('SELECT 1');
  }

  async close() {
    await this.pool.end();
  }

  async listGameConfigs(configKey) {
    const [rows] = await this.pool.execute(
      `SELECT gc.config_key, gc.version, gc.config_json, gc.enabled, gc.updated_at,
        revision.remark, revision.changed_at
       FROM game_config gc
       LEFT JOIN game_config_revision revision
         ON revision.config_key = gc.config_key AND revision.version = gc.version
       WHERE gc.config_key = ?`,
      [configKey],
    );
    return rows.map(mapGameConfigRow);
  }

  async updateGameConfig({ configKey, version, config, enabled, remark = '', changedAt = new Date() }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT version, enabled
         FROM game_config
         WHERE config_key = ?
         FOR UPDATE`,
        [configKey],
      );
      if (rows.length === 0) {
        throw new ConfigConflictError('game config does not exist', 'config_not_found');
      }
      const currentVersion = Number(rows[0].version);
      if (version !== currentVersion) {
        throw new ConfigConflictError('game config version is stale', 'config_version_conflict');
      }

      const nextVersion = currentVersion + 1;
      const nextEnabled = enabled === undefined ? Boolean(rows[0].enabled) : enabled;
      const configJson = serializeJson(config);
      await connection.execute(
        `INSERT INTO game_config_revision
          (config_key, version, config_json, enabled, remark, changed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [configKey, nextVersion, configJson, nextEnabled, remark, changedAt],
      );
      await connection.execute(
        `UPDATE game_config
         SET version = ?, config_json = ?, enabled = ?, updated_at = ?
         WHERE config_key = ? AND version = ?`,
        [nextVersion, configJson, nextEnabled, changedAt, configKey, currentVersion],
      );
      await connection.commit();
      return {
        configKey,
        version: nextVersion,
        config,
        enabled: nextEnabled,
        remark,
        changedAt,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

function mapGameConfigRow(row) {
  return {
    configKey: row.config_key,
    version: Number(row.version),
    config: parseJsonColumn(row.config_json),
    enabled: Boolean(row.enabled),
    updatedAt: row.updated_at,
    remark: row.remark || '',
    changedAt: row.changed_at,
  };
}

function parseJsonColumn(value) {
  if (typeof value === 'string') return JSON.parse(value);
  return value || {};
}

function serializeJson(value) {
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError('config must be JSON serializable');
  return json;
}
