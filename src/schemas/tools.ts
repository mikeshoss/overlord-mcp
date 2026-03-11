import { z } from "zod";
import { VMID_RANGE } from "../constants.js";

const vmid = z.number().int().min(VMID_RANGE.min).max(VMID_RANGE.max);
const node = z.string().min(1).describe("Proxmox node name (e.g. 'pve')");

// ── Cluster & Node ──────────────────────────────────────────────────────────

export const ClusterStatusSchema = z.object({}).strict();

export const NodeStatusSchema = z.object({
  node: node.describe("Node name to query"),
}).strict();

export const ClusterResourcesSchema = z.object({
  resource_type: z
    .enum(["vm", "node", "storage"])
    .default("vm")
    .optional()
    .describe("Resource type to list (default: vm)"),
}).strict();

// ── VM Lifecycle ────────────────────────────────────────────────────────────

export const VmCreateSchema = z.object({
  node: node,
  vmid: vmid.optional().describe("VM ID — omit to auto-assign"),
  name: z.string().min(1).describe("VM name"),
  memory: z.number().int().positive().default(2048).optional().describe("Memory in MB (default: 2048)"),
  cores: z.number().int().positive().default(2).optional().describe("CPU cores (default: 2)"),
  sockets: z.number().int().positive().default(1).optional().describe("CPU sockets (default: 1)"),
  net0: z.string().default("virtio,bridge=vmbr0").optional().describe("Network config (default: virtio,bridge=vmbr0)"),
  scsi0: z.string().optional().describe("Storage spec (e.g. 'local-lvm:32' for 32GB disk)"),
  ostype: z.enum(["l26", "win11", "win10", "other"]).default("l26").optional().describe("OS type (default: l26 / Linux)"),
  start_after_create: z.boolean().default(false).optional().describe("Start the VM after creation (default: false)"),
}).strict();

export const VmStartSchema = z.object({
  node: node,
  vmid: vmid.describe("VM ID to start"),
}).strict();

export const VmStopSchema = z.object({
  node: node,
  vmid: vmid.describe("VM ID to hard-stop"),
}).strict();

export const VmShutdownSchema = z.object({
  node: node,
  vmid: vmid.describe("VM ID to gracefully shut down"),
  timeout: z.number().int().positive().default(120).optional().describe("Shutdown timeout in seconds (default: 120)"),
}).strict();

export const VmRebootSchema = z.object({
  node: node,
  vmid: vmid.describe("VM ID to reboot"),
}).strict();

export const VmDestroySchema = z.object({
  node: node,
  vmid: vmid.describe("VM ID to permanently destroy"),
  confirm_destroy: z.boolean().describe("MUST be true — safety check to confirm permanent deletion"),
}).strict();

// ── VM Configuration ────────────────────────────────────────────────────────

export const VmConfigGetSchema = z.object({
  node: node,
  vmid: vmid.describe("VM ID to get config for"),
}).strict();

export const VmConfigSetSchema = z.object({
  node: node,
  vmid: vmid.describe("VM ID to modify"),
  config: z.record(z.union([z.string(), z.number(), z.boolean()])).describe(
    "Key-value config options. Common keys: memory (MB), cores, sockets, name, description, net0, boot, onboot (0/1), agent (0/1)"
  ),
}).strict();

export const VmResizeDiskSchema = z.object({
  node: node,
  vmid: vmid.describe("VM ID"),
  disk: z.string().min(1).describe("Disk name (e.g. 'scsi0', 'virtio0')"),
  size: z.string().min(1).describe("New size — '+10G' to add 10GB, or '50G' for absolute size"),
}).strict();

// ── Snapshots ───────────────────────────────────────────────────────────────

export const SnapshotListSchema = z.object({
  node: node,
  vmid: vmid.describe("VM ID"),
}).strict();

export const SnapshotCreateSchema = z.object({
  node: node,
  vmid: vmid.describe("VM ID to snapshot"),
  name: z.string().min(1).regex(/^\S+$/, "Snapshot name must not contain spaces").describe("Snapshot name (no spaces)"),
  description: z.string().optional().describe("Snapshot description"),
  include_ram: z.boolean().default(false).optional().describe("Include RAM state (vmstate) — slower but captures running state (default: false)"),
}).strict();

export const SnapshotRollbackSchema = z.object({
  node: node,
  vmid: vmid.describe("VM ID"),
  snapname: z.string().min(1).describe("Name of snapshot to rollback to"),
}).strict();

export const SnapshotDeleteSchema = z.object({
  node: node,
  vmid: vmid.describe("VM ID"),
  snapname: z.string().min(1).describe("Name of snapshot to delete"),
}).strict();

// ── Templates ───────────────────────────────────────────────────────────────

export const TemplateListSchema = z.object({}).strict();

export const TemplateCloneSchema = z.object({
  node: node.describe("Node where the template lives"),
  template_vmid: vmid.describe("VMID of the template to clone"),
  new_vmid: vmid.optional().describe("VMID for the new VM — omit to auto-assign"),
  name: z.string().min(1).describe("Name for the new VM"),
  target_node: z.string().optional().describe("Deploy to a different node (optional)"),
  full_clone: z.boolean().default(true).optional().describe("Full clone (true) vs linked clone (false). Full clones are independent but use more disk. Linked clones share the template base image — fast but depend on the template existing. Default: true"),
  storage: z.string().optional().describe("Target storage (e.g. 'local-lvm')"),
  start_after_clone: z.boolean().default(false).optional().describe("Start the VM after cloning (default: false)"),
}).strict();

// ── VM Status ───────────────────────────────────────────────────────────────

export const VmStatusSchema = z.object({
  node: node,
  vmid: vmid.describe("VM ID to check status of"),
}).strict();

// ── Guest Execution ─────────────────────────────────────────────────────────

export const GuestExecSchema = z.object({
  node: node,
  vmid: vmid.describe("VM ID to execute command in"),
  command: z.string().min(1).describe("Command to run inside the VM (e.g. 'ip addr show', 'cat /etc/hostname')"),
  input_data: z.string().optional().describe("Data to pass as stdin to the command"),
  timeout_seconds: z.number().int().positive().default(60).optional().describe("Max seconds to wait for command to finish (default: 60). Increase for long-running commands like package installs (e.g. 300 for apt install)."),
}).strict();

export const GuestFileReadSchema = z.object({
  node: node,
  vmid: vmid.describe("VM ID to read file from"),
  file_path: z.string().min(1).describe("Absolute file path inside the VM (e.g. '/etc/os-release')"),
}).strict();

export const GuestPingSchema = z.object({
  node: node,
  vmid: vmid.describe("VM ID to ping guest agent on"),
  timeout_seconds: z.number().int().positive().default(60).optional().describe("Max seconds to wait for guest agent (default: 60)"),
}).strict();
