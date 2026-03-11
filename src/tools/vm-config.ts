import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProxmoxClient } from "../services/proxmox-client.js";
import type { VmConfig } from "../types.js";
import {
  VmConfigGetSchema,
  VmConfigSetSchema,
  VmResizeDiskSchema,
} from "../schemas/tools.js";
import { CHARACTER_LIMIT } from "../constants.js";

export function registerVmConfigTools(
  server: McpServer,
  client: ProxmoxClient,
): void {
  // ── overlord_vm_config_get ────────────────────────────────────────────────
  server.registerTool(
    "overlord_vm_config_get",
    {
      description:
        "Get the full configuration of a VM including CPU, memory, disks, network interfaces, " +
        "boot order, and all other settings.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): VM ID\n\n" +
        "Returns: Complete VM configuration object with all settings.\n\n" +
        "Example: { node: 'pve', vmid: 100 }",
      inputSchema: VmConfigGetSchema,
      annotations: {
        title: "Get VM Config",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ node, vmid }) => {
      const data = await client.get<VmConfig>(
        `nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`,
      );
      const text = JSON.stringify(data, null, 2).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_vm_config_set ────────────────────────────────────────────────
  server.registerTool(
    "overlord_vm_config_set",
    {
      description:
        "Modify VM configuration settings. Pass key-value pairs matching Proxmox config options.\n\n" +
        "DISCOVERY: Call overlord_vm_config_get first to see current settings and valid keys.\n\n" +
        "REBOOT BEHAVIOR: Most settings (memory, cores, sockets, cpu type) require a VM reboot to take effect. " +
        "Settings that apply immediately: name, description, onboot, agent, tags.\n\n" +
        "Common config keys:\n" +
        "  - memory: RAM in MB (e.g. 4096) — requires reboot\n" +
        "  - cores: CPU cores (e.g. 4) — requires reboot\n" +
        "  - sockets: CPU sockets (e.g. 1) — requires reboot\n" +
        "  - name: VM display name — immediate\n" +
        "  - description: VM description/notes — immediate\n" +
        "  - net0: Network config (e.g. 'virtio,bridge=vmbr0') — requires reboot\n" +
        "  - boot: Boot order (e.g. 'order=scsi0;ide2;net0') — next boot\n" +
        "  - onboot: Start on host boot (1 or 0) — immediate\n" +
        "  - agent: Enable QEMU guest agent (1 or 0) — requires reboot\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): VM ID to modify\n" +
        "  - config (object, required): Key-value pairs of config options to set\n\n" +
        "Returns: Confirmation of applied configuration.\n\n" +
        "Example: { node: 'pve', vmid: 100, config: { memory: 4096, cores: 4, agent: 1 } }",
      inputSchema: VmConfigSetSchema,
      annotations: {
        title: "Set VM Config",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ node, vmid, config }) => {
      await client.put(
        `nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`,
        config,
      );
      const text = JSON.stringify(
        { vmid, node, action: "config_set", applied: config },
        null,
        2,
      );
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_vm_resize_disk ───────────────────────────────────────────────
  server.registerTool(
    "overlord_vm_resize_disk",
    {
      description:
        "Resize a VM disk. Can grow a disk by a relative amount or set an absolute size. " +
        "Note: Shrinking disks is generally not supported and may cause data loss.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): VM ID\n" +
        "  - disk (string, required): Disk name (e.g. 'scsi0', 'virtio0', 'ide0')\n" +
        "  - size (string, required): Size — '+10G' to add 10GB, or '50G' for absolute size\n\n" +
        "Returns: Confirmation of resize operation.\n\n" +
        "Example: { node: 'pve', vmid: 100, disk: 'scsi0', size: '+20G' }",
      inputSchema: VmResizeDiskSchema,
      annotations: {
        title: "Resize VM Disk",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ node, vmid, disk, size }) => {
      await client.put(
        `nodes/${encodeURIComponent(node)}/qemu/${vmid}/resize`,
        { disk, size },
      );
      const text = JSON.stringify(
        { vmid, node, action: "resize_disk", disk, size },
        null,
        2,
      );
      return { content: [{ type: "text" as const, text }] };
    },
  );
}
