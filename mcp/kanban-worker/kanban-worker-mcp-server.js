#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const SERVER_NAME = 'command-center-kanban-worker';
const SERVER_VERSION = '0.1.0';
const baseUrl = String(process.env.COMMAND_CENTER_URL || 'http://localhost:3000').replace(/\/+$/, '');
const agentName = String(process.env.COMMAND_CENTER_AGENT || 'hermes').trim().toLowerCase() || 'hermes';
const commandCenterToken = String(process.env.COMMAND_CENTER_TOKEN || '').trim();
const actionLogPath = process.env.COMMAND_CENTER_KANBAN_ACTION_LOG || path.join(__dirname, 'action_log.jsonl');
const allowedStatuses = new Set(['todo', 'inprogress', 'done', 'archive']);
const assigneePattern = /^[a-z0-9_-]{2,64}$/;

function schema(props, required = []) {
  return { type: 'object', properties: props, required, additionalProperties: false };
}
function s(desc) { return { type: 'string', description: desc }; }
function n(desc) { return { type: 'number', description: desc }; }
function b(desc) { return { type: 'boolean', description: desc }; }
function arr(desc, items = { type: 'string' }) { return { type: 'array', description: desc, items }; }

const tools = [
  { name: 'health', description: 'Check Command Center worker access.', inputSchema: schema({}) },
  { name: 'list_my_tasks', description: 'List active tasks assigned to this worker.', inputSchema: schema({ status: s('Optional status filter.'), limit: n('Max tasks, default 25.') }) },
  { name: 'find_tasks', description: 'Find tasks by title/description/project text.', inputSchema: schema({ query: s('Search text.'), limit: n('Max tasks, default 10.') }, ['query']) },
  { name: 'get_task_context', description: 'Read one task with comments, mentions, labels, project context.', inputSchema: schema({ id: n('Task id.') }, ['id']) },
  { name: 'add_task_comment', description: 'Add a worker comment to a task.', inputSchema: schema({ id: n('Task id.'), body: s('Comment body.'), mention_urgent: b('Whether mentions are urgent.') }, ['id', 'body']) },
  { name: 'update_task_status', description: 'Move a task to todo, inprogress, done, or archive.', inputSchema: schema({ id: n('Task id.'), status: s('todo, inprogress, done, archive'), comment: s('Optional status-change note.') }, ['id', 'status']) },
  { name: 'assign_task', description: 'Assign task to one or more known workers. Use for handoffs only.', inputSchema: schema({ id: n('Task id.'), assignees: arr('Assignee ids.', { type: 'string' }), comment: s('Optional handoff note.') }, ['id', 'assignees']) },
  { name: 'list_task_artifacts', description: 'List shared markdown artifacts attached to a task.', inputSchema: schema({ id: n('Task id.') }, ['id']) },
  { name: 'read_task_artifact', description: 'Read a shared task artifact by filename.', inputSchema: schema({ id: n('Task id.'), name: s('Artifact filename.') }, ['id', 'name']) },
  { name: 'save_task_artifact', description: 'Save or overwrite a shared markdown artifact and optionally add a comment.', inputSchema: schema({ id: n('Task id.'), name: s('Artifact filename.'), content: s('Markdown content.'), comment: b('Add artifact comment, default true.'), comment_body: s('Optional comment body.') }, ['id', 'name', 'content']) },
  { name: 'list_labels', description: 'List existing labels for tagging tasks. Does not create labels.', inputSchema: schema({}) },
  { name: 'set_task_labels', description: 'Replace labels on a task using existing label IDs only.', inputSchema: schema({ id: n('Task id.'), label_ids: arr('Existing label IDs.', { type: 'number' }), comment: s('Optional label-change note.') }, ['id', 'label_ids']) },
];

function send(obj) { process.stdout.write(`${JSON.stringify(obj)}\n`); }
function result(id, value) { send({ jsonrpc: '2.0', id, result: value }); }
function error(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }
function textContent(value) { return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }; }

function log(entry) {
  try {
    fs.mkdirSync(path.dirname(actionLogPath), { recursive: true });
    fs.appendFileSync(actionLogPath, `${JSON.stringify({ ts: new Date().toISOString(), agent: agentName, ...entry })}\n`);
  } catch (_) {}
}

