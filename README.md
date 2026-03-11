# Overlord MCP

> *AI-controlled infrastructure. Provision, command, destroy.*

An MCP (Model Context Protocol) server that wraps the **Proxmox VE API**, giving AI agents full control over virtual machine and container infrastructure. 87 tools covering the complete Proxmox surface — VMs, containers, networking, firewall, storage, backup, HA, monitoring, and automated provisioning with 13 built-in recipes.

Overlord is the orchestration layer that lets an AI agent **provision its own infrastructure on demand**. It pairs with specialized MCP servers like [reaper-mcp](https://github.com/mikeshoss/reaper-mcp) (Kali Linux security tools) — Overlord provisions the environments, and tools like Reaper operate within them.

## Architecture

```
┌─────────────┐     MCP Protocol     ┌──────────────┐     Proxmox REST API     ┌──────────────┐
│   AI Agent   │ ◄──────────────────► │ Overlord MCP │ ◄────────────────────── ► │  Proxmox VE  │
│ (Claude etc) │                      │  (this repo) │                          │   Hypervisor  │
└─────────────┘                       └──────────────┘                          └──────┬───────┘
                                                                                       │
                                                                          ┌────────────┼────────────┐
                                                                          │            │            │
                                                                       ┌──▼──┐     ┌──▼──┐     ┌──▼──┐
                                                                       │ VM  │     │ LXC │     │ VM  │
                                                                       │ 100 │     │ 200 │     │ 101 │
                                                                       └─────┘     └─────┘     └─────┘
```

## Tools (87 total)

### Cluster & Node Info (4 tools)

| Tool | Description |
|------|-------------|
| `overlord_cluster_status` | Cluster name, quorum, and all node states. **Call first to discover node names.** |
| `overlord_node_status` | CPU, memory, disk, uptime for a specific node |
| `overlord_cluster_resources` | List all VMs/nodes/storage across the cluster. **Primary discovery tool.** |
| `overlord_vm_status` | Current status of a specific VM (running/stopped, CPU, memory) |

### VM Lifecycle (6 tools)

| Tool | Description |
|------|-------------|
| `overlord_vm_create` | Create a new empty VM |
| `overlord_vm_start` | Start a stopped VM |
| `overlord_vm_stop` | Hard-stop a VM (power cut) |
| `overlord_vm_shutdown` | Graceful ACPI shutdown |
| `overlord_vm_reboot` | Reboot a VM |
| `overlord_vm_destroy` | Permanently destroy a VM and all data (requires confirmation) |

### VM Configuration (3 tools)

| Tool | Description |
|------|-------------|
| `overlord_vm_config_get` | Get full VM configuration |
| `overlord_vm_config_set` | Modify VM settings (CPU, memory, network, etc.) |
| `overlord_vm_resize_disk` | Resize a VM disk |

### Snapshots (4 tools)

| Tool | Description |
|------|-------------|
| `overlord_snapshot_list` | List all snapshots of a VM |
| `overlord_snapshot_create` | Create a snapshot (disk and optionally RAM) |
| `overlord_snapshot_rollback` | Rollback VM to a snapshot (destructive) |
| `overlord_snapshot_delete` | Delete a snapshot |

### Templates (2 tools)

| Tool | Description |
|------|-------------|
| `overlord_template_list` | List available VM templates |
| `overlord_template_clone` | Clone a template into a new runnable VM |

### Guest Execution (4 tools)

| Tool | Description |
|------|-------------|
| `overlord_guest_exec` | Execute a command inside a VM via QEMU Guest Agent |
| `overlord_guest_file_read` | Read a file from inside a VM |
| `overlord_guest_file_write` | Write a file into a VM |
| `overlord_guest_ping` | Wait for guest agent to become responsive |

### Provisioning (2 tools, 13 recipes)

| Tool | Description |
|------|-------------|
| `overlord_recipe_list` | List all available provisioning recipes |
| `overlord_vm_provision` | Auto-detect platform and apply recipes (Docker, Node.js, Python, etc.) |

Built-in recipes: `docker`, `node`, `python`, `go`, `rust`, `tailscale`, `ssh_hardening`, `qemu_agent`, `monitoring`, `reaper_mcp`, `openssh_server`, `winrm`, `chocolatey`. Supports Debian/Ubuntu, RHEL/Fedora, and Windows.

### Networking (7 tools)

| Tool | Description |
|------|-------------|
| `overlord_network_list` | List all network interfaces on a node |
| `overlord_network_get` | Get detailed interface configuration |
| `overlord_network_create` | Create a bridge, bond, or VLAN (staged) |
| `overlord_network_update` | Modify an interface (staged) |
| `overlord_network_delete` | Delete an interface (staged) |
| `overlord_network_apply` | Commit staged network changes |
| `overlord_network_revert` | Discard staged network changes |

### Migration (1 tool)

| Tool | Description |
|------|-------------|
| `overlord_vm_migrate` | Live or offline migration between nodes |

### Backup & Restore (4 tools)

| Tool | Description |
|------|-------------|
| `overlord_backup_list` | List backups on a storage pool |
| `overlord_backup_create` | Create a VM backup (snapshot/suspend/stop modes) |
| `overlord_backup_restore` | Restore a VM from backup |
| `overlord_backup_delete` | Delete a backup volume |

### Storage (3 tools)

| Tool | Description |
|------|-------------|
| `overlord_storage_list` | List all storage pools with capacity |
| `overlord_storage_status` | Detailed status of a specific storage pool |
| `overlord_storage_content` | Browse volumes/ISOs/templates on a storage pool |

### Firewall (7 tools)

| Tool | Description |
|------|-------------|
| `overlord_firewall_rules_list` | List firewall rules (VM or cluster level) |
| `overlord_firewall_rule_create` | Create a firewall rule (ACCEPT/DROP/REJECT) |
| `overlord_firewall_rule_delete` | Delete a firewall rule by position |
| `overlord_firewall_options` | Get/set firewall options (enable, default policy) |
| `overlord_firewall_ipset_list` | List IP sets |
| `overlord_firewall_ipset_create` | Create a named IP set |
| `overlord_firewall_ipset_entry_add` | Add an IP/CIDR to an IP set |

### Cloud-Init (3 tools)

| Tool | Description |
|------|-------------|
| `overlord_cloudinit_get` | Get current cloud-init config of a VM |
| `overlord_cloudinit_set` | Set SSH keys, hostname, network, user-data |
| `overlord_cloudinit_regenerate` | Regenerate cloud-init ISO (required after set) |

**Workflow:** `overlord_cloudinit_set` → `overlord_cloudinit_regenerate` → `overlord_vm_reboot`

### Task Management (3 tools)

| Tool | Description |
|------|-------------|
| `overlord_task_list` | List recent/running tasks on a node |
| `overlord_task_status` | Check status of a specific task by UPID |
| `overlord_task_log` | Read task log output (debug failed operations) |

### Console Access (1 tool)

| Tool | Description |
|------|-------------|
| `overlord_vm_console` | Get VNC/SPICE console proxy ticket |

### LXC Containers (7 tools)

| Tool | Description |
|------|-------------|
| `overlord_lxc_list` | List all containers on a node |
| `overlord_lxc_create` | Create a container from a template |
| `overlord_lxc_start` | Start a container |
| `overlord_lxc_stop` | Stop a container |
| `overlord_lxc_destroy` | Destroy a container (requires confirmation) |
| `overlord_lxc_config_get` | Get container configuration |
| `overlord_lxc_config_set` | Modify container configuration |

### ISO / Image Management (2 tools)

| Tool | Description |
|------|-------------|
| `overlord_iso_list` | List ISOs or container templates on storage |
| `overlord_iso_download` | Download an ISO/template from a URL |

### High Availability (5 tools)

| Tool | Description |
|------|-------------|
| `overlord_ha_resource_list` | List HA-managed resources |
| `overlord_ha_resource_create` | Add a VM/container to HA management |
| `overlord_ha_resource_delete` | Remove from HA management |
| `overlord_ha_group_list` | List HA groups |
| `overlord_ha_group_create` | Create an HA group with node priorities |

### Resource Pools (4 tools)

| Tool | Description |
|------|-------------|
| `overlord_pool_list` | List all resource pools |
| `overlord_pool_get` | Get pool details and members |
| `overlord_pool_create` | Create a resource pool |
| `overlord_pool_update` | Add/remove VMs or storage from a pool |

### Bulk Operations (1 tool)

| Tool | Description |
|------|-------------|
| `overlord_bulk_action` | Parallel start/stop/shutdown/reboot/snapshot across multiple VMs |

### Workflows (1 tool)

| Tool | Description |
|------|-------------|
| `overlord_clone_and_provision` | All-in-one: clone → start → wait for agent → detect platform → provision |

### Metrics & Monitoring (2 tools)

| Tool | Description |
|------|-------------|
| `overlord_vm_metrics` | Historical VM performance (CPU, RAM, disk, network) |
| `overlord_node_metrics` | Historical node performance |

### Logs & Audit (2 tools)

| Tool | Description |
|------|-------------|
| `overlord_cluster_log` | Cluster-wide event log |
| `overlord_node_syslog` | Node system log |

### Smart Placement (1 tool)

| Tool | Description |
|------|-------------|
| `overlord_smart_placement` | Recommend best node based on CPU/RAM/VM density |

### Webhooks & Notifications (2 tools)

| Tool | Description |
|------|-------------|
| `overlord_webhook_send` | Send webhook notifications (Slack, Discord, custom) |
| `overlord_webhook_test` | Test a webhook endpoint |

### DNS Management (2 tools)

| Tool | Description |
|------|-------------|
| `overlord_dns_lookup` | Resolve a hostname from inside a VM |
| `overlord_dns_set_hostname` | Set a VM's hostname via guest agent |

## Quick Start

### Option 1: Docker MCP Toolkit (Claude Desktop)

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "overlord-mcp": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "PROXMOX_HOST=https://192.168.1.100:8006",
        "-e", "PROXMOX_TOKEN_ID=automation@pve!overlord",
        "-e", "PROXMOX_TOKEN_SECRET=your-token-uuid-here",
        "-e", "PROXMOX_DEFAULT_NODE=pve",
        "overlord-mcp"
      ]
    }
  }
}
```

Build the image first:

```bash
docker build -t overlord-mcp .
```

### Option 2: HTTP Transport (Docker Compose)

```bash
# Edit docker-compose.yml with your Proxmox credentials
docker compose up -d
```

The server will be available at `http://localhost:3002/mcp` with a health check at `http://localhost:3002/health`.

