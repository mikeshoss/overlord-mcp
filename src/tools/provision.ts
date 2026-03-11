import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProxmoxClient } from "../services/proxmox-client.js";
import type { GuestExecResponse, GuestExecStatus } from "../types.js";
import { ProvisionSchema, RecipeListSchema } from "../schemas/tools.js";
import { TASK_POLL_INTERVAL, CHARACTER_LIMIT } from "../constants.js";
import {
  getRecipe,
  getAllRecipes,
  LINUX_DETECT_SCRIPT,
  WINDOWS_DETECT_SCRIPT,
  type Platform,
  type RecipeVariant,
} from "../recipes/index.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function execInGuest(
  client: ProxmoxClient,
  node: string,
  vmid: number,
  variant: RecipeVariant,
  timeoutMs: number,
): Promise<{ exitcode: number; stdout: string; stderr: string }> {
  const execParams: Record<string, unknown> =
    variant.shell === "powershell"
      ? {
          command: "powershell.exe",
          "command-line": "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command -",
          "input-data": variant.script,
        }
      : {
          command: "bash",
          "command-line": "bash",
          "input-data": variant.script,
        };

  const execResponse = await client.post<GuestExecResponse>(
    `nodes/${encodeURIComponent(node)}/qemu/${vmid}/agent/exec`,
    execParams,
  );

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await client.get<GuestExecStatus>(
      `nodes/${encodeURIComponent(node)}/qemu/${vmid}/agent/exec-status`,
      { pid: String(execResponse.pid) },
    );

    if (status.exited === 1) {
      return {
        exitcode: status.exitcode ?? -1,
        stdout: status["out-data"] ?? "",
        stderr: status["err-data"] ?? "",
      };
    }

    await sleep(TASK_POLL_INTERVAL);
  }

  throw new Error(`Execution timed out after ${timeoutMs / 1000}s`);
}

async function detectPlatform(
  client: ProxmoxClient,
  node: string,
  vmid: number,
): Promise<Platform> {
  // Try Linux detection first (most common)
  try {
    const linuxResult = await execInGuest(
      client,
      node,
      vmid,
      { shell: "bash", script: LINUX_DETECT_SCRIPT },
      15_000,
    );

    const output = linuxResult.stdout.trim();
    if (output === "debian" || output === "rhel") {
      return output;
    }
  } catch {
    // bash not found — likely Windows
  }

  // Try Windows detection
  try {
    const winResult = await execInGuest(
      client,
      node,
      vmid,
      { shell: "powershell", script: WINDOWS_DETECT_SCRIPT },
      15_000,
    );

    if (winResult.stdout.trim() === "windows") {
      return "windows";
    }
  } catch {
    // PowerShell not found either
  }

  throw new Error(
    "Could not detect VM platform. Neither bash (Linux) nor PowerShell (Windows) responded via guest agent.",
  );
}

interface RecipeResult {
  recipe: string;
  success: boolean;
  exitcode: number;
  stdout: string;
  stderr: string;
  elapsed_ms: number;
}

