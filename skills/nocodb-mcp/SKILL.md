---
name: nocodb-mcp
description: Use NocoDB through mission-scoped base configs. Use when asked to inspect, query, create, update, delete, or summarize records in approved NocoDB bases/tables.
---

# NocoDB MCP

Use this skill when the user asks the agent to work with NocoDB data.

For mission work, prefer the deterministic wrapper:

```powershell
node .\skills\nocodb-mcp\mission-records.js hiring-cafe blog-articles upsert C:\path\to\article.json
node .\skills\nocodb-mcp\mission-records.js praxica seo-keywords upsert C:\path\to\keyword.json
```

This wrapper:
- resolves the live table id by title
- normalizes known field values to the real schema
- avoids raw PowerShell JSON quoting issues
- updates an existing record by `Title` or creates it if missing

## Security

- Tokens live in the worker-local `credentials\` folder.
- Never print or reveal tokens.
- Treat delete and broad update operations as destructive.

## Worker-local config layout

Expected files under:

```text
<worker-root>\credentials\
  nocodb-mcp.local.json
  nocodb-mcp.hiring-cafe.local.json
  nocodb-mcp.praxica.local.json
  nocodb-mcp.sourcedeck.local.json
```

`mission-records.js` and `select-base.ps1` resolve those automatically.

## Commands

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\nocodb-mcp\list-bases.ps1
powershell -ExecutionPolicy Bypass -File .\skills\nocodb-mcp\select-base.ps1 hiring-cafe base-info
powershell -ExecutionPolicy Bypass -File .\skills\nocodb-mcp\select-base.ps1 hiring-cafe tables
powershell -ExecutionPolicy Bypass -File .\skills\nocodb-mcp\select-base.ps1 hiring-cafe schema TABLE_ID
node .\skills\nocodb-mcp\mission-records.js hiring-cafe seo-keywords query 20
node .\skills\nocodb-mcp\mission-records.js hiring-cafe blog-articles upsert C:\path\to\article.json
```

## Available MCP tools

The remote endpoint typically exposes:

- `getBaseInfo`
- `getTablesList`
- `getTableSchema`
- `queryRecords`
- `getRecord`
- `countRecords`
- `createRecords`
- `updateRecords`
- `deleteRecords`
- `aggregate`
- `readAttachment`

## Workflow

1. Use `list-bases.ps1` to see configured base aliases.
2. Use `select-base.ps1 <alias> base-info` to confirm the target base.
3. Use `tables` and `schema` before writing.
4. Prefer `mission-records.js` for `SEO Keywords` and `Blog Articles`.
5. If the config for a base is missing, report the exact missing file path.
