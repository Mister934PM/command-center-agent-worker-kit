#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

function loadEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const text = fs.readFileSync(filePath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index < 1) continue;
      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch (_) {}
}

loadEnvFile(path.resolve(__dirname, '..', '..', '.env'));
loadEnvFile(path.resolve(process.cwd(), '.env'));

const SERVER_NAME = 'command-center-kanban-worker';
const SERVER_VERSION = '0.1.0';
const baseUrl = String(process.env.COMMAND_CENTER_URL || 'http://localhost:3000').replace(/\/+$/, '');
const agentName = String(process.env.COMMAND_CENTER_AGENT || 'hermes').trim().toLowerCase() || 'hermes';
const commandCenterToken = String(process.env.COMMAND_CENTER_TOKEN || '').trim();
const actionLogPath = process.env.COMMAND_CENTER_KANBAN_ACTION_LOG || path.join(__dirname, 'action_log.jsonl');
const allowedStatuses = new Set(['todo', 'inprogress', 'done', 'archive']);
const allowedSubtaskStatuses = new Set(['todo', 'inprogress', 'done']);
const allowedPriorities = new Set(['high', 'medium', 'low']);
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
  { name: 'create_task', description: 'Create a real shared Command Center task in the backend task table.', inputSchema: schema({ title: s('Task title.'), description: s('Optional markdown/plain description.'), status: s('todo, inprogress, done, archive. Default todo.'), priority: s('high, medium, low. Default medium.'), assignees: arr('Assignee ids.', { type: 'string' }), due_date: s('Optional due date.'), project_id: n('Optional project id.'), milestone_id: n('Optional milestone id.') }, ['title']) },
  { name: 'delete_task', description: 'Trash a real shared Command Center task.', inputSchema: schema({ id: n('Task id.') }, ['id']) },
  { name: 'get_task_context', description: 'Read one task with comments, mentions, labels, project context.', inputSchema: schema({ id: n('Task id.') }, ['id']) },
  { name: 'add_task_comment', description: 'Add a worker comment to a task.', inputSchema: schema({ id: n('Task id.'), body: s('Comment body.'), mention_urgent: b('Whether mentions are urgent.') }, ['id', 'body']) },
  { name: 'update_task_status', description: 'Move a task to todo, inprogress, done, or archive.', inputSchema: schema({ id: n('Task id.'), status: s('todo, inprogress, done, archive'), comment: s('Optional status-change note.') }, ['id', 'status']) },
  { name: 'assign_task', description: 'Assign task to one or more known workers. Use for handoffs only.', inputSchema: schema({ id: n('Task id.'), assignees: arr('Assignee ids.', { type: 'string' }), comment: s('Optional handoff note.') }, ['id', 'assignees']) },
  { name: 'add_subtask', description: 'Add a real subtask to an existing Command Center task.', inputSchema: schema({ id: n('Parent task id.'), title: s('Subtask title.'), assignees: arr('Assignee ids.', { type: 'string' }), priority: s('high, medium, low. Default medium.'), status: s('todo, inprogress, done. Default todo.'), due_date: s('Optional due date.'), notes: s('Optional notes/description.'), references: arr('Optional brief or artifact paths.', { type: 'string' }) }, ['id', 'title']) },
  { name: 'update_subtask', description: 'Update an existing subtask on a real Command Center task.', inputSchema: schema({ id: n('Parent task id.'), subtask_id: s('Subtask id.'), title: s('Optional title.'), assignees: arr('Assignee ids.', { type: 'string' }), priority: s('high, medium, low.'), status: s('todo, inprogress, done.'), due_date: s('Optional due date.'), notes: s('Optional notes/description.'), references: arr('Optional brief or artifact paths.', { type: 'string' }), is_done: b('Optional explicit completion flag.') }, ['id', 'subtask_id']) },
  { name: 'add_subtask_comment', description: 'Add a comment directly onto a subtask.', inputSchema: schema({ id: n('Parent task id.'), subtask_id: s('Subtask id.'), body: s('Comment body.') }, ['id', 'subtask_id', 'body']) },
  { name: 'save_subtask_artifact', description: 'Save a real task artifact and attach it to a subtask.', inputSchema: schema({ id: n('Parent task id.'), subtask_id: s('Subtask id.'), name: s('Artifact filename.'), content: s('Artifact content.'), comment: b('Add parent task artifact comment, default true.'), comment_body: s('Optional parent task artifact comment body.') }, ['id', 'subtask_id', 'name', 'content']) },
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

