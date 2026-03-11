import { describe, it, expect } from "vitest";
import {
  ClusterStatusSchema,
  NodeStatusSchema,
  VmCreateSchema,
  VmStartSchema,
  VmDestroySchema,
  VmConfigSetSchema,
  SnapshotCreateSchema,
  TemplateCloneSchema,
  GuestExecSchema,
  GuestFileWriteSchema,
  ProvisionSchema,
  RecipeListSchema,
  BackupCreateSchema,
  FirewallRuleCreateSchema,
  LxcCreateSchema,
  WebhookSendSchema,
  DnsLookupSchema,
  BulkActionSchema,
  CloneAndProvisionSchema,
} from "../schemas/tools.js";

// ── Helper ────────────────────────────────────────────────────────────────────

function expectPasses(schema: { parse: Function }, input: unknown): void {
  expect(() => schema.parse(input)).not.toThrow();
}

function expectFails(schema: { parse: Function }, input: unknown): void {
  expect(() => schema.parse(input)).toThrow();
}

// ── Cluster ───────────────────────────────────────────────────────────────────

describe("ClusterStatusSchema", () => {
  it("accepts empty object", () => expectPasses(ClusterStatusSchema, {}));
  it("rejects extra fields (strict)", () => expectFails(ClusterStatusSchema, { foo: 1 }));
});

describe("NodeStatusSchema", () => {
  it("accepts valid node", () => expectPasses(NodeStatusSchema, { node: "pve" }));
  it("rejects missing node", () => expectFails(NodeStatusSchema, {}));
  it("rejects empty string", () => expectFails(NodeStatusSchema, { node: "" }));
});

// ── VM Lifecycle ──────────────────────────────────────────────────────────────

describe("VmCreateSchema", () => {
  it("accepts minimal valid input", () => {
    expectPasses(VmCreateSchema, { node: "pve", name: "test-vm" });
  });

  it("accepts full input", () => {
    expectPasses(VmCreateSchema, {
      node: "pve", vmid: 200, name: "web-01",
      memory: 4096, cores: 4, sockets: 1,
      net0: "virtio,bridge=vmbr0", ostype: "l26",
      start_after_create: true,
    });
  });

  it("rejects missing name", () => expectFails(VmCreateSchema, { node: "pve" }));
  it("rejects vmid below range", () => expectFails(VmCreateSchema, { node: "pve", name: "x", vmid: 1 }));
  it("rejects non-integer vmid", () => expectFails(VmCreateSchema, { node: "pve", name: "x", vmid: 200.5 }));
});

describe("VmStartSchema", () => {
  it("accepts valid input", () => expectPasses(VmStartSchema, { node: "pve", vmid: 200 }));
  it("rejects missing vmid", () => expectFails(VmStartSchema, { node: "pve" }));
});

describe("VmDestroySchema", () => {
  it("accepts valid input", () => {
    expectPasses(VmDestroySchema, { node: "pve", vmid: 200, confirm_destroy: true });
  });
  it("rejects missing confirm_destroy", () => {
    expectFails(VmDestroySchema, { node: "pve", vmid: 200 });
  });
});

// ── VM Config ─────────────────────────────────────────────────────────────────

describe("VmConfigSetSchema", () => {
  it("accepts string, number, and boolean config values", () => {
    expectPasses(VmConfigSetSchema, {
      node: "pve", vmid: 200,
      config: { memory: 4096, name: "web", onboot: true },
    });
  });

  it("rejects empty config record is ok (just a no-op)", () => {
    expectPasses(VmConfigSetSchema, { node: "pve", vmid: 200, config: {} });
  });
});

// ── Snapshots ─────────────────────────────────────────────────────────────────

describe("SnapshotCreateSchema", () => {
  it("accepts valid input", () => {
    expectPasses(SnapshotCreateSchema, { node: "pve", vmid: 200, name: "before-update" });
  });
  it("rejects missing name", () => {
    expectFails(SnapshotCreateSchema, { node: "pve", vmid: 200 });
  });
});

// ── Templates ─────────────────────────────────────────────────────────────────

