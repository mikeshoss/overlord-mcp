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

// ── Networking ──────────────────────────────────────────────────────────────

export const NetworkListSchema = z.object({
  node: node,
  type: z.enum(["bridge", "bond", "vlan", "eth", "any"]).default("any").optional()
    .describe("Filter by interface type (default: 'any')"),
}).strict();

export const NetworkGetSchema = z.object({
  node: node,
  iface: z.string().min(1).describe("Interface name (e.g. 'vmbr0', 'eno1', 'bond0')"),
}).strict();

export const NetworkCreateSchema = z.object({
  node: node,
  iface: z.string().min(1).describe("Interface name (e.g. 'vmbr1', 'bond0', 'eno1.100')"),
  type: z.enum(["bridge", "bond", "vlan", "OVSBridge", "OVSBond", "OVSPort", "OVSIntPort"])
    .describe("Interface type"),
  address: z.string().optional().describe("IPv4 address (e.g. '10.0.0.1')"),
  netmask: z.string().optional().describe("Subnet mask (e.g. '255.255.255.0')"),
  cidr: z.string().optional().describe("CIDR notation (e.g. '10.0.0.1/24')"),
  gateway: z.string().optional().describe("Default gateway"),
  bridge_ports: z.string().optional().describe("Ports for bridge (e.g. 'eno1')"),
  bridge_vlan_aware: z.boolean().optional().describe("Enable VLAN-aware bridge"),
  bond_slaves: z.string().optional().describe("Slave interfaces (e.g. 'eno1 eno2')"),
  bond_mode: z.string().optional().describe("Bond mode (e.g. 'balance-rr', '802.3ad')"),
  vlan_raw_device: z.string().optional().describe("Parent interface for VLAN"),
  vlan_id: z.number().int().optional().describe("VLAN tag number"),
  comments: z.string().optional().describe("Description"),
  autostart: z.boolean().optional().describe("Bring up on boot"),
}).strict();

export const NetworkUpdateSchema = z.object({
  node: node,
  iface: z.string().min(1).describe("Interface name to update"),
  type: z.enum(["bridge", "bond", "vlan", "OVSBridge", "OVSBond", "OVSPort", "OVSIntPort"])
    .describe("Interface type (must match existing)"),
  config: z.record(z.union([z.string(), z.number(), z.boolean()])).describe(
    "Key-value config to update (address, netmask, cidr, gateway, bridge_ports, etc.)"
  ),
}).strict();

export const NetworkDeleteSchema = z.object({
  node: node,
  iface: z.string().min(1).describe("Interface name to delete"),
}).strict();

// ── Migration ───────────────────────────────────────────────────────────────

export const VmMigrateSchema = z.object({
  node: node.describe("Source node where the VM currently lives"),
  vmid: vmid.describe("VM ID to migrate"),
  target: z.string().min(1).describe("Destination node name"),
  online: z.boolean().default(true).optional().describe("Live migration (true) or offline (false). Default: true"),
  with_local_disks: z.boolean().default(true).optional().describe("Migrate local disks. Required for VMs on local storage. Default: true"),
  target_storage: z.string().optional().describe("Move disks to this storage on the target node"),
}).strict();

// ── Backup & Restore ────────────────────────────────────────────────────────

export const BackupListSchema = z.object({
  node: node,
  storage: z.string().min(1).describe("Storage ID where backups are stored (e.g. 'local', 'nfs-backup')"),
  vmid: vmid.optional().describe("Filter backups by VM ID"),
}).strict();

export const BackupCreateSchema = z.object({
  node: node,
  vmid: vmid.describe("VM ID to backup"),
  storage: z.string().min(1).describe("Target storage for the backup"),
  mode: z.enum(["snapshot", "suspend", "stop"]).default("snapshot").optional()
    .describe("Backup mode — snapshot (default, runs while VM is up), suspend (pauses VM), stop (stops VM)"),
  compress: z.enum(["zstd", "lzo", "gzip", "none"]).default("zstd").optional()
    .describe("Compression algorithm (default: zstd)"),
  notes: z.string().optional().describe("Descriptive notes for this backup"),
}).strict();

