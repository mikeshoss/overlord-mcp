import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProxmoxClient } from "../services/proxmox-client.js";
import { CHARACTER_LIMIT } from "../constants.js";
import {
  FirewallRulesListSchema,
  FirewallRuleCreateSchema,
  FirewallRuleDeleteSchema,
  FirewallOptionsSchema,
  FirewallIPSetListSchema,
  FirewallIPSetCreateSchema,
  FirewallIPSetEntryAddSchema,
} from "../schemas/tools.js";

export function registerFirewallTools(
  server: McpServer,
  client: ProxmoxClient,
): void {
  // ── overlord_firewall_rules_list ──────────────────────────────────────────
  server.registerTool(
    "overlord_firewall_rules_list",
    {
      description:
        "List firewall rules for a VM or at the cluster/datacenter level.\n\n" +
        "Proxmox has a layered firewall: datacenter rules → node rules → VM rules. " +
        "Rules are evaluated top-down; first match wins.\n\n" +
        "Args:\n" +
        "  - node (string, optional): Node name — required for VM-level rules\n" +
        "  - vmid (number, optional): VM ID — if provided, shows VM-level rules. If omitted, shows cluster-level rules.\n\n" +
        "Returns: List of firewall rules with action, direction, protocol, port, and enable state.\n\n" +
        "Example: {} — cluster-level rules\n" +
        "Example: { node: 'pve', vmid: 201 } — VM-level rules",
      inputSchema: FirewallRulesListSchema,
      annotations: { title: "List Firewall Rules", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ node, vmid }) => {
      let path: string;
      if (node && vmid !== undefined) {
        path = `nodes/${encodeURIComponent(node)}/qemu/${vmid}/firewall/rules`;
      } else {
        path = "cluster/firewall/rules";
      }

      const rules = await client.get<Record<string, unknown>[]>(path);
      const text = JSON.stringify(rules, null, 2).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_firewall_rule_create ─────────────────────────────────────────
  server.registerTool(
    "overlord_firewall_rule_create",
    {
      description:
        "Create a firewall rule for a VM or at the cluster level.\n\n" +
        "IMPORTANT: The Proxmox firewall is DISABLED by default at every level. Rules only take effect " +
        "after you enable the firewall with overlord_firewall_options: { options: { enable: 1 } }. " +
        "Enable at both cluster level AND VM level.\n\n" +
        "Common patterns:\n" +
        "  - Allow SSH: { action: 'ACCEPT', type: 'in', proto: 'tcp', dport: '22' }\n" +
        "  - Allow HTTP+HTTPS: { action: 'ACCEPT', type: 'in', proto: 'tcp', dport: '80,443' }\n" +
        "  - Block all incoming: { action: 'DROP', type: 'in' }\n" +
        "  - Allow ICMP ping: { action: 'ACCEPT', type: 'in', proto: 'icmp' }\n" +
        "  - Allow from IP set: { action: 'ACCEPT', type: 'in', source: '+trusted-ips' }\n\n" +
        "Args:\n" +
        "  - node (string, optional): Node name — required for VM rules\n" +
        "  - vmid (number, optional): VM ID — if provided, creates VM rule; otherwise cluster rule\n" +
        "  - action (string, required): 'ACCEPT', 'DROP', or 'REJECT'\n" +
        "  - type (string, required): Direction — 'in', 'out', or 'group'\n" +
        "  - proto (string, optional): Protocol — 'tcp', 'udp', 'icmp', etc.\n" +
        "  - dport (string, optional): Destination port(s) — '22', '80,443', '8000-8100'\n" +
        "  - sport (string, optional): Source port(s)\n" +
        "  - source (string, optional): Source CIDR (e.g. '10.0.0.0/8')\n" +
        "  - dest (string, optional): Destination CIDR\n" +
        "  - comment (string, optional): Rule description\n" +
        "  - enable (boolean, optional, default true): Enable the rule\n" +
        "  - pos (number, optional): Position in rule chain (0 = first)\n\n" +
        "Returns: Confirmation of rule creation.\n\n" +
        "Example: { node: 'pve', vmid: 201, action: 'ACCEPT', type: 'in', proto: 'tcp', dport: '22,80,443', comment: 'Allow SSH and web' }",
      inputSchema: FirewallRuleCreateSchema,
      annotations: { title: "Create Firewall Rule", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ node, vmid, action, type: ruleType, proto, dport, sport, source, dest, comment, enable, pos }) => {
      let path: string;
      if (node && vmid !== undefined) {
        path = `nodes/${encodeURIComponent(node)}/qemu/${vmid}/firewall/rules`;
      } else {
        path = "cluster/firewall/rules";
      }

      const data: Record<string, unknown> = {
        action,
        type: ruleType,
        enable: (enable ?? true) ? 1 : 0,
      };
      if (proto) data.proto = proto;
      if (dport) data.dport = dport;
      if (sport) data.sport = sport;
      if (source) data.source = source;
      if (dest) data.dest = dest;
      if (comment) data.comment = comment;
      if (pos !== undefined) data.pos = pos;

      await client.post(path, data);

      const text = JSON.stringify(
        { created: true, level: vmid !== undefined ? "vm" : "cluster", action, type: ruleType, proto, dport },
        null, 2,
      );
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_firewall_rule_delete ─────────────────────────────────────────
  server.registerTool(
    "overlord_firewall_rule_delete",
    {
      description:
        "Delete a firewall rule by position number.\n\n" +
        "Use overlord_firewall_rules_list first to find the rule's position (pos).\n\n" +
        "Args:\n" +
        "  - node (string, optional): Node name — required for VM rules\n" +
        "  - vmid (number, optional): VM ID\n" +
        "  - pos (number, required): Rule position to delete (from rules list)\n\n" +
        "Returns: Confirmation.\n\n" +
        "Example: { node: 'pve', vmid: 201, pos: 0 }",
      inputSchema: FirewallRuleDeleteSchema,
      annotations: { title: "Delete Firewall Rule", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ node, vmid, pos }) => {
      let path: string;
      if (node && vmid !== undefined) {
        path = `nodes/${encodeURIComponent(node)}/qemu/${vmid}/firewall/rules/${pos}`;
      } else {
        path = `cluster/firewall/rules/${pos}`;
      }

      await client.delete(path);

      const text = JSON.stringify({ deleted: true, pos, level: vmid !== undefined ? "vm" : "cluster" }, null, 2);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_firewall_options ─────────────────────────────────────────────
  server.registerTool(
    "overlord_firewall_options",
    {
      description:
        "Get or set firewall options for a VM or at the cluster level. This controls whether " +
        "the firewall is enabled and its default policies.\n\n" +
        "IMPORTANT: The Proxmox firewall is disabled by default at every level. You must enable it " +
        "for rules to take effect.\n\n" +
        "Args:\n" +
        "  - node (string, optional): Node name — required for VM options\n" +
        "  - vmid (number, optional): VM ID\n" +
        "  - options (object, optional): If provided, sets these options. If omitted, returns current options.\n" +
        "    Common options: enable (0/1), policy_in ('ACCEPT'/'DROP'/'REJECT'), policy_out ('ACCEPT'/'DROP'/'REJECT'), " +
        "    log_level_in, log_level_out\n\n" +
        "Returns: Current firewall options (or confirmation of update).\n\n" +
        "Example: { node: 'pve', vmid: 201 } — get current options\n" +
        "Example: { node: 'pve', vmid: 201, options: { enable: 1, policy_in: 'DROP' } } — enable firewall, default drop incoming",
      inputSchema: FirewallOptionsSchema,
      annotations: { title: "Firewall Options", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ node, vmid, options }) => {
      let path: string;
      if (node && vmid !== undefined) {
        path = `nodes/${encodeURIComponent(node)}/qemu/${vmid}/firewall/options`;
      } else {
        path = "cluster/firewall/options";
      }

      if (options && Object.keys(options).length > 0) {
        await client.put(path, options);
        const text = JSON.stringify({ updated: true, options }, null, 2);
        return { content: [{ type: "text" as const, text }] };
      }

      const current = await client.get<Record<string, unknown>>(path);
      const text = JSON.stringify(current, null, 2).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_firewall_ipset_list ──────────────────────────────────────────
  server.registerTool(
    "overlord_firewall_ipset_list",
    {
      description:
        "List all IP sets defined at the cluster level. IP sets are named groups of IPs/CIDRs " +
        "that can be referenced in firewall rules as +setname.\n\n" +
        "Args: None\n\n" +
        "Returns: List of IP set names.\n\n" +
        "Example: {}",
      inputSchema: FirewallIPSetListSchema,
      annotations: { title: "List IP Sets", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const ipsets = await client.get<Record<string, unknown>[]>("cluster/firewall/ipset");
      const text = JSON.stringify(ipsets, null, 2).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_firewall_ipset_create ────────────────────────────────────────
  server.registerTool(
    "overlord_firewall_ipset_create",
    {
      description:
        "Create a new IP set at the cluster level. IP sets group IPs/CIDRs that can be referenced " +
        "in firewall rules with +setname syntax.\n\n" +
        "Args:\n" +
        "  - name (string, required): IP set name (no spaces)\n" +
        "  - comment (string, optional): Description\n\n" +
        "Returns: Confirmation.\n\n" +
        "Example: { name: 'trusted-ips', comment: 'Trusted management IPs' }",
      inputSchema: FirewallIPSetCreateSchema,
      annotations: { title: "Create IP Set", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ name, comment }) => {
      const data: Record<string, unknown> = { name };
      if (comment) data.comment = comment;
      await client.post("cluster/firewall/ipset", data);
      const text = JSON.stringify({ created: name }, null, 2);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_firewall_ipset_entry_add ─────────────────────────────────────
  server.registerTool(
    "overlord_firewall_ipset_entry_add",
    {
      description:
        "Add an IP or CIDR to an existing IP set.\n\n" +
        "Args:\n" +
        "  - name (string, required): IP set name\n" +
        "  - cidr (string, required): IP or CIDR to add (e.g. '10.0.0.5', '192.168.1.0/24')\n" +
        "  - comment (string, optional): Description\n\n" +
        "Returns: Confirmation.\n\n" +
        "Example: { name: 'trusted-ips', cidr: '10.0.0.0/8', comment: 'Internal network' }",
      inputSchema: FirewallIPSetEntryAddSchema,
      annotations: { title: "Add IP Set Entry", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ name, cidr, comment }) => {
      const data: Record<string, unknown> = { cidr };
      if (comment) data.comment = comment;
      await client.post(`cluster/firewall/ipset/${encodeURIComponent(name)}`, data);
      const text = JSON.stringify({ added: cidr, ipset: name }, null, 2);
      return { content: [{ type: "text" as const, text }] };
    },
  );
}
