import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProxmoxClient } from "../services/proxmox-client.js";
import type { ClusterStatusEntry, ClusterResource } from "../types.js";
import {
  ClusterStatusSchema,
  NodeStatusSchema,
  ClusterResourcesSchema,
  VmStatusSchema,
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
        "Use this to verify cluster health and discover node names.\n\n" +
        "DISCOVERY: This returns node names needed by most other tools (e.g. overlord_vm_create, " +
        "overlord_template_clone, overlord_node_status). Call this first if you don't know the node names.\n\n" +
        "Args: None\n\n" +
        "Returns: Cluster name, quorum status, and list of nodes with name, online/offline state, IP address.\n\n" +
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
        "call this first to discover node names, VM IDs, and storage pools.\n\n" +
        "DISCOVERY: This is the primary way to find:\n" +
        "  - Node names (needed by nearly every other tool)\n" +
        "  - VM IDs and which node they're on\n" +
        "  - Which VMs are templates (template=1) for cloning\n" +
        "  - Storage pools and their capacity\n\n" +
        "Args:\n" +
        "  - resource_type (enum: 'vm' | 'node' | 'storage', optional, default 'vm'): Type of resources to list\n\n" +
        "Returns: List of resources with vmid, name, node, status, CPU/memory/disk usage, template flag.\n\n" +
        "Example: { resource_type: 'vm' } — lists all VMs across the cluster (includes templates)\n" +
        "Example: { resource_type: 'storage' } — lists all storage pools with capacity\n" +
        "Example: { resource_type: 'node' } — lists all nodes with resource usage",
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

  // ── overlord_vm_status ──────────────────────────────────────────────────
  server.registerTool(
    "overlord_vm_status",
    {
      description:
        "Get the current status of a specific VM — running, stopped, paused, etc. Also returns " +
        "basic resource usage (CPU, memory) and uptime. Use this to check if a VM is ready before " +
        "running commands inside it, or to verify a start/stop operation succeeded.\n\n" +
        "This is lighter than overlord_cluster_resources when you already know the vmid and node.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): VM ID to check\n\n" +
        "Returns: VM status (running/stopped), CPU, memory, uptime, PID, name, qmpstatus.\n\n" +
        "Example: { node: 'pve', vmid: 100 }",
      inputSchema: VmStatusSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ node, vmid }) => {
      const data = await client.get<Record<string, unknown>>(
        `nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/current`,
      );
      const text = JSON.stringify(data, null, 2).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );
}
