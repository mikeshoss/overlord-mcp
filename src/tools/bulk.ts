import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProxmoxClient } from "../services/proxmox-client.js";
import { waitForTask } from "../services/task-poller.js";
import { CHARACTER_LIMIT, DEFAULT_TASK_TIMEOUT } from "../constants.js";
import { BulkActionSchema } from "../schemas/tools.js";

export function registerBulkTools(
  server: McpServer,
  client: ProxmoxClient,
): void {
  // ── overlord_bulk_action ──────────────────────────────────────────────────
  server.registerTool(
    "overlord_bulk_action",
    {
      description:
        "Perform an action on multiple VMs/containers simultaneously. " +
        "All operations run in parallel for speed.\n\n" +
        "Supported actions:\n" +
        "  - start: Start all specified VMs\n" +
        "  - stop: Hard-stop all specified VMs\n" +
        "  - shutdown: Graceful ACPI shutdown all specified VMs\n" +
        "  - reboot: Reboot all specified VMs\n" +
        "  - snapshot: Create a snapshot on all specified VMs\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmids (number[], required): Array of VM/container IDs\n" +
        "  - action (string, required): Action to perform\n" +
        "  - snapshot_name (string, optional): Required when action='snapshot'\n\n" +
        "Returns: Per-VM results with success/failure.\n\n" +
        "Example: { node: 'pve', vmids: [201, 202, 203], action: 'start' }\n" +
        "Example: { node: 'pve', vmids: [201, 202], action: 'snapshot', snapshot_name: 'pre-deploy' }",
      inputSchema: BulkActionSchema,
      annotations: { title: "Bulk VM Action", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ node, vmids, action, snapshot_name }) => {
      if (action === "snapshot" && !snapshot_name) {
        const text = JSON.stringify({ error: "snapshot_name is required when action='snapshot'" }, null, 2);
        return { content: [{ type: "text" as const, text }], isError: true };
      }

      const results = await Promise.allSettled(
        vmids.map(async (vmid) => {
          const start = Date.now();
          let path: string;
          let data: Record<string, unknown> | undefined;

          switch (action) {
            case "start":
              path = `nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/start`;
              break;
            case "stop":
              path = `nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/stop`;
              break;
            case "shutdown":
              path = `nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/shutdown`;
              data = { timeout: 120 };
              break;
            case "reboot":
              path = `nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/reboot`;
              break;
            case "snapshot":
              path = `nodes/${encodeURIComponent(node)}/qemu/${vmid}/snapshot`;
              data = { snapname: snapshot_name! };
              break;
            default:
              throw new Error(`Unknown action: ${action}`);
          }

          const upid = await client.post<string>(path, data);
          const taskResult = await waitForTask(client, node, upid, DEFAULT_TASK_TIMEOUT);

          return {
            vmid,
            success: taskResult.success,
            elapsed_ms: Date.now() - start,
          };
        }),
      );

      const formatted = results.map((r, i) => {
        if (r.status === "fulfilled") return r.value;
        return { vmid: vmids[i], success: false, error: r.reason?.message ?? String(r.reason) };
      });

      const allSuccess = formatted.every((r) => r.success);
      const text = JSON.stringify(
        { node, action, count: vmids.length, all_success: allSuccess, results: formatted },
        null, 2,
      ).slice(0, CHARACTER_LIMIT);

      return { content: [{ type: "text" as const, text }], isError: !allSuccess };
    },
  );
}
