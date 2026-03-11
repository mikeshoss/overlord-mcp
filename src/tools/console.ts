import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProxmoxClient } from "../services/proxmox-client.js";
import { ConsoleUrlSchema } from "../schemas/tools.js";

export function registerConsoleTools(
  server: McpServer,
  client: ProxmoxClient,
): void {
  // ── overlord_vm_console ───────────────────────────────────────────────────
  server.registerTool(
    "overlord_vm_console",
    {
      description:
        "Get a VNC/SPICE console proxy ticket for a VM. Returns connection details " +
        "that can be used to open a graphical console to the VM.\n\n" +
        "Use cases:\n" +
        "  - Debug a VM that has no network access\n" +
        "  - See boot screen or BIOS\n" +
        "  - Fix a misconfigured network that locked out SSH\n" +
        "  - Provide console access URL to users\n\n" +
        "The returned ticket and port can be used with a noVNC client or the Proxmox web UI.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): VM ID\n" +
        "  - type (string, optional, default 'vnc'): Console type — 'vnc' or 'spice'\n\n" +
        "Returns: Console proxy details (ticket, port, host) for connecting.\n\n" +
        "Example: { node: 'pve', vmid: 201 } — VNC console\n" +
        "Example: { node: 'pve', vmid: 201, type: 'spice' } — SPICE console",
      inputSchema: ConsoleUrlSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ node, vmid, type: consoleType }) => {
      const proxyType = consoleType ?? "vnc";

      let proxy: Record<string, unknown>;
      if (proxyType === "spice") {
        proxy = await client.post<Record<string, unknown>>(
          `nodes/${encodeURIComponent(node)}/qemu/${vmid}/spiceproxy`,
        );
      } else {
        proxy = await client.post<Record<string, unknown>>(
          `nodes/${encodeURIComponent(node)}/qemu/${vmid}/vncproxy`,
          { websocket: 1 },
        );
      }

      const text = JSON.stringify(
        {
          vmid, node,
          type: proxyType,
          ...proxy,
          hint: proxyType === "vnc"
            ? "Use the ticket and port to connect via noVNC or the Proxmox web UI."
            : "Use the returned connection file with a SPICE client (virt-viewer).",
        },
        null, 2,
      );
      return { content: [{ type: "text" as const, text }] };
    },
  );
}
