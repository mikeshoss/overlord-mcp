import { describe, it, expect } from "vitest";
import type { ProxmoxClient } from "../services/proxmox-client.js";

// ── Mocks ─────────────────────────────────────────────────────────────────────

interface ToolEntry {
  name: string;
  description: string;
  inputSchema: unknown;
  annotations: Record<string, unknown>;
  handler: Function;
}

class MockMcpServer {
  tools: ToolEntry[] = [];

  registerTool(name: string, config: Record<string, unknown>, handler: Function): void {
    this.tools.push({
      name,
      description: config.description as string,
      inputSchema: config.inputSchema,
      annotations: config.annotations as Record<string, unknown>,
      handler,
    });
  }
}

const mockClient = {
  get: async () => ({}),
  post: async () => ({}),
  put: async () => ({}),
  delete: async () => ({}),
  getVersion: async () => ({ version: "8.0" }),
  getNextId: async () => 999,
} as unknown as ProxmoxClient;

// ── Import all registration functions ─────────────────────────────────────────

import { registerClusterTools } from "../tools/cluster.js";
import { registerVmLifecycleTools } from "../tools/vm-lifecycle.js";
import { registerVmConfigTools } from "../tools/vm-config.js";
import { registerSnapshotTools } from "../tools/snapshots.js";
import { registerTemplateTools } from "../tools/templates.js";
import { registerGuestExecTools } from "../tools/guest-exec.js";
import { registerProvisionTools } from "../tools/provision.js";
import { registerNetworkTools } from "../tools/networking.js";
import { registerMigrationTools } from "../tools/migration.js";
import { registerBackupTools } from "../tools/backup.js";
import { registerStorageTools } from "../tools/storage.js";
import { registerFirewallTools } from "../tools/firewall.js";
import { registerCloudInitTools } from "../tools/cloud-init.js";
import { registerTaskTools } from "../tools/tasks.js";
import { registerConsoleTools } from "../tools/console.js";
import { registerLxcTools } from "../tools/lxc.js";
import { registerIsoTools } from "../tools/iso.js";
import { registerHaTools } from "../tools/ha.js";
import { registerPoolTools } from "../tools/pools.js";
import { registerBulkTools } from "../tools/bulk.js";
import { registerWorkflowTools } from "../tools/workflows.js";
import { registerMetricsTools } from "../tools/metrics.js";
import { registerLogTools } from "../tools/logs.js";
import { registerPlacementTools } from "../tools/placement.js";
import { registerNotifyTools } from "../tools/notify.js";
import { registerDnsTools } from "../tools/dns.js";

// ── Registration ──────────────────────────────────────────────────────────────

const server = new MockMcpServer();

// 25 functions take (server, client), 1 takes (server) only
const registrars: Array<{ name: string; fn: Function; needsClient: boolean }> = [
  { name: "cluster", fn: registerClusterTools, needsClient: true },
  { name: "vm-lifecycle", fn: registerVmLifecycleTools, needsClient: true },
  { name: "vm-config", fn: registerVmConfigTools, needsClient: true },
  { name: "snapshots", fn: registerSnapshotTools, needsClient: true },
  { name: "templates", fn: registerTemplateTools, needsClient: true },
  { name: "guest-exec", fn: registerGuestExecTools, needsClient: true },
  { name: "provision", fn: registerProvisionTools, needsClient: true },
  { name: "networking", fn: registerNetworkTools, needsClient: true },
  { name: "migration", fn: registerMigrationTools, needsClient: true },
  { name: "backup", fn: registerBackupTools, needsClient: true },
  { name: "storage", fn: registerStorageTools, needsClient: true },
  { name: "firewall", fn: registerFirewallTools, needsClient: true },
  { name: "cloud-init", fn: registerCloudInitTools, needsClient: true },
  { name: "tasks", fn: registerTaskTools, needsClient: true },
  { name: "console", fn: registerConsoleTools, needsClient: true },
  { name: "lxc", fn: registerLxcTools, needsClient: true },
  { name: "iso", fn: registerIsoTools, needsClient: true },
  { name: "ha", fn: registerHaTools, needsClient: true },
  { name: "pools", fn: registerPoolTools, needsClient: true },
  { name: "bulk", fn: registerBulkTools, needsClient: true },
  { name: "workflows", fn: registerWorkflowTools, needsClient: true },
  { name: "metrics", fn: registerMetricsTools, needsClient: true },
  { name: "logs", fn: registerLogTools, needsClient: true },
  { name: "placement", fn: registerPlacementTools, needsClient: true },
  { name: "notify", fn: registerNotifyTools, needsClient: false },
  { name: "dns", fn: registerDnsTools, needsClient: true },
];

// Register all tools up front
for (const { fn, needsClient } of registrars) {
  if (needsClient) {
    fn(server as unknown, mockClient);
  } else {
    fn(server as unknown);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("tool registration", () => {
  it("registers all 26 tool groups without error", () => {
    expect(registrars).toHaveLength(26);
  });

  it("registers 83 tools total", () => {
    expect(server.tools).toHaveLength(83);
  });

  it("has no duplicate tool names", () => {
    const names = server.tools.map((t) => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("every tool name starts with 'overlord_'", () => {
    for (const tool of server.tools) {
      expect(tool.name).toMatch(/^overlord_/);
    }
  });
});

describe("tool metadata", () => {
  it.each(server.tools)("$name has a description", (tool) => {
    expect(tool.description).toBeTruthy();
    expect(tool.description.length).toBeGreaterThan(20);
  });

  it.each(server.tools)("$name has an inputSchema", (tool) => {
    expect(tool.inputSchema).toBeDefined();
  });

  it.each(server.tools)("$name has all 5 annotation fields", (tool) => {
    const ann = tool.annotations;
    expect(ann).toBeDefined();
    expect(typeof ann.title).toBe("string");
    expect((ann.title as string).length).toBeGreaterThan(0);
    expect(typeof ann.readOnlyHint).toBe("boolean");
    expect(typeof ann.destructiveHint).toBe("boolean");
    expect(typeof ann.idempotentHint).toBe("boolean");
    expect(typeof ann.openWorldHint).toBe("boolean");
  });

  it.each(server.tools)("$name has a handler function", (tool) => {
    expect(typeof tool.handler).toBe("function");
  });
});

describe("annotation consistency", () => {
  it("read-only tools are not destructive", () => {
    for (const tool of server.tools) {
      if (tool.annotations.readOnlyHint) {
        expect(tool.annotations.destructiveHint).toBe(false);
      }
    }
  });

  // Console generates a new proxy ticket each time (POST) so it's read-only but not idempotent
  const READ_ONLY_IDEMPOTENT_EXCEPTIONS = ["overlord_vm_console"];

  it("read-only tools are generally idempotent", () => {
    const violations = server.tools
      .filter((t) => t.annotations.readOnlyHint && !t.annotations.idempotentHint)
      .map((t) => t.name)
      .filter((name) => !READ_ONLY_IDEMPOTENT_EXCEPTIONS.includes(name));
    expect(violations).toEqual([]);
  });
});
