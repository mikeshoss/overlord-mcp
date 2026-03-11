import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProxmoxClient } from "../services/proxmox-client.js";
import { CHARACTER_LIMIT } from "../constants.js";
import {
  NetworkListSchema,
  NetworkGetSchema,
  NetworkCreateSchema,
  NetworkUpdateSchema,
  NetworkDeleteSchema,
} from "../schemas/tools.js";

export function registerNetworkTools(
  server: McpServer,
  client: ProxmoxClient,
): void {
  // ── overlord_network_list ─────────────────────────────────────────────────
  server.registerTool(
    "overlord_network_list",
    {
      description:
        "List all network interfaces (bridges, bonds, VLANs) on a Proxmox node.\n\n" +
        "Use this to see available bridges before assigning VMs to networks, " +
        "or to audit the network topology of a node.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - type (string, optional): Filter by type — 'bridge', 'bond', 'vlan', 'eth', 'any' (default: 'any')\n\n" +
        "Returns: List of network interfaces with their configuration.\n\n" +
        "Example: { node: 'pve' }\n" +
        "Example: { node: 'pve', type: 'bridge' }",
      inputSchema: NetworkListSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ node, type }) => {
      const params: Record<string, string> = {};
      if (type && type !== "any") {
        params.type = type;
      }

      const networks = await client.get<Record<string, unknown>[]>(
        `nodes/${encodeURIComponent(node)}/network`,
        params,
      );

      const text = JSON.stringify(networks, null, 2).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_network_get ──────────────────────────────────────────────────
  server.registerTool(
    "overlord_network_get",
    {
      description:
        "Get detailed configuration of a specific network interface on a node.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - iface (string, required): Interface name (e.g. 'vmbr0', 'eno1', 'bond0')\n\n" +
        "Returns: Full interface configuration.\n\n" +
        "Example: { node: 'pve', iface: 'vmbr0' }",
      inputSchema: NetworkGetSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ node, iface }) => {
      const network = await client.get<Record<string, unknown>>(
        `nodes/${encodeURIComponent(node)}/network/${encodeURIComponent(iface)}`,
      );

      const text = JSON.stringify(network, null, 2).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_network_create ───────────────────────────────────────────────
  server.registerTool(
    "overlord_network_create",
    {
      description:
        "Create a new network interface (bridge, bond, or VLAN) on a Proxmox node.\n\n" +
        "REQUIRED WORKFLOW:\n" +
        "  1. overlord_network_create — stage the new interface (this tool)\n" +
        "  2. overlord_network_list — review staged changes\n" +
        "  3. overlord_network_apply — commit and activate changes\n" +
        "  OR overlord_network_revert — discard staged changes\n" +
        "  Changes do NOT take effect until overlord_network_apply is called.\n\n" +
        "Common use cases:\n" +
        "  - Create a new bridge for VM isolation: { type: 'bridge', iface: 'vmbr1' }\n" +
        "  - Create a VLAN interface: { type: 'vlan', iface: 'eno1.100' } (VLAN 100 on eno1)\n" +
        "  - Create a bridge on a VLAN: create VLAN first, then bridge with bridge_ports set to the VLAN\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - iface (string, required): Interface name (e.g. 'vmbr1', 'bond0', 'eno1.100')\n" +
        "  - type (string, required): 'bridge', 'bond', 'vlan', 'OVSBridge', 'OVSBond', 'OVSPort', 'OVSIntPort'\n" +
        "  - address (string, optional): IPv4 address (e.g. '10.0.0.1')\n" +
        "  - netmask (string, optional): Subnet mask (e.g. '255.255.255.0')\n" +
        "  - cidr (string, optional): CIDR notation (e.g. '10.0.0.1/24') — alternative to address+netmask\n" +
        "  - gateway (string, optional): Default gateway\n" +
        "  - bridge_ports (string, optional): Ports for bridge (e.g. 'eno1' or 'eno1.100')\n" +
        "  - bridge_vlan_aware (boolean, optional): Enable VLAN-aware bridge (for tagged traffic)\n" +
        "  - bond_slaves (string, optional): Slave interfaces for bond (e.g. 'eno1 eno2')\n" +
        "  - bond_mode (string, optional): Bond mode (e.g. 'balance-rr', '802.3ad', 'active-backup')\n" +
        "  - vlan_raw_device (string, optional): Parent interface for VLAN\n" +
        "  - vlan_id (number, optional): VLAN tag number\n" +
        "  - comments (string, optional): Description/comments\n" +
        "  - autostart (boolean, optional): Bring up on boot\n\n" +
        "Returns: Confirmation. Remember to call overlord_network_apply to commit changes.\n\n" +
        "Example: { node: 'pve', iface: 'vmbr1', type: 'bridge', cidr: '10.10.0.1/24', bridge_vlan_aware: true, autostart: true }",
      inputSchema: NetworkCreateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ node, iface, type: ifaceType, ...config }) => {
      const data: Record<string, unknown> = {
        iface,
        type: ifaceType,
      };

      // Map optional fields
      if (config.address) data.address = config.address;
      if (config.netmask) data.netmask = config.netmask;
      if (config.cidr) data.cidr = config.cidr;
      if (config.gateway) data.gateway = config.gateway;
      if (config.bridge_ports) data.bridge_ports = config.bridge_ports;
      if (config.bridge_vlan_aware !== undefined) data.bridge_vlan_aware = config.bridge_vlan_aware ? 1 : 0;
      if (config.bond_slaves) data.slaves = config.bond_slaves;
      if (config.bond_mode) data.bond_mode = config.bond_mode;
      if (config.vlan_raw_device) data["vlan-raw-device"] = config.vlan_raw_device;
      if (config.vlan_id !== undefined) data["vlan-id"] = config.vlan_id;
      if (config.comments) data.comments = config.comments;
      if (config.autostart !== undefined) data.autostart = config.autostart ? 1 : 0;

      await client.post(
        `nodes/${encodeURIComponent(node)}/network`,
        data,
      );

      const text = JSON.stringify(
        {
          created: iface,
          type: ifaceType,
          node,
          note: "Changes are staged. Call overlord_network_apply to commit, or overlord_network_revert to discard.",
        },
        null,
        2,
      );
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_network_update ───────────────────────────────────────────────
  server.registerTool(
    "overlord_network_update",
    {
      description:
        "Update an existing network interface configuration on a Proxmox node.\n\n" +
        "IMPORTANT: Changes are staged and require overlord_network_apply to take effect.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - iface (string, required): Interface name to modify\n" +
        "  - type (string, required): Interface type (must match existing type)\n" +
        "  - config (object, required): Key-value config to update (address, netmask, cidr, gateway, bridge_ports, etc.)\n\n" +
        "Returns: Confirmation. Remember to call overlord_network_apply.\n\n" +
        "Example: { node: 'pve', iface: 'vmbr0', type: 'bridge', config: { cidr: '192.168.1.1/24', gateway: '192.168.1.254' } }",
      inputSchema: NetworkUpdateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ node, iface, type: ifaceType, config }) => {
      const data: Record<string, unknown> = { type: ifaceType, ...config };

      await client.put(
        `nodes/${encodeURIComponent(node)}/network/${encodeURIComponent(iface)}`,
        data,
      );

      const text = JSON.stringify(
        {
          updated: iface,
          node,
          note: "Changes are staged. Call overlord_network_apply to commit.",
        },
        null,
        2,
      );
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_network_delete ───────────────────────────────────────────────
  server.registerTool(
    "overlord_network_delete",
    {
      description:
        "Delete a network interface from a Proxmox node.\n\n" +
        "WARNING: Do NOT delete interfaces that have VMs connected to them. " +
        "Check with overlord_cluster_resources first.\n\n" +
        "IMPORTANT: Changes are staged and require overlord_network_apply to take effect.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - iface (string, required): Interface name to delete\n\n" +
        "Returns: Confirmation. Remember to call overlord_network_apply.\n\n" +
        "Example: { node: 'pve', iface: 'vmbr5' }",
      inputSchema: NetworkDeleteSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ node, iface }) => {
      await client.delete(
        `nodes/${encodeURIComponent(node)}/network/${encodeURIComponent(iface)}`,
      );

      const text = JSON.stringify(
        {
          deleted: iface,
          node,
          note: "Changes are staged. Call overlord_network_apply to commit.",
        },
        null,
        2,
      );
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_network_apply ────────────────────────────────────────────────
  server.registerTool(
    "overlord_network_apply",
    {
      description:
        "Apply staged network configuration changes on a Proxmox node. " +
        "This writes the network config and reloads interfaces.\n\n" +
        "Call this after overlord_network_create, overlord_network_update, or overlord_network_delete " +
        "to commit the changes. Without this call, changes remain staged.\n\n" +
        "WARNING: This can briefly disrupt network connectivity on the node. " +
        "Ensure you won't lose access to the Proxmox host.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n\n" +
        "Returns: Confirmation that changes were applied.\n\n" +
        "Example: { node: 'pve' }",
      inputSchema: NetworkDeleteSchema.pick({ node: true }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ node }) => {
      await client.put(
        `nodes/${encodeURIComponent(node)}/network`,
      );

      const text = JSON.stringify(
        {
          node,
          applied: true,
          note: "Network configuration has been applied. Interfaces have been reloaded.",
        },
        null,
        2,
      );
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_network_revert ───────────────────────────────────────────────
  server.registerTool(
    "overlord_network_revert",
    {
      description:
        "Revert all staged (unapplied) network configuration changes on a node.\n\n" +
        "Use this if you made network changes via overlord_network_create/update/delete " +
        "but want to discard them before applying.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n\n" +
        "Returns: Confirmation that staged changes were discarded.\n\n" +
        "Example: { node: 'pve' }",
      inputSchema: NetworkDeleteSchema.pick({ node: true }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ node }) => {
      await client.delete(
        `nodes/${encodeURIComponent(node)}/network`,
      );

      const text = JSON.stringify(
        {
          node,
          reverted: true,
          note: "All staged network changes have been discarded.",
        },
        null,
        2,
      );
      return { content: [{ type: "text" as const, text }] };
    },
  );
}
