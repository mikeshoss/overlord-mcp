# Overlord MCP

> *AI-controlled infrastructure. Provision, command, destroy.*

An MCP (Model Context Protocol) server that wraps the **Proxmox VE API**, giving AI agents full control over virtual machine infrastructure. List, create, clone, start, stop, snapshot, rollback, destroy VMs, execute commands inside guests via QEMU Guest Agent, and manage VM templates — all through standardized MCP tools.

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
                                                                       │ VM  │     │ VM  │     │ VM  │
                                                                       │ 100 │     │ 101 │     │ 102 │
                                                                       └─────┘     └─────┘     └─────┘
```

## Tools (20 total)

### Cluster & Node Info

| Tool | Description |
|------|-------------|
| `overlord_cluster_status` | Get cluster name, quorum status, and node states |
| `overlord_node_status` | Get CPU, memory, disk, uptime for a specific node |
| `overlord_cluster_resources` | List all VMs/nodes/storage across the cluster |

### VM Lifecycle

| Tool | Description |
|------|-------------|
| `overlord_vm_create` | Create a new empty VM |
| `overlord_vm_start` | Start a stopped VM |
| `overlord_vm_stop` | Hard-stop a VM (power cut) |
| `overlord_vm_shutdown` | Graceful ACPI shutdown |
| `overlord_vm_reboot` | Reboot a VM |
| `overlord_vm_destroy` | Permanently destroy a VM and all data (requires confirmation) |

### VM Configuration

| Tool | Description |
|------|-------------|
| `overlord_vm_config_get` | Get full VM configuration |
| `overlord_vm_config_set` | Modify VM settings (CPU, memory, network, etc.) |
| `overlord_vm_resize_disk` | Resize a VM disk |

### Snapshots

| Tool | Description |
|------|-------------|
| `overlord_snapshot_list` | List all snapshots of a VM |
| `overlord_snapshot_create` | Create a snapshot (disk and optionally RAM) |
| `overlord_snapshot_rollback` | Rollback VM to a snapshot (destructive) |
| `overlord_snapshot_delete` | Delete a snapshot |

### Templates

| Tool | Description |
|------|-------------|
| `overlord_template_list` | List available VM templates |
| `overlord_template_clone` | Clone a template into a new runnable VM |

### Guest Execution

| Tool | Description |
|------|-------------|
| `overlord_guest_exec` | Execute a command inside a VM via QEMU Guest Agent |
| `overlord_guest_file_read` | Read a file from inside a VM |

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

- **Overlord MCP** — provisions and manages VM infrastructure (this project)
- **Reaper MCP** — Kali Linux security tools for penetration testing
- **Future MCP servers** — monitoring, networking, storage, backup, etc.

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
├── .gitignore
├── LICENSE
├── README.md
├── package.json
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml
├── src/
│   ├── index.ts              # Entry point — registers tools, handles transport
│   ├── constants.ts          # API defaults, timeouts, env var names
│   ├── types.ts              # TypeScript interfaces for Proxmox API responses
│   ├── schemas/
│   │   └── tools.ts          # Zod input schemas for every tool
│   ├── services/
│   │   ├── proxmox-client.ts # Proxmox API HTTP client (auth, request helpers)
│   │   └── task-poller.ts    # Poll Proxmox task status until completion
│   └── tools/
│       ├── cluster.ts        # Cluster/node info and resource overview
│       ├── vm-lifecycle.ts   # Create, clone, start, stop, shutdown, destroy VMs
│       ├── vm-config.ts      # Get/modify VM configuration, resize disks
│       ├── snapshots.ts      # Create, list, rollback, delete snapshots
│       ├── templates.ts      # List templates, clone from template
│       └── guest-exec.ts     # Execute commands inside VMs via QEMU Guest Agent
```

## License

MIT — see [LICENSE](LICENSE)
