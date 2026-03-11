import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProxmoxClient } from "../services/proxmox-client.js";
import type { GuestExecResponse, GuestExecStatus, GuestExecResult } from "../types.js";
import { GuestExecSchema, GuestFileReadSchema, GuestFileWriteSchema, GuestPingSchema } from "../schemas/tools.js";
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
        "IMPORTANT: The default timeout is 60 seconds. For long-running commands like package " +
        "installs (apt install), builds, or downloads, set timeout_seconds to 300-600.\n\n" +
        "Workflow: overlord_vm_start → overlord_guest_ping → overlord_guest_exec\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): VM ID to execute command in\n" +
        "  - command (string, required): Command to run (e.g. 'ip addr show', 'whoami', 'apt update')\n" +
        "  - input_data (string, optional): Data to pass as stdin to the command\n" +
        "  - timeout_seconds (number, optional, default 60): Max seconds to wait — increase for slow commands\n\n" +
        "Returns: Command output with stdout, stderr, and exit code.\n\n" +
        "Example: { node: 'pve', vmid: 100, command: 'cat /etc/os-release' }\n" +
        "Example: { node: 'pve', vmid: 100, command: 'apt-get install -y docker.io', timeout_seconds: 300 }",
      inputSchema: GuestExecSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ node, vmid, command, input_data, timeout_seconds }) => {
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

      const timeoutMs = (timeout_seconds ?? 60) * 1000;
      const result = await pollExecStatus(client, node, vmid, execResponse.pid, timeoutMs);

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

  // ── overlord_guest_ping ─────────────────────────────────────────────────
  server.registerTool(
    "overlord_guest_ping",
    {
      description:
        "Wait for the QEMU Guest Agent inside a VM to become responsive. Use this after starting " +
        "a VM and before running overlord_guest_exec — it polls until the guest agent answers or " +
        "times out.\n\n" +
        "The typical workflow is: overlord_vm_start → overlord_guest_ping → overlord_guest_exec.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): VM ID to ping\n" +
        "  - timeout_seconds (number, optional, default 60): Max seconds to wait for the guest agent\n\n" +
        "Returns: Success/failure status and time elapsed.\n\n" +
        "Example: { node: 'pve', vmid: 100 }\n" +
        "Example: { node: 'pve', vmid: 100, timeout_seconds: 120 }",
      inputSchema: GuestPingSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ node, vmid, timeout_seconds }) => {
      const timeoutMs = (timeout_seconds ?? 60) * 1000;
      const deadline = Date.now() + timeoutMs;
      let attempts = 0;

      while (Date.now() < deadline) {
        attempts++;
        try {
          await client.post<Record<string, unknown>>(
            `nodes/${encodeURIComponent(node)}/qemu/${vmid}/agent/ping`,
          );
          const text = JSON.stringify(
            {
              vmid,
              node,
              agent_ready: true,
              attempts,
              elapsed_ms: timeoutMs - (deadline - Date.now()),
            },
            null,
            2,
          );
          return { content: [{ type: "text" as const, text }] };
        } catch {
          // Agent not ready yet — wait and retry
          await sleep(TASK_POLL_INTERVAL);
        }
      }

      const text = JSON.stringify(
        {
          vmid,
          node,
          agent_ready: false,
          attempts,
          error: `Guest agent did not respond within ${timeout_seconds ?? 60}s. Ensure qemu-guest-agent is installed and the 'agent' option is enabled in VM config.`,
        },
        null,
        2,
      );
      return { content: [{ type: "text" as const, text }], isError: true };
    },
  );

  // ── overlord_guest_file_write ─────────────────────────────────────────────
  server.registerTool(
    "overlord_guest_file_write",
    {
      description:
        "Write a file inside a VM via the QEMU Guest Agent. The guest agent must be installed " +
        "and the 'agent' option enabled in VM config.\n\n" +
        "Use this to deploy configuration files, SSH keys, scripts, or any text content " +
        "directly into a VM without needing shell commands.\n\n" +
        "NOTE: This uses a three-step process via the Proxmox guest agent API:\n" +
        "  1. Open a file handle inside the VM\n" +
        "  2. Write content to the handle\n" +
        "  3. Close the handle\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): VM ID to write file to\n" +
        "  - file_path (string, required): Absolute path inside the VM (e.g. '/etc/myconfig.conf')\n" +
        "  - content (string, required): File content to write\n\n" +
        "Returns: Confirmation of file write.\n\n" +
        "Example: { node: 'pve', vmid: 100, file_path: '/root/.ssh/authorized_keys', content: 'ssh-ed25519 AAAA...' }\n" +
        "Example: { node: 'pve', vmid: 100, file_path: '/etc/hostname', content: 'my-new-vm' }",
      inputSchema: GuestFileWriteSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ node, vmid, file_path, content }) => {
      // Proxmox guest-agent file-write uses base64 encoding
      const encoded = Buffer.from(content, "utf-8").toString("base64");

      await client.post(
        `nodes/${encodeURIComponent(node)}/qemu/${vmid}/agent/file-write`,
        { file: file_path, content: encoded },
      );

      const text = JSON.stringify(
        {
          vmid,
          node,
          file_path,
          bytes_written: content.length,
          success: true,
        },
        null,
        2,
      );
      return { content: [{ type: "text" as const, text }] };
    },
  );
}
