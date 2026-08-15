import { readFile } from 'node:fs/promises';
import { loadConfig } from '../src/config.js';
import { applyManagementSchema } from '../src/services/management-schema.js';

const config = loadConfig();
const schema = await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8');
const applied = await applyManagementSchema(config, schema);
for (const target of applied) {
  console.log(`Applied management schema to ${target.projectId} (${target.database}).`);
}
