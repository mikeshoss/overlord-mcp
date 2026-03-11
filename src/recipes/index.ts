/**
 * Provisioning recipes — shell scripts that install/configure capabilities on a VM.
 *
 * Each recipe is a self-contained bash script that:
 *  - Runs as root via qemu-guest-agent
 *  - Is idempotent (safe to run multiple times)
 *  - Outputs progress to stdout
 *  - Exits 0 on success, non-zero on failure
 *
 * Agents pick from this menu when provisioning a VM:
 *   overlord_vm_provision({ node, vmid, recipes: ["docker", "node"] })
 */

export interface Recipe {
  name: string;
  description: string;
  script: string;
  timeoutSeconds: number;
}

const recipes: Record<string, Recipe> = {
  docker: {
    name: "docker",
    description: "Install Docker Engine and Docker Compose plugin",
    timeoutSeconds: 300,
    script: `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if command -v docker &>/dev/null; then
  echo "Docker already installed: $(docker --version)"
  exit 0
fi

# Install dependencies
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg

# Add Docker GPG key and repo
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list

apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable --now docker
echo "Docker installed: $(docker --version)"
`,
  },

  node: {
    name: "node",
    description: "Install Node.js 22 LTS via NodeSource",
    timeoutSeconds: 180,
    script: `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if command -v node &>/dev/null; then
  echo "Node.js already installed: $(node --version)"
  exit 0
fi

apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg

curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y -qq nodejs

echo "Node.js installed: $(node --version), npm: $(npm --version)"
`,
  },

  python: {
    name: "python",
    description: "Install Python 3, pip, and venv",
    timeoutSeconds: 120,
    script: `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if command -v python3 &>/dev/null && python3 -m pip --version &>/dev/null; then
  echo "Python already installed: $(python3 --version)"
  exit 0
fi

apt-get update -qq
apt-get install -y -qq python3 python3-pip python3-venv python3-dev

echo "Python installed: $(python3 --version), pip: $(python3 -m pip --version)"
`,
  },

  go: {
    name: "go",
    description: "Install Go (latest stable)",
    timeoutSeconds: 180,
    script: `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if command -v go &>/dev/null; then
  echo "Go already installed: $(go version)"
  exit 0
fi

GO_VERSION=$(curl -fsSL 'https://go.dev/VERSION?m=text' | head -1)
curl -fsSL "https://go.dev/dl/\${GO_VERSION}.linux-amd64.tar.gz" | tar -C /usr/local -xzf -
echo 'export PATH=$PATH:/usr/local/go/bin' > /etc/profile.d/go.sh
export PATH=$PATH:/usr/local/go/bin

echo "Go installed: $(go version)"
`,
  },

  rust: {
    name: "rust",
    description: "Install Rust toolchain via rustup (system-wide)",
    timeoutSeconds: 300,
    script: `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if command -v rustc &>/dev/null; then
  echo "Rust already installed: $(rustc --version)"
  exit 0
fi

apt-get update -qq
apt-get install -y -qq curl build-essential

export RUSTUP_HOME=/opt/rustup
export CARGO_HOME=/opt/cargo
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path

cat > /etc/profile.d/rust.sh << 'PROFILE'
export RUSTUP_HOME=/opt/rustup
export CARGO_HOME=/opt/cargo
export PATH=$CARGO_HOME/bin:$PATH
PROFILE

export PATH=$CARGO_HOME/bin:$PATH
echo "Rust installed: $(rustc --version)"
`,
  },

  tailscale: {
    name: "tailscale",
    description: "Install Tailscale VPN client (requires 'tailscale up' after install to authenticate)",
    timeoutSeconds: 120,
    script: `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if command -v tailscale &>/dev/null; then
  echo "Tailscale already installed: $(tailscale version)"
  exit 0
fi

curl -fsSL https://tailscale.com/install.sh | sh

systemctl enable --now tailscaled
echo "Tailscale installed: $(tailscale version)"
echo "NOTE: Run 'tailscale up' to authenticate this node."
`,
  },

  ssh_hardening: {
    name: "ssh_hardening",
    description: "Harden SSH: disable root login, disable password auth, restart sshd",
    timeoutSeconds: 30,
    script: `#!/bin/bash
set -euo pipefail

SSHD_CONFIG="/etc/ssh/sshd_config"

# Disable root login
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' "$SSHD_CONFIG"

# Disable password authentication
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' "$SSHD_CONFIG"

# Disable empty passwords
sed -i 's/^#*PermitEmptyPasswords.*/PermitEmptyPasswords no/' "$SSHD_CONFIG"

systemctl restart sshd
echo "SSH hardened: root login disabled, password auth disabled"
`,
  },

  qemu_agent: {
    name: "qemu_agent",
    description: "Install and enable QEMU Guest Agent (required for guest-exec tools to work)",
    timeoutSeconds: 60,
    script: `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if systemctl is-active --quiet qemu-guest-agent 2>/dev/null; then
  echo "qemu-guest-agent already running"
  exit 0
fi

apt-get update -qq
apt-get install -y -qq qemu-guest-agent
systemctl enable --now qemu-guest-agent

echo "qemu-guest-agent installed and running"
`,
  },

  monitoring: {
    name: "monitoring",
    description: "Install Prometheus node_exporter for monitoring (exposes metrics on :9100)",
    timeoutSeconds: 120,
    script: `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if systemctl is-active --quiet node_exporter 2>/dev/null; then
  echo "node_exporter already running"
  exit 0
fi

useradd --no-create-home --shell /bin/false node_exporter 2>/dev/null || true

VERSION="1.7.0"
curl -fsSL "https://github.com/prometheus/node_exporter/releases/download/v\${VERSION}/node_exporter-\${VERSION}.linux-amd64.tar.gz" | tar -xzf - -C /tmp
cp "/tmp/node_exporter-\${VERSION}.linux-amd64/node_exporter" /usr/local/bin/
chown node_exporter:node_exporter /usr/local/bin/node_exporter

cat > /etc/systemd/system/node_exporter.service << 'SERVICE'
[Unit]
Description=Node Exporter
After=network.target

[Service]
User=node_exporter
ExecStart=/usr/local/bin/node_exporter
Restart=always

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable --now node_exporter

echo "node_exporter installed and running on :9100"
`,
  },

  reaper_mcp: {
    name: "reaper_mcp",
    description: "Install reaper-mcp (Kali security tools MCP server) — requires Docker recipe first",
    timeoutSeconds: 300,
    script: `#!/bin/bash
set -euo pipefail

if ! command -v docker &>/dev/null; then
  echo "ERROR: Docker is required. Add 'docker' to your recipes list before 'reaper_mcp'."
  exit 1
fi

# Pull the reaper-mcp image
docker pull ghcr.io/mikeshoss/reaper-mcp:latest 2>/dev/null || {
  echo "Pre-built image not found. Building from source..."
  apt-get update -qq
  apt-get install -y -qq git

  cd /opt
  git clone https://github.com/mikeshoss/reaper-mcp.git
  cd reaper-mcp
  docker build -t reaper-mcp .
  echo "reaper-mcp built from source"
  exit 0
}

echo "reaper-mcp image pulled and ready"
echo "Run with: docker run -i --rm reaper-mcp"
`,
  },
};

export function getRecipe(name: string): Recipe | undefined {
  return recipes[name];
}

export function getAllRecipes(): Recipe[] {
  return Object.values(recipes);
}

export function getRecipeNames(): string[] {
  return Object.keys(recipes);
}
