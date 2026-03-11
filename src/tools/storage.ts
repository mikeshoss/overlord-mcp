import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProxmoxClient } from "../services/proxmox-client.js";
import { CHARACTER_LIMIT } from "../constants.js";
import {
  StorageListSchema,
  StorageStatusSchema,
  StorageContentSchema,
} from "../schemas/tools.js";

export function registerStorageTools(
  server: McpServer,
  client: ProxmoxClient,
): void {
  // ── overlord_storage_list ─────────────────────────────────────────────────
  server.registerTool(
    "overlord_storage_list",
    {
      description:
        "List all storage pools configured in the Proxmox cluster. Shows storage type, " +
        "content types, and which nodes have access.\n\n" +
        "Use this to find available storage before creating VMs, cloning templates, " +
        "or running backups. Essential for capacity planning.\n\n" +
        "Args:\n" +
        "  - node (string, optional): Filter to storage available on a specific node\n" +
        "  - content (string, optional): Filter by content type — 'images' (VM disks), 'backup', 'iso', 'rootdir', 'vztmpl'\n" +
        "  - enabled_only (boolean, optional, default true): Only show enabled storage\n\n" +
        "Returns: List of storage pools with type, content, shared status, and space info.\n\n" +
        "Example: {} — show all cluster storage\n" +
        "Example: { node: 'pve' } — show storage available on pve\n" +
        "Example: { content: 'backup' } — show storage that can hold backups",
      inputSchema: StorageListSchema,
      annotations: {
        title: "List Storage Pools",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ node, content, enabled_only }) => {
      let path: string;
      const params: Record<string, string> = {};

      if (node) {
        // Node-specific storage list includes usage stats
        path = `nodes/${encodeURIComponent(node)}/storage`;
        if (content) params.content = content;
        if (enabled_only ?? true) params.enabled = "1";
      } else {
        // Cluster-wide storage config
        path = "storage";
        if (content) params.content = content;
      }

      const storages = await client.get<Record<string, unknown>[]>(path, params);

      const text = JSON.stringify(
        {
          count: storages.length,
          storages,
        },
        null,
        2,
      ).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_storage_status ───────────────────────────────────────────────
  server.registerTool(
    "overlord_storage_status",
    {
      description:
        "Get detailed status of a specific storage pool on a node, including used/available " +
        "space, active status, and storage type.\n\n" +
        "Use this to check capacity before creating VMs or backups. Shows real-time disk usage.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - storage (string, required): Storage ID (e.g. 'local', 'local-lvm', 'ceph-pool')\n\n" +
        "Returns: Storage status with total/used/available space and health info.\n\n" +
        "Example: { node: 'pve', storage: 'local-lvm' }",
      inputSchema: StorageStatusSchema,
      annotations: {
        title: "Storage Pool Status",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ node, storage }) => {
      const status = await client.get<Record<string, unknown>>(
        `nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/status`,
      );

      const text = JSON.stringify(
        {
          node,
          storage,
          ...status,
        },
        null,
        2,
      ).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_storage_content ──────────────────────────────────────────────
  server.registerTool(
    "overlord_storage_content",
    {
      description:
        "List all volumes/files stored in a specific storage pool. Shows VM disk images, " +
        "ISOs, backups, templates, and other content.\n\n" +
        "Use this to audit what's consuming storage, find ISOs to attach to VMs, " +
        "or locate backup files.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - storage (string, required): Storage ID\n" +
        "  - content (string, optional): Filter by content type — 'images', 'backup', 'iso', 'rootdir', 'vztmpl'\n" +
        "  - vmid (number, optional): Filter by VM ID — show only volumes belonging to a VM\n\n" +
        "Returns: List of volumes with size, format, and ownership info.\n\n" +
        "Example: { node: 'pve', storage: 'local' }\n" +
        "Example: { node: 'pve', storage: 'local', content: 'iso' }  // list ISOs\n" +
        "Example: { node: 'pve', storage: 'local-lvm', vmid: 201 }  // disks for VM 201",
      inputSchema: StorageContentSchema,
      annotations: {
        title: "Browse Storage Content",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ node, storage, content, vmid }) => {
      const params: Record<string, string> = {};
      if (content) params.content = content;
      if (vmid !== undefined) params.vmid = String(vmid);

      const volumes = await client.get<Record<string, unknown>[]>(
        `nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/content`,
        params,
      );

      const text = JSON.stringify(
        {
          node,
          storage,
          count: volumes.length,
          volumes,
        },
        null,
        2,
      ).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );
}
