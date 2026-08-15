import { sha256Hex } from '../lib/crypto.js';
import { isRecord, parseJson } from '../lib/json.js';

export class TowerConfigRepositoryError extends Error {
  constructor(code, status, options) {
    super(code, options);
    this.name = 'TowerConfigRepositoryError';
    this.code = code;
    this.status = status;
  }
}

export class TowerConfigRepository {
  constructor(pool, config) {
    if (!pool) throw new Error('pool is required');
    if (!config) throw new Error('tower config is required');
    this.pool = pool;
    this.config = config;
  }

  async getDocument() {
    const [main, welfare] = await Promise.all([
      this.#readMain(this.pool),
      this.config.welfareConfigId === null
        ? null
        : this.#readWelfare(this.pool),
    ]);
    return { main, welfare };
  }

  async updateMain({ expectedRevision, config, remark }) {
    return this.#withTransaction(async connection => {
      const current = await this.#readMain(connection, { forUpdate: true });
      assertRevision(current.revision, expectedRevision);
      const configText = serializeConfig(config);
      const nextRemark = remark === undefined ? current.remark : remark;
      await connection.execute(
        'UPDATE t_config SET Config = ?, Remark = ? WHERE ID = ?',
        [configText, nextRemark, this.config.mainConfigId],
      );
      return {
        ...current,
        revision: sha256Hex(configText),
        remark: nextRemark,
        config,
      };
    });
  }

  async updateWelfare({ expectedRevision, config }) {
    if (this.config.welfareConfigId === null) {
      throw new TowerConfigRepositoryError('tower_welfare_not_configured', 404);
    }
    return this.#withTransaction(async connection => {
      const current = await this.#readWelfare(connection, { forUpdate: true });
      assertRevision(current.revision, expectedRevision);
      const configText = serializeConfig(config);
      await connection.execute(
        'UPDATE t_config_welfare SET config = ? WHERE ID = ?',
        [configText, this.config.welfareConfigId],
      );
      return {
        ...current,
        revision: sha256Hex(configText),
        config,
      };
    });
  }

  async listAnchors({ query = '', limit = 50 } = {}) {
    const configIds = this.config.anchorConfigIds;
    const params = [...configIds];
    let searchSql = '';
    if (query) {
      const pattern = `%${escapeLike(query)}%`;
      searchSql = `
        AND (nickName LIKE ? ESCAPE '=' OR openUID LIKE ? ESCAPE '=')`;
      params.push(pattern, pattern);
    }
    params.push(limit);
    const [rows] = await this.pool.execute(
      `SELECT openUID, nickName, configID
       FROM t_anchor_info
       WHERE configID IN (${placeholders(configIds.length)})
         AND openUID IS NOT NULL AND openUID <> ''
         AND (isDelete IS NULL OR isDelete = '0')
         ${searchSql}
       ORDER BY nickName ASC, openUID ASC
       LIMIT ?`,
      params,
    );
    return rows.map(row => ({
      openUid: String(row.openUID),
      nickname: String(row.nickName || row.openUID),
      configId: row.configID === null ? null : String(row.configID),
    }));
  }

  async listRecoveries({ unusedOnly = true, limit = 50 } = {}) {
    const configIds = this.config.anchorConfigIds;
    const params = [...configIds];
    const unusedSql = unusedOnly ? "AND (recovery.isUsed IS NULL OR recovery.isUsed = '0')" : '';
    params.push(limit);
    const [rows] = await this.pool.execute(
      `SELECT DISTINCT recovery.ID, recovery.openUID, recovery.nickname,
         recovery.recoverconfig, recovery.isUsed, recovery.Time
       FROM t_config_recover recovery
       INNER JOIN t_anchor_info anchor
         ON anchor.openUID = recovery.openUID
        AND anchor.configID IN (${placeholders(configIds.length)})
        AND (anchor.isDelete IS NULL OR anchor.isDelete = '0')
       WHERE 1 = 1 ${unusedSql}
       ORDER BY recovery.ID DESC
       LIMIT ?`,
      params,
    );
    return rows.map(mapRecoveryRow);
  }

  async createRecovery({ openUid, config, createdAt = new Date() }) {
    return this.#withTransaction(async connection => {
      const configIds = this.config.anchorConfigIds;
      const [anchorRows] = await connection.execute(
        `SELECT ID, openUID, nickName, configID
         FROM t_anchor_info
         WHERE openUID = ?
           AND configID IN (${placeholders(configIds.length)})
           AND (isDelete IS NULL OR isDelete = '0')
         ORDER BY ID ASC
         LIMIT 1
         FOR UPDATE`,
        [openUid, ...configIds],
      );
      if (anchorRows.length === 0) {
        throw new TowerConfigRepositoryError('tower_anchor_not_found', 404);
      }
      const [existingRows] = await connection.execute(
        `SELECT ID
         FROM t_config_recover
         WHERE openUID = ? AND (isUsed IS NULL OR isUsed = '0')
         ORDER BY ID DESC
         LIMIT 1
         FOR UPDATE`,
        [openUid],
      );
      if (existingRows.length > 0) {
        throw new TowerConfigRepositoryError('tower_recovery_exists', 409);
      }
      const anchor = anchorRows[0];
      const nickname = String(anchor.nickName || anchor.openUID);
      const configText = serializeConfig(config);
      const [result] = await connection.execute(
        `INSERT INTO t_config_recover
          (openUID, nickname, recoverconfig, isUsed, Time)
         VALUES (?, ?, ?, '0', ?)`,
        [openUid, nickname, configText, createdAt],
      );
      return {
        id: String(result.insertId),
        openUid,
        nickname,
        config,
        isUsed: false,
        createdAt,
      };
    });
  }

  async #readMain(executor, { forUpdate = false } = {}) {
    const [rows] = await executor.execute(
      `SELECT ID, Version, Config, Remark
       FROM t_config
       WHERE ID = ?${forUpdate ? ' FOR UPDATE' : ''}`,
      [this.config.mainConfigId],
    );
    if (rows.length === 0) {
      throw new TowerConfigRepositoryError('tower_config_not_found', 404);
    }
    const row = rows[0];
    const configText = requireConfigText(row.Config, 'tower_config_invalid');
    return {
      id: String(row.ID),
      revision: sha256Hex(configText),
      version: row.Version === null || row.Version === undefined ? null : String(row.Version),
      remark: row.Remark === null || row.Remark === undefined ? '' : String(row.Remark),
      config: parseConfig(configText, 'tower_config_invalid'),
    };
  }

  async #readWelfare(executor, { forUpdate = false } = {}) {
    const [rows] = await executor.execute(
      `SELECT ID, config
       FROM t_config_welfare
       WHERE ID = ?${forUpdate ? ' FOR UPDATE' : ''}`,
      [this.config.welfareConfigId],
    );
    if (rows.length === 0) {
      throw new TowerConfigRepositoryError('tower_welfare_not_found', 404);
    }
    const row = rows[0];
    const configText = requireConfigText(row.config, 'tower_welfare_invalid');
    return {
      id: String(row.ID),
      revision: sha256Hex(configText),
      version: null,
      remark: '',
      config: parseConfig(configText, 'tower_welfare_invalid'),
    };
  }

  async #withTransaction(operation) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await operation(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

function mapRecoveryRow(row) {
  const configText = requireConfigText(row.recoverconfig, 'tower_recovery_invalid');
  return {
    id: String(row.ID),
    openUid: String(row.openUID),
    nickname: String(row.nickname || row.openUID),
    config: parseConfig(configText, 'tower_recovery_invalid'),
    isUsed: String(row.isUsed ?? '0') !== '0',
    createdAt: row.Time,
  };
}

function parseConfig(value, code) {
  try {
    const parsed = parseJson(value);
    if (!isRecord(parsed)) throw new Error('config must be an object');
    return parsed;
  } catch (error) {
    throw new TowerConfigRepositoryError(code, 500, { cause: error });
  }
}

function requireConfigText(value, code) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TowerConfigRepositoryError(code, 500);
  }
  return value;
}

function serializeConfig(value) {
  if (!isRecord(value)) throw new TypeError('tower config must be an object');
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError('tower config must be JSON serializable');
  return json;
}

function assertRevision(currentRevision, expectedRevision) {
  if (currentRevision !== expectedRevision) {
    throw new TowerConfigRepositoryError('tower_config_conflict', 409);
  }
}

function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(', ');
}

function escapeLike(value) {
  return value.replace(/[=%_]/gu, character => `=${character}`);
}
