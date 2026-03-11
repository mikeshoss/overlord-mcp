import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProxmoxClient } from "../services/proxmox-client.js";
import type { GuestExecResponse, GuestExecStatus } from "../types.js";
import { CHARACTER_LIMIT, TASK_POLL_INTERVAL } from "../constants.js";
import { DnsLookupSchema, DnsSetHostnameSchema } from "../schemas/tools.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function registerDnsTools(
  server: McpServer,
  client: ProxmoxClient,
): void {
  // ── overlord_dns_lookup ───────────────────────────────────────────────────
  server.registerTool(
    "overlord_dns_lookup",
    {
      description:
        "Resolve a hostname from inside a VM. Useful for verifying DNS is working, " +
        "checking if other VMs are reachable by name, or debugging network issues.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): VM ID to resolve from\n" +
        "  - hostname (string, required): Hostname to resolve\n\n" +
        "Returns: Resolved IP addresses.\n\n" +
        "Example: { node: 'pve', vmid: 201, hostname: 'google.com' }",
      inputSchema: DnsLookupSchema,
      annotations: { title: "DNS Lookup", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ node, vmid, hostname }) => {
      const command = `getent hosts ${hostname} || nslookup ${hostname} 2>/dev/null || echo "RESOLVE_FAILED"`;
      const execResponse = await client.post<GuestExecResponse>(
        `nodes/${encodeURIComponent(node)}/qemu/${vmid}/agent/exec`,
        { command: "bash", "command-line": `bash -c '${command}'` },
      );

      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const status = await client.get<GuestExecStatus>(
          `nodes/${encodeURIComponent(node)}/qemu/${vmid}/agent/exec-status`,
          { pid: String(execResponse.pid) },
        );
        if (status.exited === 1) {
          const output = status["out-data"] ?? "";
          const text = JSON.stringify(
            { vmid, hostname, resolved: !output.includes("RESOLVE_FAILED"), output: output.trim() },
            null, 2,
          );
          return { content: [{ type: "text" as const, text }] };
        }
        await sleep(TASK_POLL_INTERVAL);
      }

      const text = JSON.stringify({ vmid, hostname, error: "DNS lookup timed out" }, null, 2);
      return { content: [{ type: "text" as const, text }], isError: true };
    },
  );

  // ── overlord_dns_set_hostname ─────────────────────────────────────────────
  server.registerTool(
    "overlord_dns_set_hostname",
    {
      description:
        "Set the hostname of a VM via the guest agent. Updates both the live hostname " +
        "and /etc/hostname (Linux) or computer name (Windows).\n\n" +
        "This also updates /etc/hosts to map the new hostname to 127.0.1.1.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): VM ID\n" +
        "  - hostname (string, required): New hostname (e.g. 'web-server-01')\n\n" +
        "Returns: Confirmation.\n\n" +
        "Example: { node: 'pve', vmid: 201, hostname: 'web-server-01' }",
      inputSchema: DnsSetHostnameSchema,
      annotations: { title: "Set VM Hostname", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ node, vmid, hostname: newHostname }) => {
      const script = `#!/bin/bash
set -euo pipefail
OLD_HOSTNAME=$(hostname)
hostnamectl set-hostname "${newHostname}" 2>/dev/null || echo "${newHostname}" > /etc/hostname
# Update /etc/hosts
if grep -q "$OLD_HOSTNAME" /etc/hosts; then
  sed -i "s/$OLD_HOSTNAME/${newHostname}/g" /etc/hosts
else
  echo "127.0.1.1 ${newHostname}" >> /etc/hosts
fi
echo "Hostname set to: $(hostname)"
`;

      const execResponse = await client.post<GuestExecResponse>(
        `nodes/${encodeURIComponent(node)}/qemu/${vmid}/agent/exec`,
        { command: "bash", "command-line": "bash", "input-data": script },
      );

      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const status = await client.get<GuestExecStatus>(
          `nodes/${encodeURIComponent(node)}/qemu/${vmid}/agent/exec-status`,
          { pid: String(execResponse.pid) },
        );
        if (status.exited === 1) {
          const success = (status.exitcode ?? -1) === 0;
          const text = JSON.stringify(
            {
              vmid, hostname: newHostname, success,
              output: (status["out-data"] ?? "").trim(),
              error: success ? undefined : (status["err-data"] ?? "").trim(),
            },
            null, 2,
          );
          return { content: [{ type: "text" as const, text }], isError: !success };
        }
        await sleep(TASK_POLL_INTERVAL);
      }

      const text = JSON.stringify({ vmid, hostname: newHostname, error: "Timed out" }, null, 2);
      return { content: [{ type: "text" as const, text }], isError: true };
    },
  );
}