export const BackupRestoreSchema = z.object({
  node: node.describe("Node to restore onto"),
  vmid: vmid.describe("VM ID for the restored VM"),
  archive: z.string().min(1).describe("Backup volume ID (from overlord_backup_list)"),
  storage: z.string().optional().describe("Target storage for restored disks"),
  force: z.boolean().default(false).optional().describe("Overwrite existing VM with same VMID (default: false)"),
  start_after_restore: z.boolean().default(false).optional().describe("Start VM after restore (default: false)"),
}).strict();

export const BackupDeleteSchema = z.object({
  node: node,
  storage: z.string().min(1).describe("Storage ID"),
  volume: z.string().min(1).describe("Backup volume ID to delete"),
}).strict();

// ── Storage ─────────────────────────────────────────────────────────────────

export const StorageListSchema = z.object({
  node: z.string().optional().describe("Filter to storage on a specific node (includes usage stats)"),
  content: z.string().optional().describe("Filter by content type — 'images', 'backup', 'iso', 'rootdir', 'vztmpl'"),
  enabled_only: z.boolean().default(true).optional().describe("Only show enabled storage (default: true)"),
}).strict();

export const StorageStatusSchema = z.object({
  node: node,
  storage: z.string().min(1).describe("Storage ID (e.g. 'local-lvm', 'ceph-pool')"),
}).strict();

export const StorageContentSchema = z.object({
  node: node,
  storage: z.string().min(1).describe("Storage ID"),
  content: z.string().optional().describe("Filter by content type"),
  vmid: vmid.optional().describe("Filter by VM ID"),
}).strict();

// ── Guest File Write ────────────────────────────────────────────────────────

export const GuestFileWriteSchema = z.object({
  node: node,
  vmid: vmid.describe("VM ID to write file to"),
  file_path: z.string().min(1).describe("Absolute file path inside the VM (e.g. '/etc/myconfig.conf')"),
  content: z.string().describe("File content to write"),
}).strict();

// ── Firewall ────────────────────────────────────────────────────────────────

export const FirewallRulesListSchema = z.object({
  node: z.string().optional().describe("Node name — required for VM-level rules"),
  vmid: vmid.optional().describe("VM ID — if provided, shows VM rules; otherwise cluster rules"),
}).strict();

export const FirewallRuleCreateSchema = z.object({
  node: z.string().optional().describe("Node name — required for VM rules"),
  vmid: vmid.optional().describe("VM ID — omit for cluster-level rule"),
  action: z.enum(["ACCEPT", "DROP", "REJECT"]).describe("Rule action"),
  type: z.enum(["in", "out", "group"]).describe("Traffic direction"),
  proto: z.string().optional().describe("Protocol — 'tcp', 'udp', 'icmp'"),
  dport: z.string().optional().describe("Destination port(s) — '22', '80,443', '8000-8100'"),
  sport: z.string().optional().describe("Source port(s)"),
  source: z.string().optional().describe("Source CIDR (e.g. '10.0.0.0/8')"),
  dest: z.string().optional().describe("Destination CIDR"),
  comment: z.string().optional().describe("Rule description"),
  enable: z.boolean().default(true).optional().describe("Enable the rule (default: true)"),
  pos: z.number().int().optional().describe("Position in rule chain (0 = first)"),
}).strict();

export const FirewallRuleDeleteSchema = z.object({
  node: z.string().optional().describe("Node name — required for VM rules"),
  vmid: vmid.optional().describe("VM ID"),
  pos: z.number().int().describe("Rule position to delete"),
}).strict();

export const FirewallOptionsSchema = z.object({
  node: z.string().optional().describe("Node name — required for VM options"),
  vmid: vmid.optional().describe("VM ID"),
  options: z.record(z.union([z.string(), z.number()])).optional().describe(
    "Options to set. Common: enable (0/1), policy_in, policy_out. Omit to get current options."
  ),
}).strict();

export const FirewallIPSetListSchema = z.object({}).strict();

export const FirewallIPSetCreateSchema = z.object({
  name: z.string().min(1).describe("IP set name"),
  comment: z.string().optional().describe("Description"),
}).strict();

