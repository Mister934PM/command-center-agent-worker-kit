#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const workerRoot = process.env.COMMAND_CENTER_WORKER_ROOT || path.resolve(__dirname, '..', '..');
const credentialsDir = process.env.NOCODB_MCP_CREDENTIALS_DIR || path.join(workerRoot, 'credentials');

const ALIAS_MAP = {
  'main': 'main',
  'getting-started': 'main',
  'hiring.cafe': 'hiring-cafe',
  'hiring cafe': 'hiring-cafe',
  'hiring-cafe': 'hiring-cafe',
  'praxica': 'praxica',
  'praxica.io': 'praxica',
  'sourcedeck': 'sourcedeck',
  'sourcedeck.io': 'sourcedeck',
};

const TABLE_TITLES = {
  'seo-keywords': 'SEO Keywords',
  'blog-articles': 'Blog Articles',
  'competitors': 'Competitors',
  'entities': 'Entities',
  'jobs': 'Jobs',
  'hiring-jobs': 'Jobs',
  'hiring-cafe-jobs': 'Jobs',
};

function die(message) {
  console.error(message);
  process.exit(1);
}

function usage() {
  console.log(`Mission records helper

Usage:
  node mission-records.js <baseAlias> <tableAlias> upsert <jsonFile>
  node mission-records.js <baseAlias> <tableAlias> create <jsonFile>
  node mission-records.js <baseAlias> <tableAlias> update <recordId> <jsonFile>
  node mission-records.js <baseAlias> <tableAlias> query [pageSize]
`);
  process.exit(0);
}

function canonicalAlias(alias) {
  const normalized = String(alias || '').trim().toLowerCase();
  return ALIAS_MAP[normalized] || normalized;
}

function resolveConfig(alias) {
  const normalized = canonicalAlias(alias);
  const configFile = normalized === 'main'
    ? 'nocodb-mcp.local.json'
    : `nocodb-mcp.${normalized}.local.json`;
  const configPath = path.join(credentialsDir, configFile);
  if (!fs.existsSync(configPath)) {
    die(`Missing NocoDB config for alias '${alias}': ${configPath}`);
  }
  return configPath;
}

function parseJsonFile(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    die(`Missing JSON file: ${abs}`);
  }
  return JSON.parse(fs.readFileSync(abs, 'utf8').replace(/^\uFEFF/, ''));
}

function helperArgs(commandArgs) {
  return [path.join(__dirname, 'nocodb-mcp.js'), ...commandArgs];
}

function runHelper(configPath, commandArgs) {
  const result = spawnSync(process.execPath, helperArgs(commandArgs), {
    env: { ...process.env, NOCODB_MCP_CONFIG: configPath, NOCODB_MCP_CREDENTIALS_DIR: credentialsDir, COMMAND_CENTER_WORKER_ROOT: workerRoot },
    encoding: 'utf8',
    shell: false,
    stdio: 'pipe',
  });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) {
    const stderr = String(result.stderr || '').trim();
    const stdout = String(result.stdout || '').trim();
    die(stderr || stdout || `Helper failed with exit code ${result.status}`);
  }
  const output = String(result.stdout || '').trim();
  if (!output) return null;
  try {
    return JSON.parse(output);
  } catch {
    die(`Helper returned non-JSON output:\n${output}`);
  }
}

function getTableId(configPath, tableAlias) {
  const tableTitle = TABLE_TITLES[String(tableAlias || '').trim().toLowerCase()];
  if (!tableTitle) die(`Unknown table alias: ${tableAlias}`);
  const tables = runHelper(configPath, ['tables']) || [];
  const match = tables.find((table) => table.title === tableTitle);
  if (!match) die(`Table '${tableTitle}' not found in selected base.`);
  return match.id;
}

function normalizeChoice(value, mapping, fieldName) {
  if (value === undefined || value === null || value === '') return value;
  const raw = String(value).trim();
  const normalized = mapping[raw.toLowerCase()];
  if (!normalized) die(`Invalid ${fieldName}: ${value}`);
  return normalized;
}

function normalizeGeoPotential(value) {
  if (value === undefined || value === null || value === '') return value;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) die(`Invalid GEO Potential: ${value}`);
  if (numeric <= 5) return Math.max(0, Math.min(5, Math.round(numeric)));
  return Math.max(0, Math.min(5, Math.round(numeric / 20)));
}