function normalizeAssigneeToken(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/^@+/, '');
  if (['me', 'user', 'owner', 'ro', 'roland'].includes(normalized)) return 'roland';
  if (['vix', 'vixxie', 'vicky', 'victoria'].includes(normalized)) return 'vicky';
  return normalized;
}

function normalizeAssignees(input) {
  const values = Array.isArray(input) ? input : String(input || '').split(/[,\s]+/);
  return Array.from(new Set(values
    .map(normalizeAssigneeToken)
    .filter((value) => assigneePattern.test(value))));
}

function taskAssignees(task) {
  return normalizeAssignees(Array.isArray(task?.assignees) ? task.assignees : task?.assigned_to);
}

function assertAssigneesApplied(expected, task) {
  const actual = new Set(taskAssignees(task));
  const missing = expected.filter((assignee) => !actual.has(assignee));
  if (missing.length) throw new Error(`Assignee verification failed: missing ${missing.join(', ')}`);
}

function normalizePriority(value, fallback = 'medium') {
  const normalized = String(value || '').trim().toLowerCase();
  return allowedPriorities.has(normalized) ? normalized : fallback;
}

function normalizeSubtaskStatus(value, fallback = 'todo') {
  const normalized = String(value || '').trim().toLowerCase();
  return allowedSubtaskStatuses.has(normalized) ? normalized : fallback;
}

function generateSubtaskId() {
  return `st-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function getTaskContextOrThrow(taskId) {
  const context = await request('GET', `/api/tasks/${Number(taskId)}/context`);
  if (!context || !context.task) throw new Error(`Task ${taskId} not found.`);
  return context;
}

async function updateTaskSubtasks(taskId, transform) {
  const context = await getTaskContextOrThrow(taskId);
  const currentSubtasks = Array.isArray(context.task.subtasks) ? context.task.subtasks : [];
  const nextSubtasks = transform(currentSubtasks.map((subtask) => ({ ...subtask })), context.task);
  if (!Array.isArray(nextSubtasks)) throw new Error('Subtask transform must return an array.');
  const updatedTask = await request('PUT', `/api/tasks/${Number(taskId)}`, { subtasks: nextSubtasks });
  return { task: updatedTask, subtasks: Array.isArray(updatedTask?.subtasks) ? updatedTask.subtasks : nextSubtasks };
}

function taskIdFromArgs(args) {
  const value = Number(args && args.id);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function toolActivity(name, args) {
  const taskId = taskIdFromArgs(args);
  const suffix = taskId ? ` task #${taskId}` : '';
  return `${String(name || 'tool').replace(/_/g, ' ')}${suffix}`;
}

async function telemetry(method, urlPath, body) {
  if (!commandCenterToken) return null;
  try { return await request(method, urlPath, body); }
  catch (_) { return null; }
}

async function heartbeat(status, activity, args = {}) {
  const taskId = taskIdFromArgs(args);
  await telemetry('POST', '/api/workers/me/heartbeat', {
    status,
    activity,
    current_task_id: taskId,
  });
}

