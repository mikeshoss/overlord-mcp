import { DEFAULT_TASK_TIMEOUT, TASK_POLL_INTERVAL } from "../constants.js";
import type { TaskStatus } from "../types.js";
import type { ProxmoxClient } from "./proxmox-client.js";

export interface TaskResult {
  success: boolean;
  status: TaskStatus;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForTask(
  client: ProxmoxClient,
  node: string,
  upid: string,
  timeoutMs: number = DEFAULT_TASK_TIMEOUT,
): Promise<TaskResult> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const status = await client.get<TaskStatus>(
      `nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/status`,
    );

    if (status.status === "stopped") {
      return {
        success: status.exitstatus === "OK",
        status,
      };
    }

    await sleep(TASK_POLL_INTERVAL);
  }

  throw new Error(
    `Task ${upid} timed out after ${timeoutMs / 1000}s on node ${node}`,
  );
}