function normalizeSeoKeywordFields(fields) {
  const next = { ...fields };
  if (!next.Title || !String(next.Title).trim()) die('SEO Keywords requires a non-empty Title.');
  next.Intent = normalizeChoice(next.Intent, {
    'info': 'Info',
    'informational': 'Info',
    'trans': 'Trans',
    'transactional': 'Trans',
    'nav': 'Nav',
    'navigational': 'Nav',
    'comm': 'Comm',
    'commercial': 'Comm',
    'commercial investigation': 'Comm',
  }, 'Intent');
  next.Status = normalizeChoice(next.Status, {
    'new': 'New',
    'targeted': 'Targeted',
    'researching': 'Researching',
    'to research': 'Researching',
    'content created': 'Content Created',
    'created': 'Content Created',
  }, 'Status');
  if (next['GEO Potential'] !== undefined) next['GEO Potential'] = normalizeGeoPotential(next['GEO Potential']);
  return next;
}

function normalizeBlogArticleFields(fields) {
  const next = { ...fields };
  if (!next.Title || !String(next.Title).trim()) die('Blog Articles requires a non-empty Title.');
  next.Status = normalizeChoice(next.Status, {
    'to research': 'To Research',
    'research': 'To Research',
    'to brief': 'To Brief',
    'brief': 'To Brief',
    'drafting': 'Drafting',
    'editing': 'Editing',
    'published': 'Published',
  }, 'Status');
  next.Priority = normalizeChoice(next.Priority, {
    'low': 'Low',
    'med': 'Med',
    'medium': 'Med',
    'high': 'High',
  }, 'Priority');
  return next;
}

function normalizeFields(tableAlias, fields) {
  const alias = String(tableAlias).trim().toLowerCase();
  if (alias === 'seo-keywords') return normalizeSeoKeywordFields(fields);
  if (alias === 'blog-articles') return normalizeBlogArticleFields(fields);
  return { ...fields };
}

function loadFields(jsonFile) {
  const payload = parseJsonFile(jsonFile);
  if (payload && typeof payload === 'object' && payload.fields && typeof payload.fields === 'object') return payload.fields;
  if (payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object') return payload.data;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) return payload;
  die('JSON payload must be an object, {"fields": {...}}, or {"data": {...}}.');
}

function queryRecords(configPath, tableId, pageSize = 100) {
  return runHelper(configPath, ['call', 'queryRecords', JSON.stringify({ tableId, pageSize })]);
}

function findRecordByTitle(configPath, tableId, title) {
  const result = queryRecords(configPath, tableId, 200) || { records: [] };
  return (result.records || []).find((record) => String(record?.fields?.Title || '').trim().toLowerCase() === String(title).trim().toLowerCase()) || null;
}

function createRecord(configPath, tableId, fields) {
  return runHelper(configPath, ['call', 'createRecords', JSON.stringify({ tableId, records: [{ fields }] })]);
}

function updateRecord(configPath, tableId, id, fields) {
  return runHelper(configPath, ['call', 'updateRecords', JSON.stringify({ tableId, records: [{ id, fields }] })]);
}

(function main() {
  const [baseAlias, tableAlias, action, arg1, arg2] = process.argv.slice(2);
  if (!baseAlias || baseAlias === 'help' || baseAlias === '--help' || baseAlias === '-h') usage();
  if (!tableAlias || !action) usage();

  const configPath = resolveConfig(baseAlias);
  const tableId = getTableId(configPath, tableAlias);

  if (action === 'query') {
    const pageSize = Number(arg1 || 20);
    console.log(JSON.stringify(queryRecords(configPath, tableId, pageSize), null, 2));
    return;
  }

  if (action === 'create') {
    const fields = normalizeFields(tableAlias, loadFields(arg1));
    console.log(JSON.stringify(createRecord(configPath, tableId, fields), null, 2));
    return;
  }

  if (action === 'update') {
    const id = Number(arg1);
    if (!Number.isFinite(id)) die('Update requires a numeric recordId.');
    const fields = normalizeFields(tableAlias, loadFields(arg2));
    console.log(JSON.stringify(updateRecord(configPath, tableId, id, fields), null, 2));
    return;
  }

  if (action === 'upsert') {
    const fields = normalizeFields(tableAlias, loadFields(arg1));
    const existing = findRecordByTitle(configPath, tableId, fields.Title);
    const result = existing
      ? updateRecord(configPath, tableId, Number(existing.id), fields)
      : createRecord(configPath, tableId, fields);
    console.log(JSON.stringify({ mode: existing ? 'update' : 'create', existingId: existing ? Number(existing.id) : null, result }, null, 2));
    return;
  }

  die(`Unknown action: ${action}`);
})();
