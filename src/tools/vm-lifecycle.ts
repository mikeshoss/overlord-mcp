import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProxmoxClient } from "../services/proxmox-client.js";
import { waitForTask } from "../services/task-poller.js";
import {
  VmCreateSchema,
  VmStartSchema,
  VmStopSchema,
  VmShutdownSchema,
  VmRebootSchema,
  VmDestroySchema,
} from "../schemas/tools.js";
import { DEFAULT_TASK_TIMEOUT, CHARACTER_LIMIT } from "../constants.js";

export function registerVmLifecycleTools(
  server: McpServer,
  client: ProxmoxClient,
): void {
  // ── overlord_vm_create ────────────────────────────────────────────────────
  server.registerTool(
    "overlord_vm_create",
    {
      description:
        "Create a new empty VM on a Proxmox node. This creates a blank VM — for creating VMs from templates, " +
        "use overlord_template_clone instead.\n\n" +
        "Args:\n" +
        "  - node (string, required): Target Proxmox node\n" +
        "  - vmid (number, optional): VM ID — omit to auto-assign next available ID\n" +
        "  - name (string, required): VM name\n" +
        "  - memory (number, optional, default 2048): Memory in MB\n" +
        "  - cores (number, optional, default 2): CPU cores\n" +
        "  - sockets (number, optional, default 1): CPU sockets\n" +
        "  - net0 (string, optional, default 'virtio,bridge=vmbr0'): Network configuration\n" +
        "  - scsi0 (string, optional): Disk storage spec (e.g. 'local-lvm:32' for 32GB)\n" +
        "  - ostype (enum, optional, default 'l26'): OS type — 'l26' (Linux), 'win11', 'win10', 'other'\n" +
        "  - start_after_create (boolean, optional, default false): Start VM after creation\n\n" +
        "Returns: Created VM ID and status.\n\n" +
        "Example: { node: 'pve', name: 'test-vm', memory: 4096, cores: 4, scsi0: 'local-lvm:32' }",
      inputSchema: VmCreateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ node, vmid, name, memory, cores, sockets, net0, scsi0, ostype, start_after_create }) => {
      const assignedVmid = vmid ?? await client.getNextId();

      const params: Record<string, unknown> = {
        vmid: assignedVmid,
        name,
        memory: memory ?? 2048,
        cores: cores ?? 2,
        sockets: sockets ?? 1,
        net0: net0 ?? "virtio,bridge=vmbr0",
        ostype: ostype ?? "l26",
      };
      if (scsi0) params.scsi0 = scsi0;

      await client.post<string>(
        `nodes/${encodeURIComponent(node)}/qemu`,
        params,
      );

      let started = false;
      if (start_after_create) {
        const upid = await client.post<string>(
          `nodes/${encodeURIComponent(node)}/qemu/${assignedVmid}/status/start`,
        );
        const result = await waitForTask(client, node, upid);
        started = result.success;
      }

      const text = JSON.stringify(
        {
          vmid: assignedVmid,
          name,
          node,
          created: true,
          started,
        },
        null,
        2,
      );
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_vm_start ─────────────────────────────────────────────────────
  server.registerTool(
    "overlord_vm_start",
    {
      description:
        "Start a stopped VM.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): VM ID to start\n\n" +
        "Returns: Task result with success status.\n\n" +
        "Example: { node: 'pve', vmid: 100 }",
      inputSchema: VmStartSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ node, vmid }) => {
      const upid = await client.post<string>(
        `nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/start`,
      );
      const result = await waitForTask(client, node, upid);
      const text = JSON.stringify(
        { vmid, node, action: "start", success: result.success, task: result.status },
        null,
        2,
      ).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_vm_stop ──────────────────────────────────────────────────────
  server.registerTool(
    "overlord_vm_stop",
    {
      description:
        "Hard-stop a VM immediately (like pulling the power cord). This does NOT gracefully shut down the OS — " +
        "use overlord_vm_shutdown for a graceful ACPI shutdown instead.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): VM ID to stop\n\n" +
        "Returns: Task result with success status.\n\n" +
        "Example: { node: 'pve', vmid: 100 }",
      inputSchema: VmStopSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ node, vmid }) => {
      const upid = await client.post<string>(
        `nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/stop`,
      );
      const result = await waitForTask(client, node, upid);
      const text = JSON.stringify(
        { vmid, node, action: "stop", success: result.success, task: result.status },
        null,
        2,
      ).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_vm_shutdown ──────────────────────────────────────────────────
  server.registerTool(
    "overlord_vm_shutdown",
    {
      description:
        "Gracefully shut down a VM via ACPI (like pressing the power button). The guest OS will " +
        "perform a clean shutdown. Use overlord_vm_stop for an immediate hard stop.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): VM ID to shut down\n" +
        "  - timeout (number, optional, default 120): Shutdown timeout in seconds\n\n" +
        "Returns: Task result with success status.\n\n" +
        "Example: { node: 'pve', vmid: 100, timeout: 60 }",
      inputSchema: VmShutdownSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ node, vmid, timeout }) => {
      const upid = await client.post<string>(
        `nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/shutdown`,
        { timeout: timeout ?? 120 },
      );
      const result = await waitForTask(client, node, upid, DEFAULT_TASK_TIMEOUT);
      const text = JSON.stringify(
        { vmid, node, action: "shutdown", success: result.success, task: result.status },
        null,
        2,
      ).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_vm_reboot ────────────────────────────────────────────────────
  server.registerTool(
    "overlord_vm_reboot",
    {
      description:
        "Reboot a VM via ACPI.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): VM ID to reboot\n\n" +
        "Returns: Task result with success status.\n\n" +
        "Example: { node: 'pve', vmid: 100 }",
      inputSchema: VmRebootSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ node, vmid }) => {
      const upid = await client.post<string>(
        `nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/reboot`,
      );
      const result = await waitForTask(client, node, upid);
      const text = JSON.stringify(
        { vmid, node, action: "reboot", success: result.success, task: result.status },
        null,
        2,
      ).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_vm_destroy ───────────────────────────────────────────────────
  server.registerTool(
    "overlord_vm_destroy",
    {
      description:
        "⚠️ PERMANENTLY DESTROY a VM and ALL its data. This is IRREVERSIBLE. " +
        "The VM will be deleted along with all disks and snapshots. " +
        "You MUST set confirm_destroy=true as a safety check.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): VM ID to destroy\n" +
        "  - confirm_destroy (boolean, required): MUST be true to proceed — safety check\n\n" +
        "Returns: Task result confirming destruction.\n\n" +
        "Example: { node: 'pve', vmid: 100, confirm_destroy: true }",
      inputSchema: VmDestroySchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ node, vmid, confirm_destroy }) => {
      if (!confirm_destroy) {
        return {
          content: [
            {
              type: "text" as const,
              text: "You must set confirm_destroy=true to permanently delete a VM. This cannot be undone.",
            },
          ],
          isError: true,
        };
      }

      // Stop the VM first if it's running — destroy may fail on a running VM
      try {
        const stopUpid = await client.post<string>(
          `nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/stop`,
        );
        await waitForTask(client, node, stopUpid);
      } catch {
        // VM might already be stopped — that's fine
      }

      const upid = await client.delete<string>(
        `nodes/${encodeURIComponent(node)}/qemu/${vmid}`,
        { purge: "1", "destroy-unreferenced-disks": "1" },
      );
      const result = await waitForTask(client, node, upid);
      const text = JSON.stringify(
        { vmid, node, action: "destroy", success: result.success, task: result.status },
        null,
        2,
      ).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );
}