### Option 3: Standalone

```bash
npm install
npm run build

# Set environment variables
export PROXMOX_HOST=https://192.168.1.100:8006
export PROXMOX_TOKEN_ID=automation@pve!overlord
export PROXMOX_TOKEN_SECRET=your-token-uuid-here

# Run with stdio (default)
npm start

# Or with HTTP transport
TRANSPORT=http PORT=3002 npm start
```

## Proxmox Setup

### Creating an API Token

1. Log into the Proxmox web UI
2. Go to **Datacenter → Permissions → Users**
   - Create a user `automation@pve` (or use an existing user)
3. Go to **Datacenter → Permissions → API Tokens**
   - Select user `automation@pve`
   - Create token named `overlord`
   - **UNCHECK** "Privilege Separation" (the token needs the user's permissions)
   - Copy the **Token ID** (`automation@pve!overlord`) and **Secret** (UUID shown once)
4. Go to **Datacenter → Permissions → Add**
   - Path: `/`
   - User: `automation@pve`
   - Role: `PVEAdmin`
   - Click Add

### TLS Certificates

Proxmox uses self-signed certificates by default. Overlord MCP automatically disables TLS verification (`NODE_TLS_REJECT_UNAUTHORIZED=0`) to handle this. If you have proper certificates configured on your Proxmox instance, you can remove this by setting `NODE_TLS_REJECT_UNAUTHORIZED=1`.

## Configuration

| Environment Variable | Required | Default | Description |
|---------------------|----------|---------|-------------|
| `PROXMOX_HOST` | Yes | — | Proxmox VE URL (e.g. `https://192.168.1.100:8006`) |
| `PROXMOX_TOKEN_ID` | Yes* | — | API token ID (e.g. `automation@pve!overlord`) |
| `PROXMOX_TOKEN_SECRET` | Yes* | — | API token secret (UUID) |
| `PROXMOX_USER` | Alt* | — | Username for ticket auth (e.g. `root@pam`) |
| `PROXMOX_PASSWORD` | Alt* | — | Password for ticket auth |
| `PROXMOX_DEFAULT_NODE` | No | — | Default Proxmox node name |
| `PROXMOX_DEFAULT_STORAGE` | No | `local-lvm` | Default storage for new VMs |
| `TRANSPORT` | No | `stdio` | Transport mode: `stdio` or `http` |
| `PORT` | No | `3002` | HTTP port (when TRANSPORT=http) |

\* Either `PROXMOX_TOKEN_ID`/`PROXMOX_TOKEN_SECRET` (recommended) or `PROXMOX_USER`/`PROXMOX_PASSWORD` must be set.

## The Vision

Overlord MCP is the **infrastructure control plane** for AI agents. The architecture:

- **Overlord MCP** — provisions and manages VM/container infrastructure (this project)
- **Reaper MCP** — Kali Linux security tools for penetration testing
- **Future MCP servers** — domain-specific tools that operate within Overlord-managed environments

An AI agent uses Overlord to spin up a fresh VM from a template, deploys tools into it, performs its task, and tears it down when done. Full lifecycle automation, controlled entirely through MCP.

## Template Preparation

For the best experience, prepare VM templates with tools pre-installed:

1. Create a VM and install your desired OS
2. Install the QEMU Guest Agent: `apt install qemu-guest-agent` (Debian/Ubuntu)
3. Enable and start the agent: `systemctl enable --now qemu-guest-agent`
4. Install any tools you want available (e.g., MCP servers, development tools)
5. Clean up: `apt clean && rm -rf /tmp/*`
6. In Proxmox UI: right-click the VM → **Convert to Template**

The template can then be cloned via `overlord_template_clone` to create new VMs on demand.

## Project Structure

```
overlord-mcp/
├── package.json
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml
├── src/
│   ├── index.ts              # Entry point — registers all 87 tools, handles transport
│   ├── constants.ts          # API defaults, timeouts, env var names
│   ├── types.ts              # TypeScript interfaces for Proxmox API responses
│   ├── schemas/
│   │   └── tools.ts          # Zod input schemas for every tool
│   ├── services/
│   │   ├── proxmox-client.ts # Proxmox API HTTP client (auth, request helpers)
│   │   └── task-poller.ts    # Poll Proxmox task status until completion
│   ├── recipes/
│   │   ├── index.ts          # Recipe registry and platform detection
│   │   └── *.ts              # 13 provisioning recipes (docker, node, python, etc.)
│   └── tools/
│       ├── cluster.ts        # Cluster/node info and resource overview
│       ├── vm-lifecycle.ts   # Create, start, stop, shutdown, reboot, destroy
│       ├── vm-config.ts      # Get/modify VM configuration, resize disks
│       ├── snapshots.ts      # Create, list, rollback, delete snapshots
│       ├── templates.ts      # List templates, clone from template
│       ├── guest-exec.ts     # Execute commands, read/write files inside VMs
│       ├── provision.ts      # Auto-detect platform, apply recipes
│       ├── networking.ts     # Bridges, bonds, VLANs — staged create/apply
│       ├── migration.ts      # Live and offline VM migration
│       ├── backup.ts         # Backup/restore with vzdump
│       ├── storage.ts        # Storage pools, volumes, capacity
│       ├── firewall.ts       # Rules, IP sets, options at VM/cluster level
│       ├── cloud-init.ts     # SSH keys, hostname, network config injection
│       ├── tasks.ts          # Task list, status, log reading
│       ├── console.ts        # VNC/SPICE console proxy tickets
│       ├── lxc.ts            # LXC container lifecycle and config
│       ├── iso.ts            # ISO/template listing and download
│       ├── ha.ts             # High availability resources and groups
│       ├── pools.ts          # Resource pools for access control
│       ├── bulk.ts           # Parallel operations across VM fleets
│       ├── workflows.ts      # Clone-and-provision all-in-one workflow
│       ├── metrics.ts        # VM and node RRD performance data
│       ├── logs.ts           # Cluster event log, node syslog
│       ├── placement.ts      # Smart node recommendation engine
│       ├── notify.ts         # Webhook notifications (Slack, Discord, etc.)
│       └── dns.ts            # DNS lookup and hostname management
```

## License

MIT — see [LICENSE](LICENSE)
