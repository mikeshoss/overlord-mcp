import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProxmoxClient } from "../services/proxmox-client.js";
import type { ClusterStatusEntry, ClusterResource } from "../types.js";
import {
  ClusterStatusSchema,
  NodeStatusSchema,
  ClusterResourcesSchema,
} from "../schemas/tools.js";
import { CHARACTER_LIMIT } from "../constants.js";

export function registerClusterTools(
  server: McpServer,
  client: ProxmoxClient,
): void {
  // ── overlord_cluster_status ───────────────────────────────────────────────
  server.registerTool(
    "overlord_cluster_status",
    {
      description:
        "Get Proxmox cluster status including cluster name, quorum status, and all nodes with their online/offline state. " +
        "Use this to verify cluster health and node availability before provisioning VMs.\n\n" +
        "Args: None\n\n" +
        "Returns: Cluster name, quorum status, and list of nodes with online/offline state.\n\n" +
        "Example: Call with no arguments to get a cluster overview.",
      inputSchema: ClusterStatusSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async () => {
      const data = await client.get<ClusterStatusEntry[]>("cluster/status");
      const text = JSON.stringify(data, null, 2).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_node_status ──────────────────────────────────────────────────
  server.registerTool(
    "overlord_node_status",
    {
      description:
        "Get detailed status of a specific Proxmox node including CPU usage, memory (used/total), " +
        "disk usage, uptime, and load average. Use this to check resource availability before deploying VMs to a node.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name (e.g. 'pve')\n\n" +
        "Returns: CPU%, memory used/total, disk used/total, uptime, load averages, CPU info.\n\n" +
        "Example: { node: 'pve' }",
      inputSchema: NodeStatusSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ node }) => {
      const data = await client.get<Record<string, unknown>>(
        `nodes/${encodeURIComponent(node)}/status`,
      );
      const text = JSON.stringify(data, null, 2).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_cluster_resources ────────────────────────────────────────────
  server.registerTool(
    "overlord_cluster_resources",
    {
      description:
        "Get an overview of all resources across the Proxmox cluster. This is the 'give me everything' tool — " +
        "agents should call this first to understand what VMs, nodes, and storage exist.\n\n" +
        "Args:\n" +
        "  - resource_type (enum: 'vm' | 'node' | 'storage', optional, default 'vm'): Type of resources to list\n\n" +
        "Returns: List of resources with vmid, name, node, status, CPU/memory/disk usage, template flag.\n\n" +
        "Example: { resource_type: 'vm' } — lists all VMs across the cluster\n" +
        "Example: {} — defaults to listing VMs",
      inputSchema: ClusterResourcesSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ resource_type }) => {
      const type = resource_type ?? "vm";
      const data = await client.get<ClusterResource[]>("cluster/resources", {
        type,
      });
      const text = JSON.stringify(data, null, 2).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );
}
