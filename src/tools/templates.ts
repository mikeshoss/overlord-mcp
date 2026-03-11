import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProxmoxClient } from "../services/proxmox-client.js";
import type { ClusterResource } from "../types.js";
import { waitForTask } from "../services/task-poller.js";
import { TemplateListSchema, TemplateCloneSchema } from "../schemas/tools.js";
import { CLONE_TASK_TIMEOUT, CHARACTER_LIMIT } from "../constants.js";

export function registerTemplateTools(
  server: McpServer,
  client: ProxmoxClient,
): void {
  // ── overlord_template_list ────────────────────────────────────────────────
  server.registerTool(
    "overlord_template_list",
    {
      description:
        "List all VM templates available in the cluster. Templates are base images that can be " +
        "cloned into new VMs using overlord_template_clone.\n\n" +
        "Args: None\n\n" +
        "Returns: Array of templates with vmid, name, and node.\n\n" +
        "Example: Call with no arguments to see available templates.",
      inputSchema: TemplateListSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async () => {
      const resources = await client.get<ClusterResource[]>(
        "cluster/resources",
        { type: "vm" },
      );
      const templates = resources.filter((r) => r.template === 1);
      const text = JSON.stringify(templates, null, 2).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_template_clone ───────────────────────────────────────────────
  server.registerTool(
    "overlord_template_clone",
    {
      description:
        "Clone a VM template into a new runnable VM. This is THE key tool for provisioning — " +
        "it creates a new VM from a pre-configured template image.\n\n" +
        "Full clone vs linked clone:\n" +
        "  - Full clone (default): Creates an independent copy. Uses more disk space but the " +
        "new VM has no dependency on the template.\n" +
        "  - Linked clone: Shares the template's base image. Much faster and uses less disk, " +
        "but the template must remain intact for the clone to function.\n\n" +
        "Args:\n" +
        "  - node (string, required): Node where the template lives\n" +
        "  - template_vmid (number, required): VMID of the template to clone\n" +
        "  - new_vmid (number, optional): VMID for the new VM — omit to auto-assign\n" +
        "  - name (string, required): Name for the new VM\n" +
        "  - target_node (string, optional): Deploy the clone to a different node\n" +
        "  - full_clone (boolean, optional, default true): Full copy (true) vs linked clone (false)\n" +
        "  - storage (string, optional): Target storage (e.g. 'local-lvm')\n" +
        "  - start_after_clone (boolean, optional, default false): Start the VM after cloning\n\n" +
        "Returns: New VM ID, clone task result, and start status if requested.\n\n" +
        "Example: { node: 'pve', template_vmid: 9000, name: 'kali-agent-1', full_clone: true, start_after_clone: true }",
      inputSchema: TemplateCloneSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ node, template_vmid, new_vmid, name, target_node, full_clone, storage, start_after_clone }) => {
      const assignedVmid = new_vmid ?? await client.getNextId();

      const params: Record<string, unknown> = {
        newid: assignedVmid,
        name,
        full: (full_clone ?? true) ? 1 : 0,
      };
      if (target_node) params.target = target_node;
      if (storage) params.storage = storage;

      const upid = await client.post<string>(
        `nodes/${encodeURIComponent(node)}/qemu/${template_vmid}/clone`,
        params,
      );
      const cloneResult = await waitForTask(client, node, upid, CLONE_TASK_TIMEOUT);

      if (!cloneResult.success) {
        const text = JSON.stringify(
          { vmid: assignedVmid, action: "template_clone", success: false, task: cloneResult.status },
          null,
          2,
        );
        return { content: [{ type: "text" as const, text }], isError: true };
      }

      let started = false;
      if (start_after_clone) {
        const targetNode = target_node ?? node;
        const startUpid = await client.post<string>(
          `nodes/${encodeURIComponent(targetNode)}/qemu/${assignedVmid}/status/start`,
        );
        const startResult = await waitForTask(client, targetNode, startUpid);
        started = startResult.success;
      }

      const text = JSON.stringify(
        {
          vmid: assignedVmid,
          name,
          template_vmid,
          node: target_node ?? node,
          action: "template_clone",
          clone_success: true,
          started,
        },
        null,
        2,
      );
      return { content: [{ type: "text" as const, text }] };
    },
  );
}
