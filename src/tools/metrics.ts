import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProxmoxClient } from "../services/proxmox-client.js";
import { CHARACTER_LIMIT } from "../constants.js";
import { VmMetricsSchema, NodeMetricsSchema } from "../schemas/tools.js";

export function registerMetricsTools(
  server: McpServer,
  client: ProxmoxClient,
): void {
  // ── overlord_vm_metrics ───────────────────────────────────────────────────
  server.registerTool(
    "overlord_vm_metrics",
    {
      description:
        "Get historical performance metrics (RRD data) for a VM. Shows CPU, memory, " +
        "disk I/O, and network usage over time.\n\n" +
        "Use this to detect performance issues, capacity problems, or unusual activity.\n\n" +
        "Timeframes:\n" +
        "  - hour: last hour (1-minute resolution)\n" +
        "  - day: last 24 hours (5-minute resolution)\n" +
        "  - week: last 7 days (30-minute resolution)\n" +
        "  - month: last 30 days (2-hour resolution)\n" +
        "  - year: last year (1-day resolution)\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): VM ID\n" +
        "  - timeframe (string, optional, default 'hour'): Time range\n\n" +
        "Returns: Array of data points, each with a 'time' (unix timestamp) and metric values:\n" +
        "  cpu (0-1 fraction), mem (bytes used), maxmem (bytes total),\n" +
        "  disk (bytes used), maxdisk (bytes total),\n" +
        "  netin/netout (bytes), diskread/diskwrite (bytes).\n\n" +
        "Example: { node: 'pve', vmid: 201 } — last hour\n" +
        "Example: { node: 'pve', vmid: 201, timeframe: 'day' } — last 24 hours",
      inputSchema: VmMetricsSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ node, vmid, timeframe }) => {
      const tf = timeframe ?? "hour";
      const data = await client.get<Record<string, unknown>[]>(
        `nodes/${encodeURIComponent(node)}/qemu/${vmid}/rrddata`,
        { timeframe: tf },
      );

      const text = JSON.stringify(
        { vmid, node, timeframe: tf, data_points: data.length, data },
        null, 2,
      ).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_node_metrics ─────────────────────────────────────────────────
  server.registerTool(
    "overlord_node_metrics",
    {
      description:
        "Get historical performance metrics for a Proxmox node. Shows CPU, memory, " +
        "load, network, disk I/O, and swap usage over time.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - timeframe (string, optional, default 'hour'): Time range — 'hour', 'day', 'week', 'month', 'year'\n\n" +
        "Returns: Time-series node performance data.\n\n" +
        "Example: { node: 'pve', timeframe: 'day' }",
      inputSchema: NodeMetricsSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ node, timeframe }) => {
      const tf = timeframe ?? "hour";
      const data = await client.get<Record<string, unknown>[]>(
        `nodes/${encodeURIComponent(node)}/rrddata`,
        { timeframe: tf },
      );

      const text = JSON.stringify(
        { node, timeframe: tf, data_points: data.length, data },
        null, 2,
      ).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );
}
