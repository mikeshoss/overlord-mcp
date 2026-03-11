import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProxmoxClient } from "../services/proxmox-client.js";
import type { GuestExecResponse, GuestExecStatus } from "../types.js";
import { waitForTask } from "../services/task-poller.js";
import { CHARACTER_LIMIT, CLONE_TASK_TIMEOUT, TASK_POLL_INTERVAL } from "../constants.js";
import {
  getRecipe,
  getAllRecipes,
  LINUX_DETECT_SCRIPT,
  WINDOWS_DETECT_SCRIPT,
  type Platform,
  type RecipeVariant,
} from "../recipes/index.js";
import { CloneAndProvisionSchema } from "../schemas/tools.js";

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
  throw new Error(`Timed out after ${timeoutMs / 1000}s`);
}

async function detectPlatform(
  client: ProxmoxClient,
  node: string,
  vmid: number,
): Promise<Platform> {
  try {
    const result = await execInGuest(
      client, node, vmid,
      { shell: "bash", script: LINUX_DETECT_SCRIPT },
      15_000,
    );
    const output = result.stdout.trim();
    if (output === "debian" || output === "rhel") return output;
  } catch { /* not Linux */ }

  try {
    const result = await execInGuest(
      client, node, vmid,
      { shell: "powershell", script: WINDOWS_DETECT_SCRIPT },
      15_000,
    );
    if (result.stdout.trim() === "windows") return "windows";
  } catch { /* not Windows */ }

  throw new Error("Could not detect platform");
}

async function waitForAgent(
  client: ProxmoxClient,
  node: string,
  vmid: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await client.post<Record<string, unknown>>(
        `nodes/${encodeURIComponent(node)}/qemu/${vmid}/agent/ping`,
      );
      return true;
    } catch {
      await sleep(TASK_POLL_INTERVAL);
    }
  }
  return false;
}

