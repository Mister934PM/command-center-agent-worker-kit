# Worker-local NocoDB credentials

Place per-base NocoDB MCP config files in this folder on the remote worker.

Expected names:

- `nocodb-mcp.local.json`
- `nocodb-mcp.hiring-cafe.local.json`
- `nocodb-mcp.praxica.local.json`
- `nocodb-mcp.sourcedeck.local.json`

Each file should contain:

```json
{
  "url": "https://<your-nocodb-mcp-endpoint>",
  "headerName": "xc-token",
  "token": "<secret-token>"
}
```

For Ada to use the Hiring Cafe base, she needs:

- `credentials/nocodb-mcp.hiring-cafe.local.json`

Then she can run:

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\nocodb-mcp\select-base.ps1 hiring-cafe base-info
node .\skills\nocodb-mcp\mission-records.js hiring-cafe blog-articles query 20
```
