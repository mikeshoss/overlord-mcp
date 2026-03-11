import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProxmoxClient } from "../services/proxmox-client.js";
import { CHARACTER_LIMIT } from "../constants.js";
import { CloudInitGetSchema, CloudInitSetSchema, CloudInitRegenerateSchema } from "../schemas/tools.js";

export function registerCloudInitTools(
  server: McpServer,
  client: ProxmoxClient,
): void {
  // ── overlord_cloudinit_get ────────────────────────────────────────────────
  server.registerTool(
    "overlord_cloudinit_get",
    {
      description:
        "Get the current Cloud-Init configuration of a VM. Cloud-Init lets you inject SSH keys, " +
        "hostname, network config, and user-data into a VM *before* it boots.\n\n" +
        "This is more reliable than guest-exec for initial setup because it doesn't require " +
        "the guest agent to be running.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): VM ID\n\n" +
        "Returns: Cloud-Init config including user, sshkeys, nameserver, searchdomain, ipconfig.\n\n" +
        "Example: { node: 'pve', vmid: 201 }",
      inputSchema: CloudInitGetSchema,
      annotations: { title: "Get Cloud-Init Config", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ node, vmid }) => {
      // Cloud-init config is part of the VM config — extract ci-specific fields
      const config = await client.get<Record<string, unknown>>(
        `nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`,
      );

      const ciFields: Record<string, unknown> = {};
      const ciKeys = ["ciuser", "cipassword", "sshkeys", "nameserver", "searchdomain", "citype", "cicustom"];
      for (const key of ciKeys) {
        if (config[key] !== undefined) ciFields[key] = config[key];
      }
      // ipconfig0..N
      for (const key of Object.keys(config)) {
        if (key.startsWith("ipconfig")) ciFields[key] = config[key];
      }

      const text = JSON.stringify({ vmid, node, cloud_init: ciFields }, null, 2).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_cloudinit_set ────────────────────────────────────────────────
  server.registerTool(
    "overlord_cloudinit_set",
    {
      description:
        "Set Cloud-Init configuration on a VM. Injects SSH keys, hostname, network config, " +
        "and user-data into a VM *before* it boots — more reliable than guest-exec for initial setup.\n\n" +
        "PREREQUISITE: The VM's template/image must have cloud-init support (e.g. Ubuntu cloud images, " +
        "Debian cloud images). Regular ISO installs do NOT have cloud-init.\n\n" +
        "REQUIRED WORKFLOW (3 steps):\n" +
        "  1. overlord_cloudinit_set — configure settings (this tool)\n" +
        "  2. overlord_cloudinit_regenerate — write settings to the cloud-init drive\n" +
        "  3. overlord_vm_reboot — reboot for cloud-init to apply\n" +
        "  Skipping steps 2 or 3 means changes will NOT take effect.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): VM ID\n" +
        "  - ciuser (string, optional): Default user name\n" +
        "  - cipassword (string, optional): Default user password\n" +
        "  - sshkeys (string, optional): SSH public keys (plain text, one per line — will be URL-encoded automatically)\n" +
        "  - nameserver (string, optional): DNS server(s), space-separated (e.g. '8.8.8.8 1.1.1.1')\n" +
        "  - searchdomain (string, optional): DNS search domain (e.g. 'example.com')\n" +
        "  - ipconfig0 (string, optional): IP config for first NIC:\n" +
        "      Static: 'ip=10.0.0.10/24,gw=10.0.0.1'\n" +
        "      DHCP: 'ip=dhcp'\n" +
        "      IPv6: 'ip=dhcp,ip6=auto'\n" +
        "  - ipconfig1 (string, optional): IP config for second NIC (same format)\n\n" +
        "Returns: Confirmation with list of updated fields.\n\n" +
        "Example: { node: 'pve', vmid: 201, ciuser: 'admin', sshkeys: 'ssh-ed25519 AAAA...', ipconfig0: 'ip=10.0.0.50/24,gw=10.0.0.1', nameserver: '8.8.8.8' }",
      inputSchema: CloudInitSetSchema,
      annotations: { title: "Set Cloud-Init Config", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ node, vmid, ...config }) => {
      const data: Record<string, unknown> = {};

      if (config.ciuser) data.ciuser = config.ciuser;
      if (config.cipassword) data.cipassword = config.cipassword;
      if (config.sshkeys) data.sshkeys = encodeURIComponent(config.sshkeys);
      if (config.nameserver) data.nameserver = config.nameserver;
      if (config.searchdomain) data.searchdomain = config.searchdomain;
      if (config.ipconfig0) data.ipconfig0 = config.ipconfig0;
      if (config.ipconfig1) data.ipconfig1 = config.ipconfig1;

      await client.put(
        `nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`,
        data,
      );

      const text = JSON.stringify(
        {
          vmid, node, updated: true,
          fields: Object.keys(data),
          note: "Cloud-Init config updated. Call overlord_cloudinit_regenerate then reboot for changes to take effect.",
        },
        null, 2,
      );
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_cloudinit_regenerate ─────────────────────────────────────────
  server.registerTool(
    "overlord_cloudinit_regenerate",
    {
      description:
        "Regenerate the Cloud-Init ISO image for a VM. Call this after overlord_cloudinit_set " +
        "to write the updated cloud-init data to the VM's cloud-init drive.\n\n" +
        "After regeneration, reboot the VM for cloud-init to re-apply.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): VM ID\n\n" +
        "Returns: Confirmation.\n\n" +
        "Example: { node: 'pve', vmid: 201 }",
      inputSchema: CloudInitRegenerateSchema,
      annotations: { title: "Regenerate Cloud-Init", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ node, vmid }) => {
      await client.put(
        `nodes/${encodeURIComponent(node)}/qemu/${vmid}/cloudinit`,
      );

      const text = JSON.stringify(
        {
          vmid, node, regenerated: true,
          note: "Cloud-Init image regenerated. Reboot the VM for changes to take effect.",
        },
        null, 2,
      );
      return { content: [{ type: "text" as const, text }] };
    },
  );
}