export const FirewallIPSetEntryAddSchema = z.object({
  name: z.string().min(1).describe("IP set name"),
  cidr: z.string().min(1).describe("IP or CIDR to add (e.g. '10.0.0.5', '192.168.1.0/24')"),
  comment: z.string().optional().describe("Description"),
}).strict();

// ── Cloud-Init ──────────────────────────────────────────────────────────────

export const CloudInitGetSchema = z.object({
  node: node,
  vmid: vmid.describe("VM ID"),
}).strict();

export const CloudInitSetSchema = z.object({
  node: node,
  vmid: vmid.describe("VM ID"),
  ciuser: z.string().optional().describe("Default user name"),
  cipassword: z.string().optional().describe("Default user password"),
  sshkeys: z.string().optional().describe("SSH public keys (one per line)"),
  nameserver: z.string().optional().describe("DNS server (e.g. '8.8.8.8')"),
  searchdomain: z.string().optional().describe("DNS search domain"),
  ipconfig0: z.string().optional().describe("IP config for NIC 0 (e.g. 'ip=10.0.0.10/24,gw=10.0.0.1' or 'ip=dhcp')"),
  ipconfig1: z.string().optional().describe("IP config for NIC 1"),
}).strict();

export const CloudInitRegenerateSchema = z.object({
  node: node,
  vmid: vmid.describe("VM ID"),
}).strict();

// ── Task Management ─────────────────────────────────────────────────────────

export const TaskListSchema = z.object({
  node: node,
  limit: z.number().int().positive().default(50).optional().describe("Max tasks (default: 50)"),
  running: z.boolean().optional().describe("Only show running tasks"),
  vmid: vmid.optional().describe("Filter by VM ID"),
  type_filter: z.string().optional().describe("Filter by task type (e.g. 'qmclone', 'vzdump', 'qmigrate')"),
}).strict();

export const TaskStatusSchema = z.object({
  node: node,
  upid: z.string().min(1).describe("Task UPID"),
}).strict();

export const TaskLogSchema = z.object({
  node: node,
  upid: z.string().min(1).describe("Task UPID"),
  limit: z.number().int().positive().default(500).optional().describe("Max log lines (default: 500)"),
  start: z.number().int().default(0).optional().describe("Start from line number"),
}).strict();

// ── Console ─────────────────────────────────────────────────────────────────

export const ConsoleUrlSchema = z.object({
  node: node,
  vmid: vmid.describe("VM ID"),
  type: z.enum(["vnc", "spice"]).default("vnc").optional().describe("Console type (default: vnc)"),
}).strict();

// ── LXC Containers ──────────────────────────────────────────────────────────

export const LxcListSchema = z.object({
  node: node,
}).strict();

export const LxcCreateSchema = z.object({
  node: node,
  vmid: vmid.optional().describe("Container ID — omit to auto-assign"),
  hostname: z.string().min(1).describe("Container hostname"),
  ostemplate: z.string().min(1).describe("Template (e.g. 'local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst')"),
  storage: z.string().optional().describe("Root filesystem storage (default: local-lvm)"),
  rootfs_size: z.number().int().positive().default(8).optional().describe("Root filesystem size in GB (default: 8)"),
  memory: z.number().int().positive().default(512).optional().describe("Memory in MB (default: 512)"),
  cores: z.number().int().positive().default(1).optional().describe("CPU cores (default: 1)"),
  net0: z.string().optional().describe("Network config (e.g. 'name=eth0,bridge=vmbr0,ip=dhcp')"),
  password: z.string().optional().describe("Root password"),
  ssh_public_keys: z.string().optional().describe("SSH public keys for root"),
  unprivileged: z.boolean().default(true).optional().describe("Unprivileged container (default: true, more secure)"),
  start_after_create: z.boolean().default(false).optional().describe("Start after creation (default: false)"),
}).strict();

export const LxcStartSchema = z.object({
  node: node,
  vmid: vmid.describe("Container ID"),
}).strict();

export const LxcStopSchema = z.object({
  node: node,
  vmid: vmid.describe("Container ID"),
}).strict();

