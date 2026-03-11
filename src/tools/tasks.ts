import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProxmoxClient } from "../services/proxmox-client.js";
import { CHARACTER_LIMIT } from "../constants.js";
import { TaskListSchema, TaskStatusSchema, TaskLogSchema } from "../schemas/tools.js";

export function registerTaskTools(
  server: McpServer,
  client: ProxmoxClient,
): void {
  // ── overlord_task_list ────────────────────────────────────────────────────
  server.registerTool(
    "overlord_task_list",
    {
      description:
        "List recent tasks on a Proxmox node. Shows both running and completed tasks " +
        "including clones, backups, migrations, and VM operations.\n\n" +
        "Use this to monitor running operations, debug failures, or audit activity.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - limit (number, optional, default 50): Max tasks to return\n" +
        "  - running (boolean, optional): Only show running tasks (true) or all tasks\n" +
        "  - vmid (number, optional): Filter by VM ID\n" +
        "  - type_filter (string, optional): Filter by task type (e.g. 'qmclone', 'vzdump', 'qmigrate')\n\n" +
        "Returns: List of tasks with UPID, status, type, start time, and owner.\n\n" +
        "Example: { node: 'pve' } — recent tasks\n" +
        "Example: { node: 'pve', running: true } — only active tasks\n" +
        "Example: { node: 'pve', vmid: 201 } — tasks for VM 201",
      inputSchema: TaskListSchema,
      annotations: { title: "List Tasks", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ node, limit, running, vmid, type_filter }) => {
      const params: Record<string, string> = {};
      if (limit) params.limit = String(limit);
      if (running !== undefined) params.running = running ? "1" : "0";
      if (vmid !== undefined) params.vmid = String(vmid);
      if (type_filter) params.typefilter = type_filter;

      const tasks = await client.get<Record<string, unknown>[]>(
        `nodes/${encodeURIComponent(node)}/tasks`,
        params,
      );

      const text = JSON.stringify({ node, count: tasks.length, tasks }, null, 2).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_task_status ──────────────────────────────────────────────────
  server.registerTool(
    "overlord_task_status",
    {
      description:
        "Get the status of a specific task by its UPID (Unique Process ID). " +
        "Use this to check if a long-running operation has completed.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - upid (string, required): Task UPID (from task list or tool responses)\n\n" +
        "Returns: Task status, exit status, and timing.\n\n" +
        "Example: { node: 'pve', upid: 'UPID:pve:...' }",
      inputSchema: TaskStatusSchema,
      annotations: { title: "Task Status", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ node, upid }) => {
      const status = await client.get<Record<string, unknown>>(
        `nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/status`,
      );

      const text = JSON.stringify(status, null, 2).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_task_log ─────────────────────────────────────────────────────
  server.registerTool(
    "overlord_task_log",
    {
      description:
        "Read the log output of a task. Essential for debugging failed operations — " +
        "shows detailed output of what happened during a backup, clone, migration, etc.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - upid (string, required): Task UPID\n" +
        "  - limit (number, optional, default 500): Max log lines\n" +
        "  - start (number, optional, default 0): Start from line number\n\n" +
        "Returns: Task log lines.\n\n" +
        "Example: { node: 'pve', upid: 'UPID:pve:...' }",
      inputSchema: TaskLogSchema,
      annotations: { title: "Task Log", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ node, upid, limit, start }) => {
      const params: Record<string, string> = {};
      if (limit) params.limit = String(limit);
      if (start) params.start = String(start);

      const lines = await client.get<Record<string, unknown>[]>(
        `nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/log`,
        params,
      );

      const text = JSON.stringify({ upid, lines }, null, 2).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );
}