async function workerTaskLog(name, args, level, message, payload = {}) {
  const taskId = taskIdFromArgs(args);
  if (!taskId) return;
  await telemetry('POST', `/api/workers/me/tasks/${taskId}/log`, {
    level,
    message,
    payload: { tool: name, agent: agentName, ...payload },
  });
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
    return limitItems(tasks
      .map((task) => {
        const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
        const mySubtasks = subtasks.filter((subtask) => {
          const subtaskAssignees = Array.isArray(subtask?.assignees) ? subtask.assignees.map((value) => String(value || '').trim().toLowerCase()) : [];
          return subtaskAssignees.includes(agentName) || String(subtask?.assigned_to || '').trim().toLowerCase() === agentName;
        });
        return { ...task, my_subtasks: mySubtasks };
      })
      .filter((task) => {
        const assignees = Array.isArray(task.assignees) ? task.assignees.map((value) => String(value).trim().toLowerCase()) : [String(task.assigned_to || '').trim().toLowerCase()];
        return (assignees.includes(agentName) || task.my_subtasks.length > 0) && (!status || String(task.status) === status) && String(task.status) !== 'archive';
      }), args.limit, 25);
  }

  if (name === 'find_tasks') {
    const q = String(args.query || '').toLowerCase();
    const tasks = await request('GET', '/api/tasks');
    return limitItems(tasks.filter((task) => [task.title, task.description, task.project_name].some((v) => String(v || '').toLowerCase().includes(q))), args.limit, 10);
  }

  if (name === 'create_task') {
    const title = String(args.title || '').trim();
    if (!title) throw new Error('title is required.');
    const payload = {
      title,
      description: String(args.description || ''),
      status: allowedStatuses.has(String(args.status || '').toLowerCase()) ? String(args.status).toLowerCase() : 'todo',
      priority: normalizePriority(args.priority, 'medium'),
      assignees: normalizeAssignees(args.assignees),
      due_date: args.due_date ? String(args.due_date).trim() : null,
    };
    if (Number.isInteger(Number(args.project_id)) && Number(args.project_id) > 0) payload.project_id = Number(args.project_id);
    if (Number.isInteger(Number(args.milestone_id)) && Number(args.milestone_id) > 0) payload.milestone_id = Number(args.milestone_id);
    const data = await request('POST', '/api/tasks', payload);
    log({ tool: name, task_id: Number(data?.id) || null, ok: true });
    return data;
  }

  if (name === 'delete_task') {
    const taskId = Number(args.id);
    if (!Number.isInteger(taskId) || taskId <= 0) throw new Error('Valid task id is required.');
    const data = await request('DELETE', `/api/tasks/${taskId}`);
    log({ tool: name, task_id: taskId, ok: true });
    return data;
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
    const assignees = normalizeAssignees(args.assignees);
    if (!assignees.length) throw new Error('No valid assignees supplied.');
    const data = await request('PUT', `/api/tasks/${Number(args.id)}`, { assignees });
    assertAssigneesApplied(assignees, data);
    if (args.comment) await request('POST', `/api/tasks/${Number(args.id)}/comments`, { author: agentName, body: args.comment, source: 'worker', level: 'info' });
    log({ tool: name, task_id: Number(args.id), assignees, ok: true });
    return data;
  }

  if (name === 'add_subtask') {
    const taskId = Number(args.id);
    if (!Number.isInteger(taskId) || taskId <= 0) throw new Error('Valid task id is required.');
    const title = String(args.title || '').trim();
    if (!title) throw new Error('Subtask title is required.');
    const assignees = normalizeAssignees(args.assignees);
    const payload = {
      id: generateSubtaskId(),
      title,
      is_done: 0,
      status: normalizeSubtaskStatus(args.status, 'todo'),
      priority: normalizePriority(args.priority, 'medium'),
    };
    if (assignees.length) {
      payload.assignees = assignees;
      payload.assigned_to = assignees[0];
    }
    if (args.due_date) payload.due_date = String(args.due_date).trim();
    if (String(args.notes || '').trim()) payload.notes = String(args.notes).trim();
    if (Array.isArray(args.references) && args.references.length) {
      payload.references = Array.from(new Set(args.references.map((value) => String(value || '').trim()).filter(Boolean)));
    }
    const data = await updateTaskSubtasks(taskId, (subtasks) => [...subtasks, payload]);
    return { task_id: taskId, subtask: payload, subtasks: data.subtasks };
  }

  if (name === 'update_subtask') {
    const taskId = Number(args.id);
    const subtaskId = String(args.subtask_id || '').trim();
    if (!Number.isInteger(taskId) || taskId <= 0) throw new Error('Valid task id is required.');
    if (!subtaskId) throw new Error('subtask_id is required.');
    const data = await updateTaskSubtasks(taskId, (subtasks) => {
      const index = subtasks.findIndex((subtask) => String(subtask?.id || '').trim() === subtaskId);
      if (index === -1) throw new Error(`Subtask ${subtaskId} not found on task ${taskId}.`);
      const current = { ...subtasks[index] };
      if (args.title !== undefined) current.title = String(args.title || '').trim();
      if (args.status !== undefined) current.status = normalizeSubtaskStatus(args.status, current.status || 'todo');
      if (args.priority !== undefined) current.priority = normalizePriority(args.priority, current.priority || 'medium');
      if (args.due_date !== undefined) current.due_date = args.due_date ? String(args.due_date).trim() : '';
      if (args.notes !== undefined) current.notes = String(args.notes || '').trim();
      if (args.references !== undefined) {
        current.references = Array.from(new Set((Array.isArray(args.references) ? args.references : []).map((value) => String(value || '').trim()).filter(Boolean)));
      }
      if (args.assignees !== undefined) {
        const assignees = normalizeAssignees(args.assignees);
        current.assignees = assignees;
        current.assigned_to = assignees[0] || '';
      }
      if (args.is_done !== undefined) current.is_done = args.is_done ? 1 : 0;
      if (current.status === 'done') current.is_done = 1;
      if (current.is_done && current.status !== 'done') current.status = 'done';
      subtasks[index] = current;
      return subtasks;
    });
    return { task_id: taskId, subtask_id: subtaskId, subtasks: data.subtasks };
  }

  if (name === 'add_subtask_comment') {
    const taskId = Number(args.id);
    const subtaskId = String(args.subtask_id || '').trim();
    const body = String(args.body || '').trim();
    if (!Number.isInteger(taskId) || taskId <= 0) throw new Error('Valid task id is required.');
    if (!subtaskId) throw new Error('subtask_id is required.');
    if (!body) throw new Error('body is required.');
    const comment = {
      id: `comment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      author: agentName,
      body,
      created_at: new Date().toISOString(),
    };
    const data = await updateTaskSubtasks(taskId, (subtasks) => {
      const index = subtasks.findIndex((subtask) => String(subtask?.id || '').trim() === subtaskId);
      if (index === -1) throw new Error(`Subtask ${subtaskId} not found on task ${taskId}.`);
      const current = { ...subtasks[index] };
      current.comments = Array.isArray(current.comments) ? [...current.comments, comment] : [comment];
      subtasks[index] = current;
      return subtasks;
    });
    return { task_id: taskId, subtask_id: subtaskId, comment, subtasks: data.subtasks };
  }

  if (name === 'save_subtask_artifact') {
    const taskId = Number(args.id);
    const subtaskId = String(args.subtask_id || '').trim();
    if (!Number.isInteger(taskId) || taskId <= 0) throw new Error('Valid task id is required.');
    if (!subtaskId) throw new Error('subtask_id is required.');
    const artifact = await request('POST', `/api/tasks/${taskId}/artifacts`, {
      name: args.name,
      content: args.content,
      comment: args.comment !== false,
      comment_body: args.comment_body,
    });
    const subtaskArtifact = {
      id: `artifact-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name: String(artifact?.name || args.name || '').trim(),
      path: String(artifact?.path || artifact?.relative_path || '').trim(),
      created_at: new Date().toISOString(),
    };
    const data = await updateTaskSubtasks(taskId, (subtasks) => {
      const index = subtasks.findIndex((subtask) => String(subtask?.id || '').trim() === subtaskId);
      if (index === -1) throw new Error(`Subtask ${subtaskId} not found on task ${taskId}.`);
      const current = { ...subtasks[index] };
      current.artifacts = Array.isArray(current.artifacts) ? [...current.artifacts, subtaskArtifact] : [subtaskArtifact];
      subtasks[index] = current;
      return subtasks;
    });
    return { task_id: taskId, subtask_id: subtaskId, artifact, subtask_artifact: subtaskArtifact, subtasks: data.subtasks };
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
    const name = params?.name;
    const args = params?.arguments || {};
    const activity = toolActivity(name, args);
    try {
      await heartbeat('working', activity, args);
      const value = await callTool(name, args);
      log({ tool: name, task_id: taskIdFromArgs(args), ok: true });
      await workerTaskLog(name, args, 'info', `Used ${activity}`, { ok: true });
      await heartbeat('idle', `Last: ${activity}`, args);
      return result(id, textContent(value));
    }
    catch (err) {
      log({ tool: name, task_id: taskIdFromArgs(args), ok: false, error: err.message });
      await workerTaskLog(name, args, 'error', `Failed ${activity}: ${err.message}`, { ok: false });
      await heartbeat('blocked', `Blocked: ${activity}`, args);
      return result(id, { ...textContent({ error: err.message }), isError: true });
    }
  }
  if (method && method.startsWith('notifications/')) return;
  error(id, -32601, `Method not found: ${method}`);
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  try { handle(JSON.parse(line)).catch((err) => error(null, -32603, err.message)); }
  catch (err) { error(null, -32700, err.message); }
});

