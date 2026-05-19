#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const home = process.env.USERPROFILE || process.env.HOME || process.cwd();
const workerRoot = process.env.COMMAND_CENTER_WORKER_ROOT || path.resolve(__dirname, '..', '..');
const defaultConfigFile = 'nocodb-mcp.local.json';

function resolveCredentialsDir(configFile = defaultConfigFile) {
  if (process.env.NOCODB_MCP_CREDENTIALS_DIR) {
    return process.env.NOCODB_MCP_CREDENTIALS_DIR;
  }
  const candidates = [
    path.join(home, '.vixxie', 'credentials'),
    path.join(workerRoot, 'credentials'),
  ];
  return candidates.find((dir) => fs.existsSync(path.join(dir, configFile))) || candidates[0];
}

const credentialsDir = resolveCredentialsDir();
const configPath = process.env.NOCODB_MCP_CONFIG || path.join(credentialsDir, defaultConfigFile);
const mcporterConfigPath = process.env.MCPORTER_CONFIG || path.join(home, '.vixxie', 'credentials', 'mcporter.vixxie.json');

function readConfig() {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing NocoDB MCP config: ${configPath}`);
  }
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
  if (!cfg.url || !cfg.headerName || !cfg.token) {
    throw new Error(`Invalid NocoDB MCP config: ${configPath}`);
  }
  return cfg;
}

function ensureMcporterConfig() {
  if (fs.existsSync(mcporterConfigPath)) return;
  fs.mkdirSync(path.dirname(mcporterConfigPath), { recursive: true });
  fs.writeFileSync(mcporterConfigPath, '{"mcpServers":{}}\n', 'utf8');
}

function runMcporter(args) {
  const isWindows = process.platform === 'win32';
  const cliPath = path.join(home, 'AppData', 'Roaming', 'npm', 'node_modules', 'mcporter', 'dist', 'cli.js');
  const bin = isWindows ? process.execPath : 'mcporter';
  ensureMcporterConfig();
  const finalArgs = isWindows ? [cliPath, '--config', mcporterConfigPath, ...args] : ['--config', mcporterConfigPath, ...args];

  const result = spawnSync(bin, finalArgs, {
    stdio: 'inherit',
    shell: false,
    env: { ...process.env },
  });

  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

function remoteArgs(cfg) {
  return [
    '--stdio', 'npx',
    '--stdio-arg', '-y',
    '--stdio-arg', 'mcp-remote',
    '--stdio-arg', cfg.url,
    '--stdio-arg', '--header',
    '--stdio-arg', `${cfg.headerName}: ${cfg.token}`,
  ];
}

const command = process.argv[2] || 'help';
const cfg = readConfig();

if (command === 'help' || command === '--help' || command === '-h') {
  console.log(`NocoDB MCP helper

Usage:
  node nocodb-mcp.js list-tools
  node nocodb-mcp.js base-info
  node nocodb-mcp.js tables
  node nocodb-mcp.js schema <tableId>
  node nocodb-mcp.js records <tableId> [pageSize]
  node nocodb-mcp.js filter <tableId> <field> <operator> <value> [pageSize]
  node nocodb-mcp.js call <toolName> '<jsonArgs>'
  node nocodb-mcp.js call-kv <toolName> key=value key2=value2
`);
  process.exit(0);
}

if (command === 'list-tools') {
  runMcporter(['list', ...remoteArgs(cfg), '--schema', '--json', '--timeout', '60000']);
}

if (command === 'base-info') {
  runMcporter(['call', '--tool', 'getBaseInfo', ...remoteArgs(cfg), '--args', '{}', '--output', 'json', '--timeout', '60000']);
}

if (command === 'tables') {
  runMcporter(['call', '--tool', 'getTablesList', ...remoteArgs(cfg), '--args', '{}', '--output', 'json', '--timeout', '60000']);
}

if (command === 'schema') {
  const tableId = String(process.argv[3] || '').trim();
  if (!tableId) throw new Error('Missing tableId.');
  runMcporter(['call', '--tool', 'getTableSchema', ...remoteArgs(cfg), '--args', JSON.stringify({ tableId }), '--output', 'json', '--timeout', '60000']);
}

if (command === 'records') {
  const tableId = String(process.argv[3] || '').trim();
  const pageSize = Number(process.argv[4] || 20);
  if (!tableId) throw new Error('Missing tableId.');
  runMcporter(['call', '--tool', 'queryRecords', ...remoteArgs(cfg), '--args', JSON.stringify({ tableId, pageSize }), '--output', 'json', '--timeout', '60000']);
}

if (command === 'filter') {
  const tableId = String(process.argv[3] || '').trim();
  const field = String(process.argv[4] || '').trim();
  const operator = String(process.argv[5] || '').trim();
  const value = String(process.argv[6] || '').trim();
  const pageSize = Number(process.argv[7] || 20);
  if (!tableId || !field || !operator) throw new Error('Usage: filter <tableId> <field> <operator> <value> [pageSize]');
  const where = `(${field},${operator},${value})`;
  runMcporter(['call', '--tool', 'queryRecords', ...remoteArgs(cfg), '--args', JSON.stringify({ tableId, pageSize, where }), '--output', 'json', '--timeout', '60000']);
}

if (command === 'call') {
  const toolName = process.argv[3];
  const jsonArgs = process.argv[4] || '{}';
  if (!toolName) throw new Error('Missing tool name.');
  JSON.parse(jsonArgs);
  runMcporter(['call', '--tool', toolName, ...remoteArgs(cfg), '--args', jsonArgs, '--output', 'json', '--timeout', '60000']);
}

if (command === 'call-kv') {
  const toolName = process.argv[3];
  if (!toolName) throw new Error('Missing tool name.');
  const parsed = {};
  for (const arg of process.argv.slice(4)) {
    const index = arg.indexOf('=');
    if (index <= 0) throw new Error(`Expected key=value argument, got: ${arg}`);
    const key = arg.slice(0, index);
    const raw = arg.slice(index + 1);
    if (raw === 'true') parsed[key] = true;
    else if (raw === 'false') parsed[key] = false;
    else if (raw === 'null') parsed[key] = null;
    else if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) parsed[key] = JSON.parse(raw);
    else if (/^-?\d+(\.\d+)?$/.test(raw)) parsed[key] = Number(raw);
    else parsed[key] = raw;
  }
  runMcporter(['call', '--tool', toolName, ...remoteArgs(cfg), '--args', JSON.stringify(parsed), '--output', 'json', '--timeout', '60000']);
}

throw new Error(`Unknown command: ${command}`);