export const LxcDestroySchema = z.object({
  node: node,
  vmid: vmid.describe("Container ID to destroy"),
  confirm_destroy: z.boolean().describe("MUST be true — safety check"),
}).strict();

export const LxcConfigGetSchema = z.object({
  node: node,
  vmid: vmid.describe("Container ID"),
}).strict();

export const LxcConfigSetSchema = z.object({
  node: node,
  vmid: vmid.describe("Container ID"),
  config: z.record(z.union([z.string(), z.number(), z.boolean()])).describe(
    "Key-value config options (memory, cores, hostname, net0, etc.)"
  ),
}).strict();

// ── ISO/Image Management ────────────────────────────────────────────────────

export const IsoListSchema = z.object({
  node: node,
  storage: z.string().min(1).describe("Storage ID"),
  content: z.enum(["iso", "vztmpl"]).default("iso").optional().describe("Content type (default: iso)"),
}).strict();

export const IsoDownloadSchema = z.object({
  node: node,
  storage: z.string().min(1).describe("Target storage ID"),
  url: z.string().url().describe("Direct download URL for the ISO/template"),
  filename: z.string().min(1).describe("Filename to save as (e.g. 'ubuntu-22.04.iso')"),
  content: z.enum(["iso", "vztmpl"]).default("iso").optional().describe("Content type (default: iso)"),
  checksum: z.string().optional().describe("Expected SHA256 checksum"),
  checksum_algorithm: z.string().optional().describe("Checksum algorithm (default: sha256)"),
}).strict();

// ── HA (High Availability) ──────────────────────────────────────────────────

export const HaResourceListSchema = z.object({}).strict();

export const HaResourceCreateSchema = z.object({
  sid: z.string().min(1).describe("Service ID — 'vm:VMID' or 'ct:VMID' (e.g. 'vm:201')"),
  group: z.string().optional().describe("HA group name"),
  state: z.enum(["started", "stopped", "enabled", "disabled"]).default("started").optional()
    .describe("Desired state (default: started)"),
  max_restart: z.number().int().default(1).optional().describe("Max restart attempts on same node (default: 1)"),
  max_relocate: z.number().int().default(1).optional().describe("Max relocate attempts (default: 1)"),
  comment: z.string().optional().describe("Description"),
}).strict();

export const HaResourceDeleteSchema = z.object({
  sid: z.string().min(1).describe("Service ID (e.g. 'vm:201')"),
}).strict();

export const HaGroupListSchema = z.object({}).strict();

export const HaGroupCreateSchema = z.object({
  group: z.string().min(1).describe("Group name"),
  nodes: z.string().min(1).describe("Node list with priorities (e.g. 'pve1:2,pve2:1')"),
  restricted: z.boolean().optional().describe("Resources can only run on group nodes"),
  nofailback: z.boolean().optional().describe("Don't migrate back after recovery"),
  comment: z.string().optional().describe("Description"),
}).strict();

// ── Resource Pools ──────────────────────────────────────────────────────────

export const PoolListSchema = z.object({}).strict();

export const PoolGetSchema = z.object({
  poolid: z.string().min(1).describe("Pool name"),
}).strict();

export const PoolCreateSchema = z.object({
  poolid: z.string().min(1).describe("Pool name (no spaces)"),
  comment: z.string().optional().describe("Description"),
}).strict();

export const PoolUpdateSchema = z.object({
  poolid: z.string().min(1).describe("Pool name"),
  vms: z.string().optional().describe("Comma-separated VM/container IDs to add/remove"),
  storage: z.string().optional().describe("Comma-separated storage IDs to add/remove"),
  delete_members: z.boolean().default(false).optional().describe("Remove instead of add (default: false)"),
}).strict();

// ── Bulk Operations ─────────────────────────────────────────────────────────

export const BulkActionSchema = z.object({
  node: node,
  vmids: z.array(vmid).min(1).describe("Array of VM/container IDs"),
  action: z.enum(["start", "stop", "shutdown", "reboot", "snapshot"]).describe("Action to perform"),
  snapshot_name: z.string().optional().describe("Required when action='snapshot'"),
}).strict();

// ── Clone & Provision Workflow ──────────────────────────────────────────────

