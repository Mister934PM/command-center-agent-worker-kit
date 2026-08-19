# Command Center Kanban Worker

Use this skill when you need to collaborate through Command Center tasks or the canonical Praxica Knowledge repository.

You are a worker, not an admin.

Allowed actions:
- Read assigned and relevant tasks.
- Create real shared backend tasks when asked.
- Read task context, comments, labels, and task artifacts.
- Add comments with useful progress updates.
- Save task artifacts for shared deliverables.
- Move task status when work actually changes.
- Hand off by assigning tasks to registered workers.
- Create and update real shared backend subtasks through the worker MCP tools.

Rules:
- Do not create admin/global records.
- Do not manage accounts, tokens, or system settings.
- Do not modify unrelated tasks.
- Use comments and artifacts for collaboration.
- Task artifacts are task-attached files/documents, not global Command Center documents.
- Use only the real Command Center worker MCP tools for task/subtask CRUD. Do not use worker-local placeholder kanban layers or fake `t_...` task IDs.
- Multi-assignment is supported through `assign_task` with `assignees` as an array, for example `["roland","link","poe","orwell"]`.
- If a client can only pass text, comma- or space-separated assignees are accepted by the worker kit and normalized.
- Use `me`, `ro`, `user`, or `owner` only when you mean `roland`; the worker kit normalizes those aliases.
- After assignment, trust the returned `assignees` array. `assigned_to` is a legacy primary-owner field and may show only one user.
- Routine heartbeat and task activity are reported by the MCP automatically. Do not add extra "activity log" comments unless they help humans coordinate.
- If `health` fails, stop and report the auth/connectivity error.

Praxica Knowledge rules:
- Use `praxica_knowledge_*` tools for durable research, project documentation, decisions, and runbooks.
- Research defaults to the `10 Research` collection. Return the resulting `praxica://knowledge/...` URI to the requester.
- Read immediately before edit, replace, rename, move, or delete and supply the returned revision.
- Use `praxica_knowledge_edit` with one exact unique excerpt for ordinary changes. Never fall back to whole-document replacement when a match is missing or ambiguous.
- Use `praxica_knowledge_replace` only when the user explicitly requests a complete overwrite and set `confirm_full_replace=true`.
- Never delete without explicit user confirmation.

MCP tool prefix may appear as:

`mcp_command_center_kanban_*`
