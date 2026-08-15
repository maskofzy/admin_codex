import mysql from 'mysql2/promise';

export const REQUIRED_BUSINESS_TABLES = Object.freeze([
  'game_config',
  'game_config_revision',
  'platform_user',
  'live_room',
  'game_round',
  'pending_player_group',
  'round_player_group',
  'round_player_score',
  'leaderboard_period_score',
  'live_gift_event',
]);

export const REQUIRED_BUSINESS_COLUMNS = Object.freeze({
  game_round: Object.freeze([
    'anchor_user_id',
    'anchor_nickname_snapshot',
    'anchor_avatar_url_snapshot',
    'anchor_authenticated_at_snapshot',
  ]),
  live_gift_event: Object.freeze([
    'id',
    'room_id',
    'round_id',
    'user_id',
    'platform_event_id',
    'nickname_snapshot',
    'avatar_url_snapshot',
    'gift_id',
    'gift_name',
    'gift_count',
    'gift_value',
    'occurred_at',
    'payload_json',
  ]),
});

export const REQUIRED_TOWER_COLUMNS = Object.freeze({
  t_config: Object.freeze(['ID', 'Version', 'Config', 'Remark']),
  t_anchor_info: Object.freeze(['ID', 'openUID', 'nickName', 'configID', 'isDelete']),
  t_config_recover: Object.freeze([
    'ID', 'openUID', 'nickname', 'recoverconfig', 'isUsed', 'Time',
  ]),
  t_config_welfare: Object.freeze(['ID', 'config']),
});

export async function applyManagementSchema(config, schema, options = {}) {
  const connectionFactory = options.connectionFactory ?? createConnection;
  const applied = [];
  for (const project of config.projects) {
    const connection = await connectionFactory(project.mysql, project);
    try {
      if (project.capabilities.towerConfig) {
        await assertTowerSchema(connection, project.mysql.database, project.tower);
        applied.push({ projectId: project.id, database: project.mysql.database });
        continue;
      }
      await assertBusinessSchema(connection, project.mysql.database);
      await connection.query(schema);
      applied.push({ projectId: project.id, database: project.mysql.database });
    } finally {
      await connection.end();
    }
  }
  return applied;
}

export async function assertTowerSchema(connection, database, tower) {
  const requiredTables = ['t_config', 't_anchor_info', 't_config_recover'];
  if (tower.welfareConfigId !== null) requiredTables.push('t_config_welfare');
  const [rows] = await connection.query(
    `SELECT TABLE_NAME AS table_name
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)`,
    [database, requiredTables],
  );
  const present = new Set(rows.map(row => row.table_name));
  const missing = requiredTables.filter(table => !present.has(table));
  if (missing.length > 0) {
    throw new Error(`Tower schema is incomplete in ${database}: missing ${missing.join(', ')}`);
  }

  const requiredColumns = Object.fromEntries(requiredTables.map(table => [
    table,
    REQUIRED_TOWER_COLUMNS[table],
  ]));
  const [columnRows] = await connection.query(
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)`,
    [database, requiredTables],
  );
  const presentColumns = new Set(
    columnRows.map(row => `${row.table_name}.${row.column_name}`),
  );
  const missingColumns = Object.entries(requiredColumns).flatMap(([table, columns]) => (
    columns
      .filter(column => !presentColumns.has(`${table}.${column}`))
      .map(column => `${table}.${column}`)
  ));
  if (missingColumns.length > 0) {
    throw new Error(`Tower schema is incomplete in ${database}: missing ${missingColumns.join(', ')}`);
  }

  const [mainRows] = await connection.query(
    'SELECT ID FROM t_config WHERE ID = ? LIMIT 1',
    [tower.mainConfigId],
  );
  if (mainRows.length === 0) {
    throw new Error(`Tower main config ${tower.mainConfigId} is missing in ${database}`);
  }
  if (tower.welfareConfigId !== null) {
    const [welfareRows] = await connection.query(
      'SELECT ID FROM t_config_welfare WHERE ID = ? LIMIT 1',
      [tower.welfareConfigId],
    );
    if (welfareRows.length === 0) {
      throw new Error(`Tower welfare config ${tower.welfareConfigId} is missing in ${database}`);
    }
  }
}

export async function assertBusinessSchema(connection, database) {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME AS table_name
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)`,
    [database, REQUIRED_BUSINESS_TABLES],
  );
  const present = new Set(rows.map(row => row.table_name));
  const missing = REQUIRED_BUSINESS_TABLES.filter(table => !present.has(table));
  if (missing.length > 0) {
    throw new Error(`Business schema is incomplete in ${database}: missing ${missing.join(', ')}`);
  }
  const requiredColumnTables = Object.keys(REQUIRED_BUSINESS_COLUMNS);
  const [columnRows] = await connection.query(
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)`,
    [database, requiredColumnTables],
  );
  const presentColumns = new Set(
    columnRows.map(row => `${row.table_name}.${row.column_name}`),
  );
  const missingColumns = requiredColumnTables.flatMap(table => (
    REQUIRED_BUSINESS_COLUMNS[table]
      .filter(column => !presentColumns.has(`${table}.${column}`))
      .map(column => `${table}.${column}`)
  ));
  if (missingColumns.length > 0) {
    throw new Error(
      `Business schema is incomplete in ${database}: missing ${missingColumns.join(', ')}`,
    );
  }
}

function createConnection(config) {
  return mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    charset: 'utf8mb4',
    timezone: 'Z',
    multipleStatements: true,
  });
}
