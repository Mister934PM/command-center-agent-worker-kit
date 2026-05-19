#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function usage() {
  console.log(`Import prospecting records into Command Center

Usage:
  node import-prospecting-records.js --input jobs.json [options]

Options:
  --source <id>      Source id. Default: hiring-cafe
  --input <path>     JSON array or object with records/jobs/items
  --write            Ask Command Center to write to NocoDB
  --dry-run          Normalize only, no NocoDB write
  --table <name>     NocoDB table. Default: Jobs
`);
}

function parseArgs(argv) {
  const opts = { source: 'hiring-cafe', input: '', write: false, table: 'Jobs' };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else if (arg === '--source') opts.source = String(argv[++i] || 'hiring-cafe');
    else if (arg === '--input') opts.input = String(argv[++i] || '');
    else if (arg === '--write') opts.write = true;
    else if (arg === '--dry-run') opts.write = false;
    else if (arg === '--table') opts.table = String(argv[++i] || 'Jobs');
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!opts.input) throw new Error('Missing --input jobs.json');
  return opts;
}

function readRecords(filePath) {
  const parsed = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8').replace(/^\uFEFF/, ''));
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.records)) return parsed.records;
  if (Array.isArray(parsed.jobs)) return parsed.jobs;
  if (Array.isArray(parsed.items)) return parsed.items;
  throw new Error('Input must be a JSON array or object with records/jobs/items array.');
}

async function request(url, body) {
  const token = String(process.env.COMMAND_CENTER_TOKEN || '').trim();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(json.error || text || `HTTP ${res.status}`);
  return json;
}

async function main() {
  const opts = parseArgs(process.argv);
  const baseUrl = String(process.env.COMMAND_CENTER_URL || 'http://host.docker.internal:3000').replace(/\/+$/, '');
  const records = readRecords(opts.input);
  const result = await request(`${baseUrl}/api/prospecting/import`, {
    source: opts.source,
    table: opts.table,
    write: opts.write,
    records,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
