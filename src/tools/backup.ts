import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProxmoxClient } from "../services/proxmox-client.js";
import { waitForTask } from "../services/task-poller.js";
import { CHARACTER_LIMIT } from "../constants.js";
import {
  BackupCreateSchema,
  BackupListSchema,
  BackupRestoreSchema,
  BackupDeleteSchema,
} from "../schemas/tools.js";

const BACKUP_TIMEOUT = 3_600_000; // 60 minutes — backups can be very slow

export function registerBackupTools(
  server: McpServer,
  client: ProxmoxClient,
): void {
  // ── overlord_backup_list ──────────────────────────────────────────────────
  server.registerTool(
    "overlord_backup_list",
    {
      description:
        "List all backups stored on a specific storage. Use this to find existing backups " +
        "before restoring, or to audit backup coverage.\n\n" +
        "DISCOVERY: Use overlord_storage_list to find storage pool names. The returned 'volid' values are " +
        "the 'archive' parameter needed by overlord_backup_restore and the 'volume' parameter for overlord_backup_delete.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name (from overlord_cluster_status)\n" +
        "  - storage (string, required): Storage ID where backups are kept (from overlord_storage_list, e.g. 'local', 'nfs-backup')\n" +
        "  - vmid (number, optional): Filter by VM ID — show only backups of a specific VM\n\n" +
        "Returns: List of backup volumes with size, date, and VM ID.\n\n" +
        "Example: { node: 'pve', storage: 'local' }\n" +
        "Example: { node: 'pve', storage: 'local', vmid: 201 }",
      inputSchema: BackupListSchema,
      annotations: {
        title: "List Backups",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ node, storage, vmid }) => {
      const params: Record<string, string> = { content: "backup" };
      if (vmid !== undefined) {
        params.vmid = String(vmid);
      }

      const volumes = await client.get<Record<string, unknown>[]>(
        `nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/content`,
        params,
      );

      // Filter to backup content type
      const backups = volumes.filter(
        (v) => v.content === "backup" || (v.volid as string)?.includes("backup"),
      );

      const text = JSON.stringify(
        {
          node,
          storage,
          count: backups.length,
          backups,
        },
        null,
        2,
      ).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_backup_create ────────────────────────────────────────────────
  server.registerTool(
    "overlord_backup_create",
    {
      description:
        "Create a backup of a VM. Backups are stored on Proxmox storage and survive VM deletion " +
        "(unlike snapshots). Use for disaster recovery, before risky changes, or scheduled protection.\n\n" +
        "DISCOVERY: Use overlord_storage_list to find storage pool names for the 'storage' parameter. " +
        "Use overlord_cluster_resources to find VMIDs.\n\n" +
        "Backup modes (listed from least to most disruptive):\n" +
        "  - snapshot (default): VM keeps running. Uses storage-level snapshots (LVM/ZFS). " +
        "Fastest, minimal impact, but filesystem inside VM may not be 100% consistent.\n" +
        "  - suspend: Pauses VM briefly during backup. More consistent than snapshot but causes brief downtime.\n" +
        "  - stop: Stops VM entirely during backup. Most consistent state, but VM goes fully offline.\n\n" +
        "Compression:\n" +
        "  - zstd (default): Fast with good compression ratio\n" +
        "  - lzo: Faster but larger files\n" +
        "  - gzip: Slower but widely compatible\n" +
        "  - none: No compression — fastest but largest\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): VM ID to backup\n" +
        "  - storage (string, required): Target storage for the backup (e.g. 'local', 'nfs-backup')\n" +
        "  - mode (string, optional, default 'snapshot'): Backup mode — 'snapshot', 'suspend', or 'stop'\n" +
        "  - compress (string, optional, default 'zstd'): Compression — 'zstd', 'lzo', 'gzip', 'none'\n" +
        "  - notes (string, optional): Descriptive notes for this backup\n\n" +
        "Returns: Backup result with success/failure, volume ID, and timing.\n\n" +
        "Example: { node: 'pve', vmid: 201, storage: 'local' }\n" +
        "Example: { node: 'pve', vmid: 201, storage: 'nfs-backup', mode: 'stop', compress: 'zstd', notes: 'pre-upgrade backup' }",
      inputSchema: BackupCreateSchema,
      annotations: {
        title: "Create Backup",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ node, vmid, storage, mode, compress, notes }) => {
      const start = Date.now();

      const data: Record<string, unknown> = {
        vmid,
        storage,
        mode: mode ?? "snapshot",
        compress: compress ?? "zstd",
      };
      if (notes) data.notes = notes;

      const upid = await client.post<string>(
        `nodes/${encodeURIComponent(node)}/vzdump`,
        data,
      );

      const result = await waitForTask(client, node, upid, BACKUP_TIMEOUT);

      const text = JSON.stringify(
        {
          vmid,
          node,
          storage,
          mode: mode ?? "snapshot",
          compress: compress ?? "zstd",
          success: result.success,
          exit_status: result.status.exitstatus,
          elapsed_ms: Date.now() - start,
          note: result.success
            ? "Backup completed. Use overlord_backup_list to see stored backups."
            : "Backup failed. Check Proxmox task logs for details.",
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

  // ── overlord_backup_restore ───────────────────────────────────────────────
  server.registerTool(
    "overlord_backup_restore",
    {
      description:
        "Restore a VM from a backup. This creates (or overwrites) a VM from a previously stored backup.\n\n" +
        "DISCOVERY: Call overlord_backup_list first to find the 'archive' value (the volid field from the backup list).\n\n" +
        "WARNING: If the target VMID already exists and force=true, the existing VM will be " +
        "DESTROYED and replaced. This is irreversible.\n\n" +
        "The restored VM will be in a stopped state. Use start_after_restore=true or call overlord_vm_start afterward.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node to restore onto\n" +
        "  - vmid (number, required): VM ID for the restored VM\n" +
        "  - archive (string, required): Backup volume ID (from overlord_backup_list volid field, e.g. 'local:backup/vzdump-qemu-201-2024_01_15-12_00_00.vma.zst')\n" +
        "  - storage (string, optional): Target storage for restored disks (defaults to original)\n" +
        "  - force (boolean, optional, default false): Overwrite existing VM with same VMID\n" +
        "  - start_after_restore (boolean, optional, default false): Start VM after restore completes\n\n" +
        "Returns: Restore result with success/failure.\n\n" +
        "Example: { node: 'pve', vmid: 201, archive: 'local:backup/vzdump-qemu-201-2024_01_15-12_00_00.vma.zst' }",
      inputSchema: BackupRestoreSchema,
      annotations: {
        title: "Restore from Backup",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ node, vmid, archive, storage, force, start_after_restore }) => {
      const start = Date.now();

      const data: Record<string, unknown> = {
        vmid,
        archive,
      };
      if (storage) data.storage = storage;
      if (force) data.force = 1;

      const upid = await client.post<string>(
        `nodes/${encodeURIComponent(node)}/qemu`,
        data,
      );

      const result = await waitForTask(client, node, upid, BACKUP_TIMEOUT);

      if (result.success && start_after_restore) {
        try {
          const startUpid = await client.post<string>(
            `nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/start`,
          );
          await waitForTask(client, node, startUpid);
        } catch (err) {
          // Non-fatal — restore succeeded, start failed
          const text = JSON.stringify(
            {
              vmid,
              node,
              archive,
              restore_success: true,
              start_success: false,
              start_error: err instanceof Error ? err.message : String(err),
              elapsed_ms: Date.now() - start,
            },
            null,
            2,
          );
          return { content: [{ type: "text" as const, text }] };
        }
      }

      const text = JSON.stringify(
        {
          vmid,
          node,
          archive,
          success: result.success,
          started: result.success && (start_after_restore ?? false),
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

  // ── overlord_backup_delete ────────────────────────────────────────────────
  server.registerTool(
    "overlord_backup_delete",
    {
      description:
        "Delete a backup volume from storage.\n\n" +
        "WARNING: This permanently destroys the backup. Make sure you don't need it.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - storage (string, required): Storage ID where the backup is stored\n" +
        "  - volume (string, required): Backup volume ID (from overlord_backup_list)\n\n" +
        "Returns: Confirmation of deletion.\n\n" +
        "Example: { node: 'pve', storage: 'local', volume: 'local:backup/vzdump-qemu-201-2024_01_15-12_00_00.vma.zst' }",
      inputSchema: BackupDeleteSchema,
      annotations: {
        title: "Delete Backup",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ node, storage, volume }) => {
      // The Proxmox API uses the volume ID in the path
      const upid = await client.delete<string>(
        `nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/content/${encodeURIComponent(volume)}`,
      );

      // Some storage backends return a task ID, others delete synchronously
      if (typeof upid === "string" && upid.startsWith("UPID:")) {
        await waitForTask(client, node, upid);
      }

      const text = JSON.stringify(
        {
          deleted: volume,
          storage,
          node,
        },
        null,
        2,
      );
      return { content: [{ type: "text" as const, text }] };
    },
  );
}
