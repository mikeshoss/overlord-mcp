import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProxmoxClient } from "../services/proxmox-client.js";
import { CHARACTER_LIMIT } from "../constants.js";
import { ClusterLogSchema, NodeSyslogSchema } from "../schemas/tools.js";

export function registerLogTools(
  server: McpServer,
  client: ProxmoxClient,
): void {
  // ── overlord_cluster_log ──────────────────────────────────────────────────
  server.registerTool(
    "overlord_cluster_log",
    {
      description:
        "View the cluster-wide event log. Shows VM creation, deletion, migration, " +
        "HA events, and other cluster activities. Essential for auditing and debugging.\n\n" +
        "Args:\n" +
        "  - max (number, optional, default 100): Max entries to return\n\n" +
        "Returns: List of log entries with timestamp, severity, node, and message.\n\n" +
        "Example: {}\n" +
        "Example: { max: 50 }",
      inputSchema: ClusterLogSchema,
      annotations: { title: "Cluster Event Log", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ max }) => {
      const params: Record<string, string> = {};
      if (max) params.max = String(max);

      const logs = await client.get<Record<string, unknown>[]>("cluster/log", params);
      const text = JSON.stringify({ count: logs.length, logs }, null, 2).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_node_syslog ──────────────────────────────────────────────────
  server.registerTool(
    "overlord_node_syslog",
    {
      description:
        "View the system log (syslog) of a Proxmox node. Shows kernel messages, " +
        "service events, and system-level activity.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - limit (number, optional, default 100): Max lines to return\n" +
        "  - since (string, optional): Only show entries since this timestamp (ISO 8601)\n" +
        "  - service (string, optional): Filter by service name (e.g. 'pvedaemon', 'sshd')\n\n" +
        "Returns: Syslog entries.\n\n" +
        "Example: { node: 'pve' }\n" +
        "Example: { node: 'pve', service: 'pvedaemon', limit: 50 }",
      inputSchema: NodeSyslogSchema,
      annotations: { title: "Node System Log", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ node, limit, since, service }) => {
      const params: Record<string, string> = {};
      if (limit) params.limit = String(limit);
      if (since) params.since = since;
      if (service) params.service = service;

      const logs = await client.get<Record<string, unknown>[]>(
        `nodes/${encodeURIComponent(node)}/syslog`,
        params,
      );
      const text = JSON.stringify({ node, count: logs.length, logs }, null, 2).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );
}
