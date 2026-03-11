import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProxmoxClient } from "../services/proxmox-client.js";
import type { ClusterResource, NodeStatus, ClusterStatusEntry } from "../types.js";
import { CHARACTER_LIMIT } from "../constants.js";
import { SmartPlacementSchema } from "../schemas/tools.js";

interface NodeScore {
  node: string;
  online: boolean;
  cpu_usage: number;
  memory_usage: number;
  memory_free_mb?: number;
  total_cores?: number;
  vm_count: number;
  score: number;
  eligible?: boolean;
  reason: string;
}

export function registerPlacementTools(
  server: McpServer,
  client: ProxmoxClient,
): void {
  // ── overlord_smart_placement ──────────────────────────────────────────────
  server.registerTool(
    "overlord_smart_placement",
    {
      description:
        "Recommend the best node to place a new VM based on current cluster resource usage. " +
        "Analyzes CPU load, memory availability, and VM count across all online nodes.\n\n" +
        "USAGE: Call this BEFORE overlord_vm_create, overlord_template_clone, or overlord_lxc_create " +
        "to get the recommended node name. Pass the returned 'recommended_node' as the 'node' or 'target_node' parameter.\n\n" +
        "The recommendation considers:\n" +
        "  - CPU utilization (lower is better)\n" +
        "  - Memory available (more is better)\n" +
        "  - VM density (fewer VMs = less contention)\n\n" +
        "You can specify minimum resource requirements to exclude nodes that can't fit the VM.\n\n" +
        "Args:\n" +
        "  - min_memory_mb (number, optional): Minimum free memory required in MB\n" +
        "  - min_cores (number, optional): Minimum available CPU cores\n" +
        "  - prefer_empty (boolean, optional, default false): Heavily prefer nodes with fewer VMs\n\n" +
        "Returns: Ranked list of nodes with scores and recommendation.\n\n" +
        "Example: {} — recommend best node\n" +
        "Example: { min_memory_mb: 8192 } — node with at least 8GB free RAM\n" +
        "Example: { prefer_empty: true } — spread VMs across nodes",
      inputSchema: SmartPlacementSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ min_memory_mb, min_cores, prefer_empty }) => {
      // Get cluster status and resources in parallel
      const [clusterStatus, resources] = await Promise.all([
        client.get<ClusterStatusEntry[]>("cluster/status"),
        client.get<ClusterResource[]>("cluster/resources", { type: "vm" }),
      ]);

      const onlineNodes = clusterStatus.filter(
        (e) => e.type === "node" && e.online === 1,
      );

      if (onlineNodes.length === 0) {
        const text = JSON.stringify({ error: "No online nodes found in cluster" }, null, 2);
        return { content: [{ type: "text" as const, text }], isError: true };
      }

      // Get detailed status for each online node
      const nodeScores: NodeScore[] = await Promise.all(
        onlineNodes.map(async (entry) => {
          try {
            const status = await client.get<NodeStatus>(
              `nodes/${encodeURIComponent(entry.name)}/status`,
            );

            const cpuUsage = status.cpu;
            const memUsage = status.memory.used / status.memory.total;
            const memFreeMb = status.memory.free / (1024 * 1024);
            const totalCores = status.cpuinfo.cpus;
            const vmCount = resources.filter(
              (r) => r.node === entry.name && r.template !== 1,
            ).length;

            // Check minimums
            const reasons: string[] = [];
            if (min_memory_mb && memFreeMb < min_memory_mb) {
              reasons.push(`Only ${Math.round(memFreeMb)}MB free (need ${min_memory_mb}MB)`);
            }
            if (min_cores && totalCores < min_cores) {
              reasons.push(`Only ${totalCores} cores (need ${min_cores})`);
            }

            // Score: lower is better (0-100)
            // 40% CPU weight, 40% memory weight, 20% VM count weight
            let score = cpuUsage * 40 + memUsage * 40 + Math.min(vmCount / 20, 1) * 20;
            if (prefer_empty) {
              score = cpuUsage * 20 + memUsage * 20 + Math.min(vmCount / 10, 1) * 60;
            }

            return {
              node: entry.name,
              online: true,
              cpu_usage: Math.round(cpuUsage * 100) / 100,
              memory_usage: Math.round(memUsage * 100) / 100,
              memory_free_mb: Math.round(memFreeMb),
              total_cores: totalCores,
              vm_count: vmCount,
              score: Math.round(score * 100) / 100,
              eligible: reasons.length === 0,
              reason: reasons.length > 0 ? reasons.join("; ") : "OK",
            };
          } catch (err) {
            return {
              node: entry.name,
              online: true,
              cpu_usage: 1,
              memory_usage: 1,
              vm_count: 999,
              score: 100,
              eligible: false,
              reason: `Error: ${err instanceof Error ? err.message : String(err)}`,
            };
          }
        }),
      );

      // Sort by score (lower = better)
      nodeScores.sort((a, b) => a.score - b.score);

      const eligible = nodeScores.filter((n) => n.eligible !== false);
      const recommended = eligible.length > 0 ? eligible[0].node : null;

      const text = JSON.stringify(
        {
          recommended_node: recommended,
          criteria: {
            min_memory_mb: min_memory_mb ?? "any",
            min_cores: min_cores ?? "any",
            prefer_empty: prefer_empty ?? false,
          },
          nodes: nodeScores,
        },
        null, 2,
      ).slice(0, CHARACTER_LIMIT);

      return { content: [{ type: "text" as const, text }] };
    },
  );
}
