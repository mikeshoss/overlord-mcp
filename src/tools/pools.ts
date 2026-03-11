import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProxmoxClient } from "../services/proxmox-client.js";
import { CHARACTER_LIMIT } from "../constants.js";
import { PoolListSchema, PoolCreateSchema, PoolGetSchema, PoolUpdateSchema } from "../schemas/tools.js";

export function registerPoolTools(
  server: McpServer,
  client: ProxmoxClient,
): void {
  // ── overlord_pool_list ────────────────────────────────────────────────────
  server.registerTool(
    "overlord_pool_list",
    {
      description:
        "List all resource pools. Pools organize VMs, containers, and storage into logical groups " +
        "for access control and organization.\n\n" +
        "Args: None\n\n" +
        "Returns: List of pools.\n\n" +
        "Example: {}",
      inputSchema: PoolListSchema,
      annotations: { title: "List Resource Pools", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const pools = await client.get<Record<string, unknown>[]>("pools");
      const text = JSON.stringify(pools, null, 2).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_pool_get ─────────────────────────────────────────────────────
  server.registerTool(
    "overlord_pool_get",
    {
      description:
        "Get details of a resource pool including its members (VMs, containers, storage).\n\n" +
        "Args:\n" +
        "  - poolid (string, required): Pool name\n\n" +
        "Returns: Pool details and member list.\n\n" +
        "Example: { poolid: 'production' }",
      inputSchema: PoolGetSchema,
      annotations: { title: "Get Resource Pool", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ poolid }) => {
      const pool = await client.get<Record<string, unknown>>(
        `pools/${encodeURIComponent(poolid)}`,
      );
      const text = JSON.stringify(pool, null, 2).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_pool_create ──────────────────────────────────────────────────
  server.registerTool(
    "overlord_pool_create",
    {
      description:
        "Create a new resource pool.\n\n" +
        "Args:\n" +
        "  - poolid (string, required): Pool name (no spaces)\n" +
        "  - comment (string, optional): Description\n\n" +
        "Returns: Confirmation.\n\n" +
        "Example: { poolid: 'dev-team', comment: 'Development team resources' }",
      inputSchema: PoolCreateSchema,
      annotations: { title: "Create Resource Pool", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ poolid, comment }) => {
      const data: Record<string, unknown> = { poolid };
      if (comment) data.comment = comment;
      await client.post("pools", data);
      const text = JSON.stringify({ created: poolid }, null, 2);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_pool_update ──────────────────────────────────────────────────
  server.registerTool(
    "overlord_pool_update",
    {
      description:
        "Add or remove VMs/containers/storage from a resource pool.\n\n" +
        "DISCOVERY: Call overlord_pool_get to see current pool members. " +
        "Call overlord_cluster_resources to find VMIDs to add.\n\n" +
        "HOW IT WORKS:\n" +
        "  - To ADD: pass vms and/or storage with delete_members=false (default)\n" +
        "  - To REMOVE: pass the same vms/storage AND set delete_members=true\n\n" +
        "Args:\n" +
        "  - poolid (string, required): Pool name\n" +
        "  - vms (string, optional): Comma-separated VM/container IDs (e.g. '201,202,300')\n" +
        "  - storage (string, optional): Comma-separated storage IDs (e.g. 'local-lvm')\n" +
        "  - delete_members (boolean, optional, default false): false=add, true=remove\n\n" +
        "Returns: Confirmation.\n\n" +
        "Example: { poolid: 'production', vms: '201,202' } — add VMs 201 and 202\n" +
        "Example: { poolid: 'production', vms: '201', delete_members: true } — remove VM 201 from pool",
      inputSchema: PoolUpdateSchema,
      annotations: { title: "Update Resource Pool", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ poolid, vms, storage, delete_members }) => {
      const data: Record<string, unknown> = {};
      if (vms) data.vms = vms;
      if (storage) data.storage = storage;
      if (delete_members) data.delete = 1;

      await client.put(`pools/${encodeURIComponent(poolid)}`, data);
      const text = JSON.stringify(
        { poolid, action: delete_members ? "removed" : "added", vms, storage },
        null, 2,
      );
      return { content: [{ type: "text" as const, text }] };
    },
  );
}
