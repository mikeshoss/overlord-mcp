import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProxmoxClient } from "../services/proxmox-client.js";
import type { GuestExecResponse, GuestExecStatus, GuestExecResult } from "../types.js";
import { GuestExecSchema, GuestFileReadSchema } from "../schemas/tools.js";
import { GUEST_EXEC_TIMEOUT, TASK_POLL_INTERVAL, CHARACTER_LIMIT } from "../constants.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollExecStatus(
  client: ProxmoxClient,
  node: string,
  vmid: number,
  pid: number,
  timeoutMs: number = GUEST_EXEC_TIMEOUT,
): Promise<GuestExecResult> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const status = await client.get<GuestExecStatus>(
      `nodes/${encodeURIComponent(node)}/qemu/${vmid}/agent/exec-status`,
      { pid: String(pid) },
    );

    if (status.exited === 1) {
      return {
        pid,
        exited: true,
        exitcode: status.exitcode ?? -1,
        stdout: status["out-data"] ?? "",
        stderr: status["err-data"] ?? "",
      };
    }

    await sleep(TASK_POLL_INTERVAL);
  }

  throw new Error(
    `Guest command (pid ${pid}) timed out after ${timeoutMs / 1000}s on VM ${vmid}`,
  );
}

export function registerGuestExecTools(
  server: McpServer,
  client: ProxmoxClient,
): void {
  // ── overlord_guest_exec ───────────────────────────────────────────────────
  server.registerTool(
    "overlord_guest_exec",
    {
      description:
        "Execute a command inside a VM via the QEMU Guest Agent. The guest agent (qemu-ga) must " +
        "be installed inside the VM and the 'agent' option must be enabled in the VM config " +
        "(agent: 1).\n\n" +
        "The command runs inside the VM's OS, not on the Proxmox host. This is how you interact " +
        "with the VM's operating system — run commands, check services, install packages, etc.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): VM ID to execute command in\n" +
        "  - command (string, required): Command to run (e.g. 'ip addr show', 'whoami', 'apt update')\n" +
        "  - input_data (string, optional): Data to pass as stdin to the command\n\n" +
        "Returns: Command output with stdout, stderr, and exit code.\n\n" +
        "Example: { node: 'pve', vmid: 100, command: 'cat /etc/os-release' }\n" +
        "Example: { node: 'pve', vmid: 100, command: 'bash -c \"echo hello world\"' }",
      inputSchema: GuestExecSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ node, vmid, command, input_data }) => {
      const parts = command.split(/\s+/);
      const execParams: Record<string, unknown> = {
        command: parts[0],
      };
      if (parts.length > 1) {
        execParams["command-line"] = command;
      }
      if (input_data) {
        execParams["input-data"] = input_data;
      }

      const execResponse = await client.post<GuestExecResponse>(
        `nodes/${encodeURIComponent(node)}/qemu/${vmid}/agent/exec`,
        execParams,
      );

      const result = await pollExecStatus(client, node, vmid, execResponse.pid);

      const text = JSON.stringify(
        {
          vmid,
          node,
          command,
          exitcode: result.exitcode,
          stdout: result.stdout.slice(0, CHARACTER_LIMIT),
          stderr: result.stderr.slice(0, CHARACTER_LIMIT),
        },
        null,
        2,
      );
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_guest_file_read ──────────────────────────────────────────────
  server.registerTool(
    "overlord_guest_file_read",
    {
      description:
        "Read a file from inside a VM via the QEMU Guest Agent. The guest agent must be installed " +
        "and the 'agent' option enabled in VM config.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): VM ID to read file from\n" +
        "  - file_path (string, required): Absolute path inside the VM (e.g. '/etc/os-release')\n\n" +
        "Returns: File content.\n\n" +
        "Example: { node: 'pve', vmid: 100, file_path: '/etc/hostname' }",
      inputSchema: GuestFileReadSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ node, vmid, file_path }) => {
      const data = await client.post<{ content: string; truncated?: boolean }>(
        `nodes/${encodeURIComponent(node)}/qemu/${vmid}/agent/file-read`,
        { file: file_path },
      );

      // Content may be base64-encoded
      let content: string;
      try {
        content = Buffer.from(data.content, "base64").toString("utf-8");
      } catch {
        content = data.content;
      }

      const text = JSON.stringify(
        {
          vmid,
          node,
          file_path,
          content: content.slice(0, CHARACTER_LIMIT),
          truncated: data.truncated ?? false,
        },
        null,
        2,
      );
      return { content: [{ type: "text" as const, text }] };
    },
  );
}
