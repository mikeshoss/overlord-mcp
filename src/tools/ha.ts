import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProxmoxClient } from "../services/proxmox-client.js";
import { CHARACTER_LIMIT } from "../constants.js";
import {
  HaResourceListSchema,
  HaResourceCreateSchema,
  HaResourceDeleteSchema,
  HaGroupListSchema,
  HaGroupCreateSchema,
} from "../schemas/tools.js";

export function registerHaTools(
  server: McpServer,
  client: ProxmoxClient,
): void {
  // ── overlord_ha_resource_list ─────────────────────────────────────────────
  server.registerTool(
    "overlord_ha_resource_list",
    {
      description:
        "List all HA-managed resources. Shows which VMs/containers are configured for " +
        "automatic failover if their host node goes down.\n\n" +
        "Args: None\n\n" +
        "Returns: List of HA resources with state, group, and max_restart/max_relocate settings.\n\n" +
        "Example: {}",
      inputSchema: HaResourceListSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      const resources = await client.get<Record<string, unknown>[]>("cluster/ha/resources");
      const text = JSON.stringify(resources, null, 2).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_ha_resource_create ───────────────────────────────────────────
  server.registerTool(
    "overlord_ha_resource_create",
    {
      description:
        "Add a VM or container to HA management. Once added, Proxmox will automatically " +
        "restart or relocate the VM if its host node fails.\n\n" +
        "Args:\n" +
        "  - sid (string, required): Service ID — format 'vm:VMID' or 'ct:VMID' (e.g. 'vm:201')\n" +
        "  - group (string, optional): HA group to assign to (determines preferred nodes)\n" +
        "  - state (string, optional, default 'started'): Desired state — 'started', 'stopped', 'enabled', 'disabled'\n" +
        "  - max_restart (number, optional, default 1): Max restart attempts on same node\n" +
        "  - max_relocate (number, optional, default 1): Max relocate attempts to other nodes\n" +
        "  - comment (string, optional): Description\n\n" +
        "Returns: Confirmation.\n\n" +
        "Example: { sid: 'vm:201', state: 'started', max_restart: 3, max_relocate: 2 }\n" +
        "Example: { sid: 'vm:201', group: 'production' }",
      inputSchema: HaResourceCreateSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ sid, group, state, max_restart, max_relocate, comment }) => {
      const data: Record<string, unknown> = {
        sid,
        state: state ?? "started",
        max_restart: max_restart ?? 1,
        max_relocate: max_relocate ?? 1,
      };
      if (group) data.group = group;
      if (comment) data.comment = comment;

      await client.post("cluster/ha/resources", data);
      const text = JSON.stringify({ created: sid, state: state ?? "started" }, null, 2);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_ha_resource_delete ───────────────────────────────────────────
  server.registerTool(
    "overlord_ha_resource_delete",
    {
      description:
        "Remove a VM/container from HA management. The VM will no longer be " +
        "automatically restarted or relocated on node failure.\n\n" +
        "Args:\n" +
        "  - sid (string, required): Service ID (e.g. 'vm:201')\n\n" +
        "Returns: Confirmation.\n\n" +
        "Example: { sid: 'vm:201' }",
      inputSchema: HaResourceDeleteSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ sid }) => {
      await client.delete(`cluster/ha/resources/${encodeURIComponent(sid)}`);
      const text = JSON.stringify({ deleted: sid }, null, 2);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_ha_group_list ────────────────────────────────────────────────
  server.registerTool(
    "overlord_ha_group_list",
    {
      description:
        "List all HA groups. Groups define which nodes can host HA resources " +
        "and their priority.\n\n" +
        "Args: None\n\n" +
        "Returns: List of HA groups with node assignments.\n\n" +
        "Example: {}",
      inputSchema: HaGroupListSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      const groups = await client.get<Record<string, unknown>[]>("cluster/ha/groups");
      const text = JSON.stringify(groups, null, 2).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_ha_group_create ──────────────────────────────────────────────
  server.registerTool(
    "overlord_ha_group_create",
    {
      description:
        "Create an HA group. Groups define preferred nodes for HA resources.\n\n" +
        "Node format: 'node1:priority,node2:priority' — higher priority = preferred.\n\n" +
        "Args:\n" +
        "  - group (string, required): Group name\n" +
        "  - nodes (string, required): Node list with priorities (e.g. 'pve1:2,pve2:1')\n" +
        "  - restricted (boolean, optional, default false): If true, resources can ONLY run on group nodes\n" +
        "  - nofailback (boolean, optional, default false): Don't migrate back to higher-priority node after recovery\n" +
        "  - comment (string, optional): Description\n\n" +
        "Returns: Confirmation.\n\n" +
        "Example: { group: 'production', nodes: 'pve1:2,pve2:1', restricted: true }",
      inputSchema: HaGroupCreateSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ group, nodes, restricted, nofailback, comment }) => {
      const data: Record<string, unknown> = { group, nodes };
      if (restricted) data.restricted = 1;
      if (nofailback) data.nofailback = 1;
      if (comment) data.comment = comment;

      await client.post("cluster/ha/groups", data);
      const text = JSON.stringify({ created: group, nodes }, null, 2);
      return { content: [{ type: "text" as const, text }] };
    },
  );
}
