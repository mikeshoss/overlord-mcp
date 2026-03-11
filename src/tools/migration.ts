import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProxmoxClient } from "../services/proxmox-client.js";
import { waitForTask } from "../services/task-poller.js";
import { CHARACTER_LIMIT, DEFAULT_TASK_TIMEOUT } from "../constants.js";
import { VmMigrateSchema } from "../schemas/tools.js";

const MIGRATION_TIMEOUT = 1_800_000; // 30 minutes — migrations can be very slow

export function registerMigrationTools(
  server: McpServer,
  client: ProxmoxClient,
): void {
  // ── overlord_vm_migrate ───────────────────────────────────────────────────
  server.registerTool(
    "overlord_vm_migrate",
    {
      description:
        "Migrate a VM from one Proxmox node to another. Supports both online (live) and " +
        "offline migration.\n\n" +
        "Live migration moves a running VM with minimal downtime — the VM stays up during " +
        "the transfer. Offline migration requires the VM to be stopped first.\n\n" +
        "DISCOVERY: Use overlord_cluster_resources to find the VM's current node (source). " +
        "Use overlord_smart_placement to find the best target node. " +
        "Use overlord_node_metrics to check if a node is overloaded (reason to migrate).\n\n" +
        "Use cases:\n" +
        "  - Load balancing: move VMs off an overloaded node\n" +
        "  - Maintenance: evacuate a node before updates/reboots\n" +
        "  - Storage tiering: move to a node with faster storage\n\n" +
        "Args:\n" +
        "  - node (string, required): Source node where the VM currently lives\n" +
        "  - vmid (number, required): VM ID to migrate\n" +
        "  - target (string, required): Destination node name\n" +
        "  - online (boolean, optional, default true): Live migration (true) or offline (false)\n" +
        "  - with_local_disks (boolean, optional, default true): Migrate local disk volumes too. " +
        "Required for VMs on local storage (local-lvm). Not needed for shared storage (Ceph, NFS).\n" +
        "  - target_storage (string, optional): Move disks to a specific storage on the target node\n\n" +
        "Returns: Migration result with success/failure and timing.\n\n" +
        "Example: { node: 'pve1', vmid: 201, target: 'pve2' }  // live migration\n" +
        "Example: { node: 'pve1', vmid: 201, target: 'pve2', online: false }  // offline migration\n" +
        "Example: { node: 'pve1', vmid: 201, target: 'pve2', target_storage: 'local-lvm' }",
      inputSchema: VmMigrateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ node, vmid, target, online, with_local_disks, target_storage }) => {
      const start = Date.now();

      const data: Record<string, unknown> = {
        target,
        online: (online ?? true) ? 1 : 0,
      };

      if (with_local_disks ?? true) {
        data["with-local-disks"] = 1;
      }
      if (target_storage) {
        data.targetstorage = target_storage;
      }

      const upid = await client.post<string>(
        `nodes/${encodeURIComponent(node)}/qemu/${vmid}/migrate`,
        data,
      );

      const result = await waitForTask(client, node, upid, MIGRATION_TIMEOUT);

      const text = JSON.stringify(
        {
          vmid,
          source_node: node,
          target_node: target,
          online: online ?? true,
          success: result.success,
          exit_status: result.status.exitstatus,
          elapsed_ms: Date.now() - start,
        },
        null,
        2,
      ).slice(0, CHARACTER_LIMIT);

      return {
        content: [{ type: "text" as const, text }],
        isError: !result.success,
      };
    },
  );
}