async function request(method, urlPath, body) {
  const headers = { 'x-agent': agentName, 'x-actor': agentName, 'content-type': 'application/json' };
  if (commandCenterToken) headers.authorization = `Bearer ${commandCenterToken}`;
  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${urlPath}`, opts);
  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch (_) {}
  if (!res.ok) {
    const msg = data && typeof data === 'object' ? (data.error || data.msg || JSON.stringify(data)) : String(data || res.statusText);
    throw new Error(`${method} ${urlPath} failed ${res.status}: ${msg}`);
  }
  return data;
}

function limitItems(items, limit, fallback) {
  const max = Math.max(1, Math.min(Number(limit) || fallback, 100));
  return items.slice(0, max);
}

async function callTool(name, args) {
  if (name === 'health') {
    const tasks = await request('GET', '/api/tasks');
    return { ok: true, baseUrl, agent: agentName, taskRead: true, visibleTaskCount: Array.isArray(tasks) ? tasks.length : 0 };
  }

  if (name === 'list_my_tasks') {
    const tasks = await request('GET', '/api/tasks');
    const status = args.status ? String(args.status).toLowerCase() : null;
    return limitItems(tasks.filter((task) => {
      const assignees = Array.isArray(task.assignees) ? task.assignees.map(String) : [String(task.assigned_to || '')];
      return assignees.includes(agentName) && (!status || String(task.status) === status) && String(task.status) !== 'archive';
    }), args.limit, 25);
  }

  if (name === 'find_tasks') {
    const q = String(args.query || '').toLowerCase();
    const tasks = await request('GET', '/api/tasks');
    return limitItems(tasks.filter((task) => [task.title, task.description, task.project_name].some((v) => String(v || '').toLowerCase().includes(q))), args.limit, 10);
  }

  if (name === 'get_task_context') return request('GET', `/api/tasks/${Number(args.id)}/context`);

  if (name === 'add_task_comment') {
    const data = await request('POST', `/api/tasks/${Number(args.id)}/comments`, { author: agentName, body: args.body, mention_urgent: Boolean(args.mention_urgent), source: 'worker' });
    log({ tool: name, task_id: Number(args.id), ok: true });
    return data;
  }

  if (name === 'update_task_status') {
    const status = String(args.status || '').toLowerCase();
    if (!allowedStatuses.has(status)) throw new Error(`Invalid status: ${status}`);
    const data = await request('PUT', `/api/tasks/${Number(args.id)}`, { status });
    if (args.comment) await request('POST', `/api/tasks/${Number(args.id)}/comments`, { author: agentName, body: args.comment, source: 'worker', level: 'info' });
    log({ tool: name, task_id: Number(args.id), status, ok: true });
    return data;
  }

  if (name === 'assign_task') {
    const assignees = Array.from(new Set((args.assignees || []).map((v) => String(v).trim().toLowerCase()).filter((v) => assigneePattern.test(v))));
    if (!assignees.length) throw new Error('No valid assignees supplied.');
    const data = await request('PUT', `/api/tasks/${Number(args.id)}`, { assignees });
    if (args.comment) await request('POST', `/api/tasks/${Number(args.id)}/comments`, { author: agentName, body: args.comment, source: 'worker', level: 'info' });
    log({ tool: name, task_id: Number(args.id), assignees, ok: true });
    return data;
  }

  if (name === 'list_task_artifacts') return request('GET', `/api/tasks/${Number(args.id)}/artifacts`);
  if (name === 'read_task_artifact') return request('GET', `/api/tasks/${Number(args.id)}/artifacts/${encodeURIComponent(args.name)}`);
  if (name === 'save_task_artifact') {
    const data = await request('POST', `/api/tasks/${Number(args.id)}/artifacts`, { name: args.name, content: args.content, comment: args.comment !== false, comment_body: args.comment_body });
    log({ tool: name, task_id: Number(args.id), artifact: args.name, ok: true });
    return data;
  }

  if (name === 'list_labels') return request('GET', '/api/labels');
  if (name === 'set_task_labels') {
    const label_ids = Array.isArray(args.label_ids) ? args.label_ids.map(Number).filter((v) => Number.isInteger(v) && v > 0) : [];
    const data = await request('PUT', `/api/tasks/${Number(args.id)}`, { label_ids });
    if (args.comment) await request('POST', `/api/tasks/${Number(args.id)}/comments`, { author: agentName, body: args.comment, source: 'worker', level: 'info' });
    log({ tool: name, task_id: Number(args.id), label_ids, ok: true });
    return data;
  }

  throw new Error(`Unknown tool: ${name}`);
}

async function handle(message) {
  const { id, method, params } = message;
  if (method === 'initialize') return result(id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: SERVER_NAME, version: SERVER_VERSION } });
  if (method === 'tools/list') return result(id, { tools });
  if (method === 'tools/call') {
    try { return result(id, textContent(await callTool(params?.name, params?.arguments || {}))); }
    catch (err) { return result(id, { ...textContent({ error: err.message }), isError: true }); }
  }
  if (method && method.startsWith('notifications/')) return;
  error(id, -32601, `Method not found: ${method}`);
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  try { handle(JSON.parse(line)).catch((err) => error(null, -32603, err.message)); }
  catch (err) { error(null, -32700, err.message); }
});