describe("TemplateCloneSchema", () => {
  it("accepts valid input", () => {
    expectPasses(TemplateCloneSchema, { node: "pve", template_vmid: 9000, name: "cloned-vm" });
  });
});

// ── Guest Exec ────────────────────────────────────────────────────────────────

describe("GuestExecSchema", () => {
  it("accepts valid command", () => {
    expectPasses(GuestExecSchema, { node: "pve", vmid: 200, command: "uptime" });
  });
  it("rejects missing command", () => {
    expectFails(GuestExecSchema, { node: "pve", vmid: 200 });
  });
});

describe("GuestFileWriteSchema", () => {
  it("accepts valid input", () => {
    expectPasses(GuestFileWriteSchema, {
      node: "pve", vmid: 200,
      file_path: "/tmp/test.txt", content: "hello world",
    });
  });
});

// ── Provisioning ──────────────────────────────────────────────────────────────

describe("ProvisionSchema", () => {
  it("accepts valid input", () => {
    expectPasses(ProvisionSchema, { node: "pve", vmid: 200, recipes: ["docker", "node"] });
  });
  it("rejects empty recipes array", () => {
    expectFails(ProvisionSchema, { node: "pve", vmid: 200, recipes: [] });
  });
});

describe("RecipeListSchema", () => {
  it("accepts empty object", () => expectPasses(RecipeListSchema, {}));
  it("accepts platform filter", () => expectPasses(RecipeListSchema, { platform: "debian" }));
});

// ── Backup ────────────────────────────────────────────────────────────────────

describe("BackupCreateSchema", () => {
  it("accepts valid input", () => {
    expectPasses(BackupCreateSchema, { node: "pve", vmid: 200, storage: "local" });
  });
});

// ── Firewall ──────────────────────────────────────────────────────────────────

describe("FirewallRuleCreateSchema", () => {
  it("accepts valid input", () => {
    expectPasses(FirewallRuleCreateSchema, {
      node: "pve", vmid: 200,
      action: "ACCEPT", type: "in",
    });
  });
  it("rejects invalid action", () => {
    expectFails(FirewallRuleCreateSchema, {
      node: "pve", vmid: 200,
      action: "ALLOW", type: "in",
    });
  });
});

// ── LXC ───────────────────────────────────────────────────────────────────────

describe("LxcCreateSchema", () => {
  it("accepts valid input", () => {
    expectPasses(LxcCreateSchema, {
      node: "pve", vmid: 300,
      ostemplate: "local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst",
      hostname: "ct-01",
    });
  });
});

// ── Webhook ───────────────────────────────────────────────────────────────────

describe("WebhookSendSchema", () => {
  it("accepts valid input", () => {
    expectPasses(WebhookSendSchema, {
      url: "https://hooks.slack.com/services/xxx",
      payload: { text: "hello" },
    });
  });
  it("rejects missing url", () => {
    expectFails(WebhookSendSchema, { payload: { text: "hello" } });
  });
});

// ── DNS ───────────────────────────────────────────────────────────────────────

describe("DnsLookupSchema", () => {
  it("accepts valid input", () => {
    expectPasses(DnsLookupSchema, { node: "pve", vmid: 200, hostname: "google.com" });
  });
});

// ── Bulk ──────────────────────────────────────────────────────────────────────

describe("BulkActionSchema", () => {
  it("accepts valid input", () => {
    expectPasses(BulkActionSchema, {
      node: "pve", vmids: [200, 201, 202], action: "start",
    });
  });
  it("rejects invalid action", () => {
    expectFails(BulkActionSchema, {
      node: "pve", vmids: [200], action: "explode",
    });
  });
});

// ── Clone & Provision ─────────────────────────────────────────────────────────

describe("CloneAndProvisionSchema", () => {
  it("accepts valid input", () => {
    expectPasses(CloneAndProvisionSchema, {
      node: "pve", template_vmid: 9000, name: "web-01",
      recipes: ["docker", "node"],
    });
  });
  it("accepts without recipes", () => {
    expectPasses(CloneAndProvisionSchema, {
      node: "pve", template_vmid: 9000, name: "web-01",
    });
  });
});
