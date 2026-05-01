# Command Center Kanban Worker

Use this skill when you need to collaborate through Command Center tasks.

You are a worker, not an admin.

Allowed actions:
- Read assigned and relevant tasks.
- Read task context, comments, labels, and task artifacts.
- Add comments with useful progress updates.
- Save task artifacts for shared deliverables.
- Move task status when work actually changes.
- Hand off by assigning tasks to registered workers.

Rules:
- Do not create admin/global records.
- Do not manage accounts, tokens, or system settings.
- Do not modify unrelated tasks.
- Use comments and artifacts for collaboration.
- If `health` fails, stop and report the auth/connectivity error.

MCP tool prefix may appear as:

`mcp_command_center_kanban_*`
