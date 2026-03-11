import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProxmoxClient } from "../services/proxmox-client.js";
import { waitForTask } from "../services/task-poller.js";
import { CHARACTER_LIMIT, DEFAULT_TASK_TIMEOUT, CLONE_TASK_TIMEOUT } from "../constants.js";
import {
  LxcListSchema,
  LxcCreateSchema,
  LxcStartSchema,
  LxcStopSchema,
  LxcDestroySchema,
  LxcConfigGetSchema,
  LxcConfigSetSchema,
} from "../schemas/tools.js";

export function registerLxcTools(
  server: McpServer,
  client: ProxmoxClient,
): void {
  // ── overlord_lxc_list ─────────────────────────────────────────────────────
  server.registerTool(
    "overlord_lxc_list",
    {
      description:
        "List all LXC containers on a node. Containers are lightweight alternatives to VMs — " +
        "they share the host kernel, start in seconds, and use much less resources.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n\n" +
        "Returns: List of containers with VMID, name, status, CPU, memory.\n\n" +
        "Example: { node: 'pve' }",
      inputSchema: LxcListSchema,
      annotations: { title: "List Containers", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ node }) => {
      const containers = await client.get<Record<string, unknown>[]>(
        `nodes/${encodeURIComponent(node)}/lxc`,
      );
      const text = JSON.stringify({ node, count: containers.length, containers }, null, 2).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_lxc_create ───────────────────────────────────────────────────
  server.registerTool(
    "overlord_lxc_create",
    {
      description:
        "Create a new LXC container from a template. Containers are much faster to create " +
        "and start than VMs — ideal for dev environments, build agents, and microservices.\n\n" +
        "DISCOVERY: Call overlord_iso_list with content='vztmpl' (or overlord_storage_content with content='vztmpl') " +
        "to find available ostemplate values. The returned 'volid' is the ostemplate parameter. " +
        "If no templates exist, use overlord_iso_download with content='vztmpl' to download one.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, optional): Container ID — omit to auto-assign\n" +
        "  - hostname (string, required): Container hostname\n" +
        "  - ostemplate (string, required): Template (e.g. 'local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst')\n" +
        "  - storage (string, optional, default 'local-lvm'): Root filesystem storage\n" +
        "  - rootfs_size (number, optional, default 8): Root filesystem size in GB\n" +
        "  - memory (number, optional, default 512): Memory in MB\n" +
        "  - cores (number, optional, default 1): CPU cores\n" +
        "  - net0 (string, optional): Network config (e.g. 'name=eth0,bridge=vmbr0,ip=dhcp')\n" +
        "  - password (string, optional): Root password\n" +
        "  - ssh_public_keys (string, optional): SSH public keys for root\n" +
        "  - unprivileged (boolean, optional, default true): true=safer (UIDs are mapped, can't escalate to host). false=privileged (runs as real root, needed for NFS mounts or Docker-in-LXC).\n" +
        "  - start_after_create (boolean, optional, default false): Start after creation\n\n" +
        "Returns: Created container ID and status.\n\n" +
        "Example: { node: 'pve', hostname: 'build-agent', ostemplate: 'local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst', memory: 2048, cores: 2, net0: 'name=eth0,bridge=vmbr0,ip=dhcp' }\n" +
        "Example (static IP): { node: 'pve', hostname: 'web-01', ostemplate: 'local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst', net0: 'name=eth0,bridge=vmbr0,ip=10.0.0.50/24,gw=10.0.0.1' }",
      inputSchema: LxcCreateSchema,
      annotations: { title: "Create Container", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ node, vmid, hostname, ostemplate, storage, rootfs_size, memory, cores, net0, password, ssh_public_keys, unprivileged, start_after_create }) => {
      const assignedVmid = vmid ?? await client.getNextId();
      const rootStorage = storage ?? "local-lvm";

      const data: Record<string, unknown> = {
        vmid: assignedVmid,
        hostname,
        ostemplate,
        rootfs: `${rootStorage}:${rootfs_size ?? 8}`,
        memory: memory ?? 512,
        cores: cores ?? 1,
        unprivileged: (unprivileged ?? true) ? 1 : 0,
      };
      if (net0) data.net0 = net0;
      if (password) data.password = password;
      if (ssh_public_keys) data["ssh-public-keys"] = ssh_public_keys;

      const upid = await client.post<string>(
        `nodes/${encodeURIComponent(node)}/lxc`,
        data,
      );
      const result = await waitForTask(client, node, upid, CLONE_TASK_TIMEOUT);

      if (!result.success) {
        const text = JSON.stringify(
          { vmid: assignedVmid, hostname, success: false, task: result.status },
          null, 2,
        );
        return { content: [{ type: "text" as const, text }], isError: true };
      }

      let started = false;
      if (start_after_create) {
        const startUpid = await client.post<string>(
          `nodes/${encodeURIComponent(node)}/lxc/${assignedVmid}/status/start`,
        );
        const startResult = await waitForTask(client, node, startUpid);
        started = startResult.success;
      }

      const text = JSON.stringify(
        { vmid: assignedVmid, hostname, node, created: true, started },
        null, 2,
      );
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_lxc_start ────────────────────────────────────────────────────
  server.registerTool(
    "overlord_lxc_start",
    {
      description:
        "Start a stopped LXC container.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): Container ID\n\n" +
        "Returns: Task result.\n\n" +
        "Example: { node: 'pve', vmid: 200 }",
      inputSchema: LxcStartSchema,
      annotations: { title: "Start Container", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ node, vmid }) => {
      const upid = await client.post<string>(
        `nodes/${encodeURIComponent(node)}/lxc/${vmid}/status/start`,
      );
      const result = await waitForTask(client, node, upid);
      const text = JSON.stringify(
        { vmid, node, action: "start", success: result.success },
        null, 2,
      );
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_lxc_stop ─────────────────────────────────────────────────────
  server.registerTool(
    "overlord_lxc_stop",
    {
      description:
        "Stop a running LXC container.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): Container ID\n\n" +
        "Returns: Task result.\n\n" +
        "Example: { node: 'pve', vmid: 200 }",
      inputSchema: LxcStopSchema,
      annotations: { title: "Stop Container", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ node, vmid }) => {
      const upid = await client.post<string>(
        `nodes/${encodeURIComponent(node)}/lxc/${vmid}/status/stop`,
      );
      const result = await waitForTask(client, node, upid);
      const text = JSON.stringify(
        { vmid, node, action: "stop", success: result.success },
        null, 2,
      );
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_lxc_destroy ──────────────────────────────────────────────────
  server.registerTool(
    "overlord_lxc_destroy",
    {
      description:
        "Permanently destroy an LXC container and all its data. IRREVERSIBLE.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): Container ID to destroy\n" +
        "  - confirm_destroy (boolean, required): MUST be true — safety check\n\n" +
        "Returns: Task result.\n\n" +
        "Example: { node: 'pve', vmid: 200, confirm_destroy: true }",
      inputSchema: LxcDestroySchema,
      annotations: { title: "Destroy Container", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ node, vmid, confirm_destroy }) => {
      if (!confirm_destroy) {
        return {
          content: [{ type: "text" as const, text: "You must set confirm_destroy=true to delete a container." }],
          isError: true,
        };
      }

      // Stop first if running
      try {
        const stopUpid = await client.post<string>(
          `nodes/${encodeURIComponent(node)}/lxc/${vmid}/status/stop`,
        );
        await waitForTask(client, node, stopUpid);
      } catch {
        // Already stopped
      }

      const upid = await client.delete<string>(
        `nodes/${encodeURIComponent(node)}/lxc/${vmid}`,
        { purge: "1", force: "1" },
      );
      const result = await waitForTask(client, node, upid);
      const text = JSON.stringify(
        { vmid, node, action: "destroy", success: result.success },
        null, 2,
      );
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_lxc_config_get ───────────────────────────────────────────────
  server.registerTool(
    "overlord_lxc_config_get",
    {
      description:
        "Get the full configuration of an LXC container.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): Container ID\n\n" +
        "Returns: Full container configuration.\n\n" +
        "Example: { node: 'pve', vmid: 200 }",
      inputSchema: LxcConfigGetSchema,
      annotations: { title: "Get Container Config", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ node, vmid }) => {
      const config = await client.get<Record<string, unknown>>(
        `nodes/${encodeURIComponent(node)}/lxc/${vmid}/config`,
      );
      const text = JSON.stringify({ vmid, node, config }, null, 2).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_lxc_config_set ───────────────────────────────────────────────
  server.registerTool(
    "overlord_lxc_config_set",
    {
      description:
        "Modify an LXC container's configuration.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): Container ID\n" +
        "  - config (object, required): Key-value config options (memory, cores, hostname, net0, etc.)\n\n" +
        "Returns: Confirmation.\n\n" +
        "Example: { node: 'pve', vmid: 200, config: { memory: 2048, cores: 4 } }",
      inputSchema: LxcConfigSetSchema,
      annotations: { title: "Set Container Config", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ node, vmid, config }) => {
      await client.put(
        `nodes/${encodeURIComponent(node)}/lxc/${vmid}/config`,
        config,
      );
      const text = JSON.stringify(
        { vmid, node, updated: true, fields: Object.keys(config) },
        null, 2,
      );
      return { content: [{ type: "text" as const, text }] };
    },
  );
}
