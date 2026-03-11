import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProxmoxClient } from "../services/proxmox-client.js";
import type { GuestExecResponse, GuestExecStatus } from "../types.js";
import { ProvisionSchema, RecipeListSchema } from "../schemas/tools.js";
import { TASK_POLL_INTERVAL, CHARACTER_LIMIT } from "../constants.js";
import { getRecipe, getAllRecipes } from "../recipes/index.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function execScript(
  client: ProxmoxClient,
  node: string,
  vmid: number,
  script: string,
  timeoutMs: number,
): Promise<{ exitcode: number; stdout: string; stderr: string }> {
  const execResponse = await client.post<GuestExecResponse>(
    `nodes/${encodeURIComponent(node)}/qemu/${vmid}/agent/exec`,
    {
      command: "bash",
      "command-line": "bash -c " + JSON.stringify(script),
      "input-data": script,
    },
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

  throw new Error(`Recipe execution timed out after ${timeoutMs / 1000}s`);
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
        "software and configure capabilities on a VM. Use this to see what's available before " +
        "calling overlord_vm_provision.\n\n" +
        "Args: None\n\n" +
        "Returns: List of recipes with name, description, and estimated timeout.\n\n" +
        "Example: Call with no arguments to see all available recipes.",
      inputSchema: RecipeListSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async () => {
      const recipes = getAllRecipes().map((r) => ({
        name: r.name,
        description: r.description,
        timeout_seconds: r.timeoutSeconds,
      }));
      const text = JSON.stringify(recipes, null, 2);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── overlord_vm_provision ─────────────────────────────────────────────────
  server.registerTool(
    "overlord_vm_provision",
    {
      description:
        "Provision a running VM by applying one or more recipes. Recipes are pre-built shell " +
        "scripts that install software (Docker, Node.js, Python, etc.) and configure the VM.\n\n" +
        "The VM MUST be running and the guest agent MUST be responsive before calling this tool. " +
        "Use overlord_guest_ping first to verify.\n\n" +
        "Recipes are applied in order. If a recipe fails, subsequent recipes are skipped. " +
        "Some recipes have dependencies — e.g. 'reaper_mcp' requires 'docker' to be applied first.\n\n" +
        "Typical workflow:\n" +
        "  1. overlord_template_clone (start_after_clone: true)\n" +
        "  2. overlord_guest_ping\n" +
        "  3. overlord_vm_provision (recipes: ['docker', 'node'])\n\n" +
        "Available recipes: docker, node, python, go, rust, tailscale, ssh_hardening, " +
        "qemu_agent, monitoring, reaper_mcp\n\n" +
        "Use overlord_recipe_list to see descriptions and timeouts for each recipe.\n\n" +
        "Args:\n" +
        "  - node (string, required): Proxmox node name\n" +
        "  - vmid (number, required): VM ID (must be running with guest agent active)\n" +
        "  - recipes (string[], required): Ordered list of recipe names to apply\n\n" +
        "Returns: Per-recipe results with success/failure, output, and timing.\n\n" +
        "Example: { node: 'pve', vmid: 201, recipes: ['docker', 'node'] }\n" +
        "Example: { node: 'pve', vmid: 201, recipes: ['docker', 'reaper_mcp'] }",
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

      const results: RecipeResult[] = [];
      let allSuccess = true;

      for (const recipeName of recipes) {
        const recipe = getRecipe(recipeName)!;
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
          const result = await execScript(
            client,
            node,
            vmid,
            recipe.script,
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