export function registerProvisionTools(
  server: McpServer,
  client: ProxmoxClient,
): void {
  // ── overlord_recipe_list ──────────────────────────────────────────────────
  server.registerTool(
    "overlord_recipe_list",
    {
      description:
        "List all available provisioning recipes. Recipes are pre-built scripts that install " +
        "software and configure capabilities on a VM. Each recipe supports one or more platforms " +
        "(debian, rhel, windows). The provision tool auto-detects the VM's platform.\n\n" +
        "Use this to see what's available before calling overlord_vm_provision.\n\n" +
        "Args:\n" +
        "  - platform (string, optional): Filter by platform — 'debian', 'rhel', or 'windows'. " +
        "Omit to show all recipes.\n\n" +
        "Returns: List of recipes with name, description, supported platforms, and timeout.\n\n" +
        "Example: {} — show all recipes\n" +
        "Example: { platform: 'windows' } — show only Windows-compatible recipes",
      inputSchema: RecipeListSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ platform }) => {
      let recipeList = getAllRecipes();
      if (platform) {
        recipeList = recipeList.filter((r) => platform in r.platforms);
      }

      const output = recipeList.map((r) => ({
        name: r.name,
        description: r.description,
        platforms: Object.keys(r.platforms),
        dependencies: r.dependencies ?? [],
        timeout_seconds: r.timeoutSeconds,
      }));
      const text = JSON.stringify(output, null, 2);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_vm_provision ─────────────────────────────────────────────────
  server.registerTool(
    "overlord_vm_provision",
    {
      description:
        "Provision a running VM by applying one or more recipes. Recipes are pre-built scripts " +
        "that install software (Docker, Node.js, Python, etc.) and configure the VM.\n\n" +
        "PLATFORM AUTO-DETECTION: The tool automatically detects the VM's OS (Ubuntu/Debian, " +
        "Fedora/RHEL, or Windows) and runs the correct script variant. You don't need to specify " +
        "the platform.\n\n" +
        "The VM MUST be running and the guest agent MUST be responsive before calling this tool. " +
        "Use overlord_guest_ping first to verify.\n\n" +
        "Recipes are applied in order. If a recipe fails, subsequent recipes are skipped. " +
        "Some recipes have dependencies — e.g. 'reaper_mcp' requires 'docker' first. " +
        "If a recipe doesn't support the detected platform, it fails with a clear message.\n\n" +
        "Typical workflow:\n" +
        "  1. overlord_template_clone (start_after_clone: true)\n" +
        "  2. overlord_guest_ping\n" +
        "  3. overlord_vm_provision (recipes: ['docker', 'node'])\n\n" +
        "Available recipes (use overlord_recipe_list for details):\n" +
        "  Linux: docker, node, python, go, rust, tailscale, ssh_hardening, qemu_agent, monitoring, reaper_mcp, openssh_server\n" +
        "  Windows: docker, node, python, go, rust, tailscale, ssh_hardening, qemu_agent, monitoring, openssh_server, winrm, chocolatey\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): VM ID (must be running with guest agent active)\n" +
        "  - recipes (string[], required): Ordered list of recipe names to apply\n\n" +
        "Returns: Detected platform, and per-recipe results with success/failure, output, and timing.\n\n" +
        "Example: { node: 'pve', vmid: 201, recipes: ['docker', 'node'] }\n" +
        "Example: { node: 'pve', vmid: 300, recipes: ['chocolatey', 'openssh_server'] }  // Windows VM",
      inputSchema: ProvisionSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ node, vmid, recipes }) => {
      // Validate all recipe names first
      const unknownRecipes = recipes.filter((name) => !getRecipe(name));
      if (unknownRecipes.length > 0) {
        const text = JSON.stringify(
          {
            error: `Unknown recipes: ${unknownRecipes.join(", ")}. Use overlord_recipe_list to see available recipes.`,
            available: getAllRecipes().map((r) => r.name),
          },
          null,
          2,
        );
        return { content: [{ type: "text" as const, text }], isError: true };
      }

      // Detect platform
      let platform: Platform;
      try {
        platform = await detectPlatform(client, node, vmid);
      } catch (err) {
        const text = JSON.stringify(
          {
            error: err instanceof Error ? err.message : String(err),
            hint: "Ensure the VM is running, the guest agent is installed, and overlord_guest_ping succeeds first.",
          },
          null,
          2,
        );
        return { content: [{ type: "text" as const, text }], isError: true };
      }

      // Check all recipes support this platform before starting
      const unsupported = recipes.filter((name) => {
        const recipe = getRecipe(name)!;
        return !(platform in recipe.platforms);
      });
      if (unsupported.length > 0) {
        const text = JSON.stringify(
          {
            detected_platform: platform,
            error: `These recipes don't support ${platform}: ${unsupported.join(", ")}`,
            hint: "Use overlord_recipe_list with platform filter to see compatible recipes.",
          },
          null,
          2,
        );
        return { content: [{ type: "text" as const, text }], isError: true };
      }

      // Execute recipes in order
      const results: RecipeResult[] = [];
      let allSuccess = true;

      for (const recipeName of recipes) {
        const recipe = getRecipe(recipeName)!;
        const variant = recipe.platforms[platform]!;
        const start = Date.now();

        if (!allSuccess) {
          results.push({
            recipe: recipeName,
            success: false,
            exitcode: -1,
            stdout: "",
            stderr: "Skipped — previous recipe failed",
            elapsed_ms: 0,
          });
          continue;
        }

        try {
          const result = await execInGuest(
            client,
            node,
            vmid,
            variant,
            recipe.timeoutSeconds * 1000,
          );

          const success = result.exitcode === 0;
          if (!success) allSuccess = false;

          results.push({
            recipe: recipeName,
            success,
            exitcode: result.exitcode,
            stdout: result.stdout.slice(0, CHARACTER_LIMIT / recipes.length),
            stderr: result.stderr.slice(0, CHARACTER_LIMIT / recipes.length),
            elapsed_ms: Date.now() - start,
          });
        } catch (err) {
          allSuccess = false;
          results.push({
            recipe: recipeName,
            success: false,
            exitcode: -1,
            stdout: "",
            stderr: err instanceof Error ? err.message : String(err),
            elapsed_ms: Date.now() - start,
          });
        }
      }

      const text = JSON.stringify(
        {
          vmid,
          node,
          detected_platform: platform,
          all_success: allSuccess,
          results,
        },
        null,
        2,
      ).slice(0, CHARACTER_LIMIT);

      return {
        content: [{ type: "text" as const, text }],
        isError: !allSuccess,
      };
    },
  );
}