export function registerWorkflowTools(
  server: McpServer,
  client: ProxmoxClient,
): void {
  // ── overlord_clone_and_provision ──────────────────────────────────────────
  server.registerTool(
    "overlord_clone_and_provision",
    {
      description:
        "All-in-one workflow: clone a template → start the VM → wait for guest agent → " +
        "auto-detect platform → provision with recipes. Combines 4+ tool calls into one.\n\n" +
        "This is the fastest way to go from template to fully provisioned VM.\n\n" +
        "Args:\n" +
        "  - node (string, required): Node where the template lives\n" +
        "  - template_vmid (number, required): Template VMID to clone\n" +
        "  - name (string, required): Name for the new VM\n" +
        "  - new_vmid (number, optional): VMID for new VM — omit to auto-assign\n" +
        "  - target_node (string, optional): Deploy to a different node\n" +
        "  - full_clone (boolean, optional, default true): Full vs linked clone\n" +
        "  - storage (string, optional): Target storage\n" +
        "  - recipes (string[], optional): Recipes to provision after cloning\n" +
        "  - agent_timeout (number, optional, default 120): Seconds to wait for guest agent\n\n" +
        "Returns: Clone result, platform detection, and per-recipe provisioning results.\n\n" +
        "Example: { node: 'pve', template_vmid: 9000, name: 'web-server-1', recipes: ['docker', 'node', 'monitoring'] }",
      inputSchema: CloneAndProvisionSchema,
      annotations: { title: "Clone and Provision VM", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ node, template_vmid, name, new_vmid, target_node, full_clone, storage, recipes, agent_timeout }) => {
      const start = Date.now();
      const assignedVmid = new_vmid ?? await client.getNextId();
      const vmNode = target_node ?? node;

      // Step 1: Clone
      const cloneParams: Record<string, unknown> = {
        newid: assignedVmid,
        name,
        full: (full_clone ?? true) ? 1 : 0,
      };
      if (target_node) cloneParams.target = target_node;
      if (storage) cloneParams.storage = storage;

      const cloneUpid = await client.post<string>(
        `nodes/${encodeURIComponent(node)}/qemu/${template_vmid}/clone`,
        cloneParams,
      );
      const cloneResult = await waitForTask(client, node, cloneUpid, CLONE_TASK_TIMEOUT);

      if (!cloneResult.success) {
        const text = JSON.stringify(
          { step: "clone", success: false, error: cloneResult.status.exitstatus, elapsed_ms: Date.now() - start },
          null, 2,
        );
        return { content: [{ type: "text" as const, text }], isError: true };
      }

      // Step 2: Start
      const startUpid = await client.post<string>(
        `nodes/${encodeURIComponent(vmNode)}/qemu/${assignedVmid}/status/start`,
      );
      const startResult = await waitForTask(client, vmNode, startUpid);

      if (!startResult.success) {
        const text = JSON.stringify(
          { step: "start", vmid: assignedVmid, success: false, error: startResult.status.exitstatus },
          null, 2,
        );
        return { content: [{ type: "text" as const, text }], isError: true };
      }

      // Step 3: Wait for agent
      const agentReady = await waitForAgent(client, vmNode, assignedVmid, (agent_timeout ?? 120) * 1000);

      if (!agentReady) {
        const text = JSON.stringify(
          {
            vmid: assignedVmid, name, node: vmNode,
            clone_success: true, started: true, agent_ready: false,
            error: "Guest agent did not respond. VM is running but cannot be provisioned.",
            elapsed_ms: Date.now() - start,
          },
          null, 2,
        );
        return { content: [{ type: "text" as const, text }], isError: true };
      }

      // If no recipes, we're done
      if (!recipes || recipes.length === 0) {
        const text = JSON.stringify(
          {
            vmid: assignedVmid, name, node: vmNode,
            clone_success: true, started: true, agent_ready: true,
            provisioned: false, note: "No recipes specified. VM is ready for manual configuration.",
            elapsed_ms: Date.now() - start,
          },
          null, 2,
        );
        return { content: [{ type: "text" as const, text }] };
      }

      // Step 4: Detect platform
      let platform: Platform;
      try {
        platform = await detectPlatform(client, vmNode, assignedVmid);
      } catch (err) {
        const text = JSON.stringify(
          { vmid: assignedVmid, step: "detect_platform", error: err instanceof Error ? err.message : String(err) },
          null, 2,
        );
        return { content: [{ type: "text" as const, text }], isError: true };
      }

      // Step 5: Provision
      const recipeResults: { recipe: string; success: boolean; elapsed_ms: number; error?: string }[] = [];
      let allSuccess = true;

      for (const recipeName of recipes) {
        const recipe = getRecipe(recipeName);
        if (!recipe) {
          recipeResults.push({ recipe: recipeName, success: false, elapsed_ms: 0, error: "Unknown recipe" });
          allSuccess = false;
          break;
        }

        const variant = recipe.platforms[platform];
        if (!variant) {
          recipeResults.push({ recipe: recipeName, success: false, elapsed_ms: 0, error: `Not supported on ${platform}` });
          allSuccess = false;
          break;
        }

        if (!allSuccess) {
          recipeResults.push({ recipe: recipeName, success: false, elapsed_ms: 0, error: "Skipped — previous failure" });
          continue;
        }

        const recipeStart = Date.now();
        try {
          const result = await execInGuest(client, vmNode, assignedVmid, variant, recipe.timeoutSeconds * 1000);
          const success = result.exitcode === 0;
          if (!success) allSuccess = false;
          recipeResults.push({ recipe: recipeName, success, elapsed_ms: Date.now() - recipeStart });
        } catch (err) {
          allSuccess = false;
          recipeResults.push({
            recipe: recipeName, success: false,
            elapsed_ms: Date.now() - recipeStart,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const text = JSON.stringify(
        {
          vmid: assignedVmid, name, node: vmNode,
          clone_success: true, started: true, agent_ready: true,
          detected_platform: platform,
          provision_success: allSuccess,
          recipes: recipeResults,
          total_elapsed_ms: Date.now() - start,
        },
        null, 2,
      ).slice(0, CHARACTER_LIMIT);

      return { content: [{ type: "text" as const, text }], isError: !allSuccess };
    },
  );
}
