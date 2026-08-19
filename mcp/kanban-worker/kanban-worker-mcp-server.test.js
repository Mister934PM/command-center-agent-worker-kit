'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const serverPath = path.join(__dirname, 'kanban-worker-mcp-server.js');

async function fixture() {
  const requests = [];
  const api = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    requests.push({ method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : undefined });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, document: { id: '20260814120000-abcdefg', uri: 'praxica://knowledge/20260814120000-abcdefg', revision: 'rev-2' } }));
  });
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'command-center-worker-mcp-'));
  const tokenFile = path.join(tempDir, 'credential.json');
  fs.writeFileSync(tokenFile, JSON.stringify({ token: 'ccw_hermes_fixture-secret' }), 'utf8');
  const address = api.address();
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      COMMAND_CENTER_URL: `http://127.0.0.1:${address.port}`,
      COMMAND_CENTER_AGENT: 'hermes',
      COMMAND_CENTER_TOKEN: '',
      COMMAND_CENTER_TOKEN_FILE: tokenFile,
      COMMAND_CENTER_KANBAN_ACTION_LOG: path.join(tempDir, 'action.jsonl'),
      PRAXICA_KNOWLEDGE_DEFAULT_COLLECTION: '10 Research',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let buffer = '';
  const pending = [];
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n');
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      pending.shift()?.(JSON.parse(line));
    }
  });
  let id = 0;
  const rpc = (method, params) => new Promise((resolve) => {
    pending.push(resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params })}\n`);
  });

  return {
    requests,
    rpc,
    close: async () => {
      child.stdin.end();
      await new Promise((resolve) => child.once('exit', resolve));
      await new Promise((resolve) => api.close(resolve));
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

test('exposes Kanban and Praxica Knowledge through one worker MCP', async () => {
  const f = await fixture();
  try {
    const response = await f.rpc('tools/list');
    const names = response.result.tools.map((tool) => tool.name);
    assert.ok(names.includes('list_my_tasks'));
    assert.ok(names.includes('praxica_knowledge_search'));
    assert.ok(names.includes('praxica_knowledge_create'));
    assert.ok(names.includes('praxica_knowledge_edit'));
    assert.ok(names.includes('praxica_knowledge_delete'));
    assert.equal(names.includes('list_invoices'), false);
    assert.equal(names.includes('list_chat_rooms'), false);
  } finally {
    await f.close();
  }
});

test('uses the same worker token and defaults durable output to 10 Research', async () => {
  const f = await fixture();
  try {
    const call = {
      name: 'praxica_knowledge_create',
      arguments: { title: 'Remote Agent Survey', markdown: 'Findings.' },
    };
    await f.rpc('tools/call', call);
    await f.rpc('tools/call', call);
    const creates = f.requests.filter((request) => request.method === 'POST' && request.url === '/api/praxica-knowledge/documents');
    assert.equal(creates.length, 2);
    assert.equal(creates[0].headers.authorization, 'Bearer ccw_hermes_fixture-secret');
    assert.equal(creates[0].body.path, '/10 Research/Remote Agent Survey');
    assert.equal(creates[0].headers['idempotency-key'], creates[1].headers['idempotency-key']);
  } finally {
    await f.close();
  }
});

test('blocks knowledge deletion without an explicit confirmation flag', async () => {
  const f = await fixture();
  try {
    const response = await f.rpc('tools/call', {
      name: 'praxica_knowledge_delete',
      arguments: { document_id: '20260814120000-abcdefg', expected_revision: 'rev-1', confirm: false },
    });
    assert.equal(response.result.isError, true);
    assert.equal(f.requests.some((request) => request.method === 'DELETE'), false);
  } finally {
    await f.close();
  }
});

test('workers use targeted Knowledge edits and cannot silently replace whole documents', async () => {
  const f = await fixture();
  try {
    await f.rpc('tools/call', {
      name: 'praxica_knowledge_edit',
      arguments: {
        document_id: '20260814120000-abcdefg',
        old_text: 'Original amount: $6,000',
        new_text: 'Original amount: $6,500',
        expected_revision: 'rev-1',
      },
    });
    const editRequest = f.requests.find((request) => request.url === '/api/praxica-knowledge/documents/20260814120000-abcdefg/edit');
    assert.ok(editRequest);
    assert.equal(editRequest.body.oldText, 'Original amount: $6,000');

    const blocked = await f.rpc('tools/call', {
      name: 'praxica_knowledge_replace',
      arguments: { document_id: '20260814120000-abcdefg', markdown: '# New body', expected_revision: 'rev-1' },
    });
    assert.equal(blocked.result.isError, true);
    assert.equal(
      f.requests.filter((request) => request.url.startsWith('/api/praxica-knowledge/documents/')).length,
      1
    );
  } finally {
    await f.close();
  }
});
