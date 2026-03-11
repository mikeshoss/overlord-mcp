import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProxmoxClient } from "../services/proxmox-client.js";
import type { Snapshot } from "../types.js";
import { waitForTask } from "../services/task-poller.js";
import {
  SnapshotListSchema,
  SnapshotCreateSchema,
  SnapshotRollbackSchema,
  SnapshotDeleteSchema,
} from "../schemas/tools.js";
import { DEFAULT_TASK_TIMEOUT, CHARACTER_LIMIT } from "../constants.js";

export function registerSnapshotTools(
  server: McpServer,
  client: ProxmoxClient,
): void {
  // ── overlord_snapshot_list ────────────────────────────────────────────────
  server.registerTool(
    "overlord_snapshot_list",
    {
      description:
        "List all snapshots of a VM with name, description, timestamp, and parent snapshot.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): VM ID\n\n" +
        "Returns: Array of snapshots (excludes the 'current' pseudo-snapshot that Proxmox always includes).\n\n" +
        "Example: { node: 'pve', vmid: 100 }",
      inputSchema: SnapshotListSchema,
      annotations: {
        title: "List Snapshots",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ node, vmid }) => {
      const data = await client.get<Snapshot[]>(
        `nodes/${encodeURIComponent(node)}/qemu/${vmid}/snapshot`,
      );
      // Filter out the "current" pseudo-snapshot Proxmox always includes
      const snapshots = data.filter((s) => s.name !== "current");
      const text = JSON.stringify(snapshots, null, 2).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_snapshot_create ──────────────────────────────────────────────
  server.registerTool(
    "overlord_snapshot_create",
    {
      description:
        "Create a snapshot of a VM, capturing its current disk state (and optionally RAM state).\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): VM ID to snapshot\n" +
        "  - name (string, required): Snapshot name (no spaces allowed)\n" +
        "  - description (string, optional): Snapshot description\n" +
        "  - include_ram (boolean, optional, default false): Capture RAM state (vmstate). " +
        "Slower but captures the exact running state of the VM.\n\n" +
        "Returns: Task result confirming snapshot creation.\n\n" +
        "Example: { node: 'pve', vmid: 100, name: 'before-update', description: 'Pre-update checkpoint' }",
      inputSchema: SnapshotCreateSchema,
      annotations: {
        title: "Create Snapshot",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ node, vmid, name, description, include_ram }) => {
      const params: Record<string, unknown> = {
        snapname: name,
        vmstate: include_ram ? 1 : 0,
      };
      if (description) params.description = description;

      const upid = await client.post<string>(
        `nodes/${encodeURIComponent(node)}/qemu/${vmid}/snapshot`,
        params,
      );
      const result = await waitForTask(client, node, upid);
      const text = JSON.stringify(
        { vmid, node, action: "snapshot_create", name, success: result.success, task: result.status },
        null,
        2,
      ).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_snapshot_rollback ────────────────────────────────────────────
  server.registerTool(
    "overlord_snapshot_rollback",
    {
      description:
        "⚠️ Rollback a VM to a previous snapshot. WARNING: ALL changes made since the snapshot " +
        "will be PERMANENTLY LOST. The VM will be restored to exactly the state it was in when " +
        "the snapshot was taken.\n\n" +
        "DISCOVERY: Call overlord_snapshot_list first to find available snapshot names for this VM.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): VM ID\n" +
        "  - snapname (string, required): Name of the snapshot to rollback to (from overlord_snapshot_list)\n\n" +
        "Returns: Task result confirming rollback.\n\n" +
        "Example: { node: 'pve', vmid: 100, snapname: 'before-update' }",
      inputSchema: SnapshotRollbackSchema,
      annotations: {
        title: "Rollback Snapshot",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ node, vmid, snapname }) => {
      const upid = await client.post<string>(
        `nodes/${encodeURIComponent(node)}/qemu/${vmid}/snapshot/${encodeURIComponent(snapname)}/rollback`,
      );
      const result = await waitForTask(client, node, upid, DEFAULT_TASK_TIMEOUT);
      const text = JSON.stringify(
        { vmid, node, action: "snapshot_rollback", snapname, success: result.success, task: result.status },
        null,
        2,
      ).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_snapshot_delete ──────────────────────────────────────────────
  server.registerTool(
    "overlord_snapshot_delete",
    {
      description:
        "Delete a snapshot from a VM. This removes the snapshot metadata and merges the snapshot " +
        "data. The current VM state is NOT affected.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): VM ID\n" +
        "  - snapname (string, required): Name of the snapshot to delete\n\n" +
        "Returns: Task result confirming deletion.\n\n" +
        "Example: { node: 'pve', vmid: 100, snapname: 'old-snapshot' }",
      inputSchema: SnapshotDeleteSchema,
      annotations: {
        title: "Delete Snapshot",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ node, vmid, snapname }) => {
      const upid = await client.delete<string>(
        `nodes/${encodeURIComponent(node)}/qemu/${vmid}/snapshot/${encodeURIComponent(snapname)}`,
      );
      const result = await waitForTask(client, node, upid);
      const text = JSON.stringify(
        { vmid, node, action: "snapshot_delete", snapname, success: result.success, task: result.status },
        null,
        2,
      ).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );
}
