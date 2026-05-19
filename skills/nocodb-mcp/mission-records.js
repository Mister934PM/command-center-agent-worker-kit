#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ADMIN_HELPER = process.env.NOCODB_ADMIN_HELPER || 'C:\\Users\\user\\.vixxie\\workspace\\skills\\nocodb-admin\\nocodb-admin.js';

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

const BASE_IDS = {
  main: 'pd6ks71ihvvtpen',
  'hiring-cafe': 'prwnmdijh9wlrx9',
  praxica: 'pia6bumiscfio0p',
  sourcedeck: 'ptefvr801ewl3dk',
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

function baseIdFor(alias) {
  const canonical = canonicalAlias(alias);
  const baseId = BASE_IDS[canonical];
  if (!baseId) die(`Unknown base alias: ${alias}`);
  return baseId;
}

function runAdmin(args) {
  if (!fs.existsSync(ADMIN_HELPER)) die(`Missing NocoDB admin helper: ${ADMIN_HELPER}`);
  const result = spawnSync(process.execPath, [ADMIN_HELPER, ...args], {
    encoding: 'utf8',
    shell: false,
    stdio: 'pipe',
    env: { ...process.env },
  });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) {
    const stderr = String(result.stderr || '').trim();
    const stdout = String(result.stdout || '').trim();
    die(stderr || stdout || `NocoDB admin helper failed with exit code ${result.status}`);
  }
  const output = String(result.stdout || '').trim();
  if (!output) return null;
  try {
    return JSON.parse(output);
  } catch {
    die(`NocoDB admin helper returned non-JSON output:\n${output}`);
  }
}

function parseJsonFile(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) die(`Missing JSON file: ${abs}`);
  return JSON.parse(fs.readFileSync(abs, 'utf8').replace(/^\uFEFF/, ''));
}

function getTableId(baseId, tableAlias) {
  const tableTitle = TABLE_TITLES[String(tableAlias || '').trim().toLowerCase()];
  if (!tableTitle) die(`Unknown table alias: ${tableAlias}`);
  const tables = runAdmin(['tables', '--base', baseId]) || [];
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
    info: 'Info', informational: 'Info', trans: 'Trans', transactional: 'Trans',
    nav: 'Nav', navigational: 'Nav', comm: 'Comm', commercial: 'Comm',
    'commercial investigation': 'Comm',
  }, 'Intent');
  next.Status = normalizeChoice(next.Status, {
    new: 'New', targeted: 'Targeted', researching: 'Researching',
    'to research': 'Researching', 'content created': 'Content Created', created: 'Content Created',
  }, 'Status');
  if (next['GEO Potential'] !== undefined) next['GEO Potential'] = normalizeGeoPotential(next['GEO Potential']);
  return next;
}

function normalizeBlogArticleFields(fields) {
  const next = { ...fields };
  if (!next.Title || !String(next.Title).trim()) die('Blog Articles requires a non-empty Title.');
  next.Status = normalizeChoice(next.Status, {
    'to research': 'To Research', research: 'To Research', 'to brief': 'To Brief',
    brief: 'To Brief', drafting: 'Drafting', editing: 'Editing', published: 'Published',
  }, 'Status');
  next.Priority = normalizeChoice(next.Priority, { low: 'Low', med: 'Med', medium: 'Med', high: 'High' }, 'Priority');
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

function writeTempRecords(records) {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nocodb-records-')), 'records.json');
  fs.writeFileSync(filePath, JSON.stringify(records, null, 2), 'utf8');
  return filePath;
}

function queryRecords(tableId, pageSize = 100) {
  return runAdmin(['records', '--table', tableId, '--limit', String(pageSize)]);
}

function findRecordByTitle(tableId, title) {
  const result = queryRecords(tableId, 200) || { list: [] };
  return (result.list || []).find((record) => String(record?.Title || '').trim().toLowerCase() === String(title).trim().toLowerCase()) || null;
}

function createRecord(tableId, fields) {
  const input = writeTempRecords([fields]);
  return runAdmin(['create-records', '--table', tableId, '--input', input, '--execute']);
}

function updateRecord(baseId, tableId, id, fields) {
  const input = writeTempRecords([{ Id: Number(id), ...fields }]);
  return runAdmin(['update-records', '--base', baseId, '--table', tableId, '--input', input, '--execute']);
}

(function main() {
  const [baseAlias, tableAlias, action, arg1, arg2] = process.argv.slice(2);
  if (!baseAlias || baseAlias === 'help' || baseAlias === '--help' || baseAlias === '-h') usage();
  if (!tableAlias || !action) usage();

  const baseId = baseIdFor(baseAlias);
  const tableId = getTableId(baseId, tableAlias);

  if (action === 'query') {
    const pageSize = Number(arg1 || 20);
    console.log(JSON.stringify(queryRecords(tableId, pageSize), null, 2));
    return;
  }

  if (action === 'create') {
    const fields = normalizeFields(tableAlias, loadFields(arg1));
    console.log(JSON.stringify(createRecord(tableId, fields), null, 2));
    return;
  }

  if (action === 'update') {
    const id = Number(arg1);
    if (!Number.isFinite(id)) die('Update requires a numeric recordId.');
    const fields = normalizeFields(tableAlias, loadFields(arg2));
    console.log(JSON.stringify(updateRecord(baseId, tableId, id, fields), null, 2));
    return;
  }

  if (action === 'upsert') {
    const fields = normalizeFields(tableAlias, loadFields(arg1));
    const existing = findRecordByTitle(tableId, fields.Title);
    const result = existing
      ? updateRecord(baseId, tableId, Number(existing.Id), fields)
      : createRecord(tableId, fields);
    console.log(JSON.stringify({ mode: existing ? 'update' : 'create', existingId: existing ? Number(existing.Id) : null, result }, null, 2));
    return;
  }

  die(`Unknown action: ${action}`);
})();
