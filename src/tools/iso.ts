import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProxmoxClient } from "../services/proxmox-client.js";
import { waitForTask } from "../services/task-poller.js";
import { CHARACTER_LIMIT } from "../constants.js";
import { IsoListSchema, IsoDownloadSchema } from "../schemas/tools.js";

export function registerIsoTools(
  server: McpServer,
  client: ProxmoxClient,
): void {
  // ── overlord_iso_list ─────────────────────────────────────────────────────
  server.registerTool(
    "overlord_iso_list",
    {
      description:
        "List ISO images and container templates available on a storage pool.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - storage (string, required): Storage ID (e.g. 'local')\n" +
        "  - content (string, optional, default 'iso'): Content type — 'iso' or 'vztmpl' (container templates)\n\n" +
        "Returns: List of available images.\n\n" +
        "Example: { node: 'pve', storage: 'local' }\n" +
        "Example: { node: 'pve', storage: 'local', content: 'vztmpl' }",
      inputSchema: IsoListSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ node, storage, content }) => {
      const params: Record<string, string> = { content: content ?? "iso" };
      const volumes = await client.get<Record<string, unknown>[]>(
        `nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/content`,
        params,
      );
      const text = JSON.stringify({ node, storage, count: volumes.length, volumes }, null, 2).slice(0, CHARACTER_LIMIT);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_iso_download ─────────────────────────────────────────────────
  server.registerTool(
    "overlord_iso_download",
    {
      description:
        "Download an ISO image or container template from a URL to a Proxmox storage pool. " +
        "This fetches the file directly to the Proxmox node — no local upload needed.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - storage (string, required): Target storage ID\n" +
        "  - url (string, required): Direct download URL for the ISO/template\n" +
        "  - filename (string, required): Filename to save as (e.g. 'ubuntu-22.04.iso')\n" +
        "  - content (string, optional, default 'iso'): Content type — 'iso' or 'vztmpl'\n" +
        "  - checksum (string, optional): Expected SHA256 checksum for verification\n" +
        "  - checksum_algorithm (string, optional): Checksum algorithm (default: sha256)\n\n" +
        "Returns: Download task result.\n\n" +
        "Example: { node: 'pve', storage: 'local', url: 'https://releases.ubuntu.com/22.04/ubuntu-22.04-live-server-amd64.iso', filename: 'ubuntu-22.04.iso' }",
      inputSchema: IsoDownloadSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ node, storage, url, filename, content, checksum, checksum_algorithm }) => {
      const start = Date.now();

      const data: Record<string, unknown> = {
        url,
        filename,
        content: content ?? "iso",
      };
      if (checksum) data.checksum = checksum;
      if (checksum_algorithm) data["checksum-algorithm"] = checksum_algorithm;

      const upid = await client.post<string>(
        `nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/download-url`,
        data,
      );
      const result = await waitForTask(client, node, upid, 3_600_000); // 1 hour for large ISOs

      const text = JSON.stringify(
        {
          node, storage, filename,
          success: result.success,
          exit_status: result.status.exitstatus,
          elapsed_ms: Date.now() - start,
        },
        null, 2,
      );
      return { content: [{ type: "text" as const, text }], isError: !result.success };
    },
  );
}