export const CloneAndProvisionSchema = z.object({
  node: node.describe("Node where the template lives"),
  template_vmid: vmid.describe("Template VMID to clone"),
  name: z.string().min(1).describe("Name for the new VM"),
  new_vmid: vmid.optional().describe("VMID for new VM — omit to auto-assign"),
  target_node: z.string().optional().describe("Deploy to a different node"),
  full_clone: z.boolean().default(true).optional().describe("Full vs linked clone (default: true)"),
  storage: z.string().optional().describe("Target storage"),
  recipes: z.array(z.string()).optional().describe("Recipes to provision after clone (e.g. ['docker', 'node'])"),
  agent_timeout: z.number().int().positive().default(120).optional().describe("Seconds to wait for guest agent (default: 120)"),
}).strict();

// ── VM Metrics ──────────────────────────────────────────────────────────────

export const VmMetricsSchema = z.object({
  node: node,
  vmid: vmid.describe("VM ID"),
  timeframe: z.enum(["hour", "day", "week", "month", "year"]).default("hour").optional()
    .describe("Time range (default: hour)"),
}).strict();

export const NodeMetricsSchema = z.object({
  node: node,
  timeframe: z.enum(["hour", "day", "week", "month", "year"]).default("hour").optional()
    .describe("Time range (default: hour)"),
}).strict();

// ── Logs / Audit ────────────────────────────────────────────────────────────

export const ClusterLogSchema = z.object({
  max: z.number().int().positive().default(100).optional().describe("Max entries (default: 100)"),
}).strict();

export const NodeSyslogSchema = z.object({
  node: node,
  limit: z.number().int().positive().default(100).optional().describe("Max lines (default: 100)"),
  since: z.string().optional().describe("Only entries since this timestamp (ISO 8601)"),
  service: z.string().optional().describe("Filter by service name (e.g. 'pvedaemon')"),
}).strict();

// ── Smart Placement ─────────────────────────────────────────────────────────

export const SmartPlacementSchema = z.object({
  min_memory_mb: z.number().int().positive().optional().describe("Minimum free memory required in MB"),
  min_cores: z.number().int().positive().optional().describe("Minimum CPU cores required"),
  prefer_empty: z.boolean().default(false).optional().describe("Heavily prefer nodes with fewer VMs"),
}).strict();

// ── Webhooks / Notifications ────────────────────────────────────────────────

export const WebhookSendSchema = z.object({
  url: z.string().url().describe("Webhook endpoint URL"),
  payload: z.record(z.unknown()).describe("JSON payload to send"),
  format: z.enum(["raw", "slack", "discord"]).default("raw").optional()
    .describe("Format shortcut (default: raw)"),
  headers: z.record(z.string()).optional().describe("Additional HTTP headers"),
}).strict();

export const WebhookTestSchema = z.object({
  url: z.string().url().describe("Webhook endpoint URL"),
  format: z.enum(["raw", "slack", "discord"]).default("raw").optional()
    .describe("Format (default: raw)"),
}).strict();

// ── DNS Management ──────────────────────────────────────────────────────────

export const DnsLookupSchema = z.object({
  node: node,
  vmid: vmid.describe("VM ID to resolve from"),
  hostname: z.string().min(1).describe("Hostname to resolve"),
}).strict();

export const DnsSetHostnameSchema = z.object({
  node: node,
  vmid: vmid.describe("VM ID"),
  hostname: z.string().min(1).describe("New hostname"),
}).strict();

// ── Provisioning ────────────────────────────────────────────────────────────

export const RecipeListSchema = z.object({
  platform: z.enum(["debian", "rhel", "windows"]).optional().describe("Filter recipes by platform. Omit to show all."),
}).strict();

export const ProvisionSchema = z.object({
  node: node,
  vmid: vmid.describe("VM ID to provision (must be running with guest agent active)"),
  recipes: z.array(z.string().min(1)).min(1).describe(
    "Ordered list of recipe names to apply. Available: docker, node, python, go, rust, tailscale, ssh_hardening, qemu_agent, monitoring, reaper_mcp. Use overlord_recipe_list to see details."
  ),
}).strict();
