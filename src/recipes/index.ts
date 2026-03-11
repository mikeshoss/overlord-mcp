/**
 * Provisioning recipes — platform-aware scripts that install/configure capabilities on a VM.
 *
 * Each recipe has variants for different platforms:
 *   - debian:  Ubuntu, Debian, Kali, Mint (apt-get)
 *   - rhel:    Fedora, CentOS, RHEL, Rocky, Alma (dnf/yum)
 *   - windows: Windows 10/11/Server (PowerShell)
 *
 * The provision tool auto-detects the VM's platform at runtime and picks
 * the right variant. If a recipe doesn't support the detected platform,
 * it fails with a clear message.
 *
 * Agents pick from this menu when provisioning a VM:
 *   overlord_vm_provision({ node, vmid, recipes: ["docker", "node"] })
 */

export type Platform = "debian" | "rhel" | "windows";

export interface RecipeVariant {
  script: string;
  shell: "bash" | "powershell";
}

export interface Recipe {
  name: string;
  description: string;
  timeoutSeconds: number;
  platforms: Partial<Record<Platform, RecipeVariant>>;
  dependencies?: string[];
}

/**
 * Shell script that detects the platform.
 * Outputs one of: debian, rhel, unknown
 */
export const LINUX_DETECT_SCRIPT = `#!/bin/bash
if [ -f /etc/os-release ]; then
  . /etc/os-release
  case "$ID" in
    ubuntu|debian|kali|linuxmint|pop) echo "debian" ;;
    fedora|centos|rhel|rocky|alma|ol) echo "rhel" ;;
    *) case "$ID_LIKE" in
         *debian*|*ubuntu*) echo "debian" ;;
         *rhel*|*fedora*|*centos*) echo "rhel" ;;
         *) echo "unknown:$ID" ;;
       esac ;;
  esac
else
  echo "unknown:no-os-release"
fi
`;

/**
 * PowerShell script that confirms Windows platform.
 */
export const WINDOWS_DETECT_SCRIPT = `
if ($env:OS -eq "Windows_NT") { Write-Output "windows" } else { Write-Output "unknown" }
`;

const recipes: Record<string, Recipe> = {

  // ── Docker ──────────────────────────────────────────────────────────────────

  docker: {
    name: "docker",
    description: "Install Docker Engine and Docker Compose plugin",
    timeoutSeconds: 300,
    platforms: {
      debian: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if command -v docker &>/dev/null; then
  echo "Docker already installed: $(docker --version)"
  exit 0
fi

apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg

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
      rhel: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

if command -v docker &>/dev/null; then
  echo "Docker already installed: $(docker --version)"
  exit 0
fi

dnf -y install dnf-plugins-core
dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo
dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable --now docker
echo "Docker installed: $(docker --version)"
`,
      },
      windows: {
        shell: "powershell",
        script: `
if (Get-Command docker -ErrorAction SilentlyContinue) {
  Write-Output "Docker already installed: $(docker --version)"
  exit 0
}

# Install Docker Desktop via winget (Windows 10/11)
if (Get-Command winget -ErrorAction SilentlyContinue) {
  winget install -e --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements
  Write-Output "Docker Desktop installed via winget. Restart may be required."
} else {
  # Fallback: enable Containers feature (Windows Server)
  Enable-WindowsOptionalFeature -Online -FeatureName Containers -All -NoRestart
  Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All -NoRestart
  Write-Output "Container features enabled. Install Docker Desktop manually or restart for Server containers."
}
`,
      },
    },
  },

  // ── Node.js ─────────────────────────────────────────────────────────────────

  node: {
    name: "node",
    description: "Install Node.js 22 LTS",
    timeoutSeconds: 180,
    platforms: {
      debian: {
        shell: "bash",
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
      rhel: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

if command -v node &>/dev/null; then
  echo "Node.js already installed: $(node --version)"
  exit 0
fi

curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
dnf -y install nodejs

echo "Node.js installed: $(node --version), npm: $(npm --version)"
`,
      },
      windows: {
        shell: "powershell",
        script: `
if (Get-Command node -ErrorAction SilentlyContinue) {
  Write-Output "Node.js already installed: $(node --version)"
  exit 0
}

if (Get-Command winget -ErrorAction SilentlyContinue) {
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  # Refresh PATH
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
  Write-Output "Node.js installed via winget"
} else {
  Write-Output "ERROR: winget not available. Install Node.js manually from https://nodejs.org"
  exit 1
}
`,
      },
    },
  },

  // ── Python ──────────────────────────────────────────────────────────────────

  python: {
    name: "python",
    description: "Install Python 3, pip, and venv",
    timeoutSeconds: 120,
    platforms: {
      debian: {
        shell: "bash",
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
      rhel: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

if command -v python3 &>/dev/null && python3 -m pip --version &>/dev/null; then
  echo "Python already installed: $(python3 --version)"
  exit 0
fi

dnf -y install python3 python3-pip python3-devel

echo "Python installed: $(python3 --version), pip: $(python3 -m pip --version)"
`,
      },
      windows: {
        shell: "powershell",
        script: `
if (Get-Command python -ErrorAction SilentlyContinue) {
  Write-Output "Python already installed: $(python --version)"
  exit 0
}

if (Get-Command winget -ErrorAction SilentlyContinue) {
  winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
  Write-Output "Python installed via winget"
} else {
  Write-Output "ERROR: winget not available. Install Python manually from https://python.org"
  exit 1
}
`,
      },
    },
  },

  // ── Go ──────────────────────────────────────────────────────────────────────

  go: {
    name: "go",
    description: "Install Go (latest stable)",
    timeoutSeconds: 180,
    platforms: {
      debian: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

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
      rhel: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

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
      windows: {
        shell: "powershell",
        script: `
if (Get-Command go -ErrorAction SilentlyContinue) {
  Write-Output "Go already installed: $(go version)"
  exit 0
}

if (Get-Command winget -ErrorAction SilentlyContinue) {
  winget install -e --id GoLang.Go --accept-source-agreements --accept-package-agreements
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
  Write-Output "Go installed via winget"
} else {
  Write-Output "ERROR: winget not available."
  exit 1
}
`,
      },
    },
  },

  // ── Rust ────────────────────────────────────────────────────────────────────

  rust: {
    name: "rust",
    description: "Install Rust toolchain via rustup",
    timeoutSeconds: 300,
    platforms: {
      debian: {
        shell: "bash",
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
      rhel: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

if command -v rustc &>/dev/null; then
  echo "Rust already installed: $(rustc --version)"
  exit 0
fi

dnf -y install curl gcc make

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
      windows: {
        shell: "powershell",
        script: `
if (Get-Command rustc -ErrorAction SilentlyContinue) {
  Write-Output "Rust already installed: $(rustc --version)"
  exit 0
}

if (Get-Command winget -ErrorAction SilentlyContinue) {
  winget install -e --id Rustlang.Rustup --accept-source-agreements --accept-package-agreements
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
  Write-Output "Rust installed via winget"
} else {
  Write-Output "ERROR: winget not available."
  exit 1
}
`,
      },
    },
  },

  // ── Tailscale ───────────────────────────────────────────────────────────────

  tailscale: {
    name: "tailscale",
    description: "Install Tailscale VPN client (requires 'tailscale up' after to authenticate)",
    timeoutSeconds: 120,
    platforms: {
      debian: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

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
      rhel: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

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
      windows: {
        shell: "powershell",
        script: `
if (Get-Command tailscale -ErrorAction SilentlyContinue) {
  Write-Output "Tailscale already installed"
  exit 0
}

if (Get-Command winget -ErrorAction SilentlyContinue) {
  winget install -e --id Tailscale.Tailscale --accept-source-agreements --accept-package-agreements
  Write-Output "Tailscale installed. Launch from Start menu to authenticate."
} else {
  Write-Output "ERROR: winget not available."
  exit 1
}
`,
      },
    },
  },

  // ── SSH Hardening ───────────────────────────────────────────────────────────

  ssh_hardening: {
    name: "ssh_hardening",
    description: "Harden SSH: disable root login, disable password auth, restart sshd",
    timeoutSeconds: 30,
    platforms: {
      debian: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

SSHD_CONFIG="/etc/ssh/sshd_config"
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' "$SSHD_CONFIG"
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' "$SSHD_CONFIG"
sed -i 's/^#*PermitEmptyPasswords.*/PermitEmptyPasswords no/' "$SSHD_CONFIG"

systemctl restart sshd
echo "SSH hardened: root login disabled, password auth disabled"
`,
      },
      rhel: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

SSHD_CONFIG="/etc/ssh/sshd_config"
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' "$SSHD_CONFIG"
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' "$SSHD_CONFIG"
sed -i 's/^#*PermitEmptyPasswords.*/PermitEmptyPasswords no/' "$SSHD_CONFIG"

systemctl restart sshd
echo "SSH hardened: root login disabled, password auth disabled"
`,
      },
      windows: {
        shell: "powershell",
        script: `
# Harden OpenSSH Server on Windows
$sshdConfig = "$env:ProgramData\\ssh\\sshd_config"
if (Test-Path $sshdConfig) {
  $content = Get-Content $sshdConfig
  $content = $content -replace '^#?PermitRootLogin.*','PermitRootLogin no'
  $content = $content -replace '^#?PasswordAuthentication.*','PasswordAuthentication no'
  $content | Set-Content $sshdConfig
  Restart-Service sshd -ErrorAction SilentlyContinue
  Write-Output "SSH hardened on Windows"
} else {
  Write-Output "OpenSSH Server not installed. Skipping."
}
`,
      },
    },
  },

  // ── QEMU Guest Agent ────────────────────────────────────────────────────────

  qemu_agent: {
    name: "qemu_agent",
    description: "Install and enable QEMU Guest Agent (required for guest-exec tools)",
    timeoutSeconds: 60,
    platforms: {
      debian: {
        shell: "bash",
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
      rhel: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

if systemctl is-active --quiet qemu-guest-agent 2>/dev/null; then
  echo "qemu-guest-agent already running"
  exit 0
fi

dnf -y install qemu-guest-agent
systemctl enable --now qemu-guest-agent

echo "qemu-guest-agent installed and running"
`,
      },
      windows: {
        shell: "powershell",
        script: `
# On Windows, the QEMU Guest Agent is typically installed via the VirtIO drivers ISO.
# Check if the service exists
$svc = Get-Service -Name "QEMU-GA" -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
  Write-Output "QEMU Guest Agent already running"
  exit 0
}

if ($svc) {
  Start-Service "QEMU-GA"
  Set-Service "QEMU-GA" -StartupType Automatic
  Write-Output "QEMU Guest Agent started"
} else {
  Write-Output "QEMU Guest Agent not found. Install VirtIO guest tools from the VirtIO ISO (virtio-win-gt-x64.msi)."
  exit 1
}
`,
      },
    },
  },

  // ── Monitoring ──────────────────────────────────────────────────────────────

  monitoring: {
    name: "monitoring",
    description: "Install Prometheus node_exporter for monitoring (exposes metrics on :9100)",
    timeoutSeconds: 120,
    platforms: {
      debian: {
        shell: "bash",
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
      rhel: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

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
      windows: {
        shell: "powershell",
        script: `
# Windows exporter (Prometheus metrics for Windows)
$svc = Get-Service -Name "windows_exporter" -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
  Write-Output "windows_exporter already running on :9182"
  exit 0
}

$version = "0.25.1"
$url = "https://github.com/prometheus-community/windows_exporter/releases/download/v$version/windows_exporter-$version-amd64.msi"
$msi = "$env:TEMP\\windows_exporter.msi"

Invoke-WebRequest -Uri $url -OutFile $msi
Start-Process msiexec.exe -Wait -ArgumentList "/i $msi /quiet"
Remove-Item $msi -Force

Write-Output "windows_exporter installed and running on :9182"
`,
      },
    },
  },

  // ── Reaper MCP ──────────────────────────────────────────────────────────────

  reaper_mcp: {
    name: "reaper_mcp",
    description: "Install reaper-mcp (Kali security tools MCP server) — requires 'docker' recipe first",
    timeoutSeconds: 300,
    dependencies: ["docker"],
    platforms: {
      debian: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

if ! command -v docker &>/dev/null; then
  echo "ERROR: Docker is required. Add 'docker' to your recipes list before 'reaper_mcp'."
  exit 1
fi

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
      rhel: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

if ! command -v docker &>/dev/null; then
  echo "ERROR: Docker is required. Add 'docker' to your recipes list before 'reaper_mcp'."
  exit 1
fi

docker pull ghcr.io/mikeshoss/reaper-mcp:latest 2>/dev/null || {
  echo "Pre-built image not found. Building from source..."
  dnf -y install git

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
    },
  },

  // ── OpenSSH Server (Windows) ────────────────────────────────────────────────

  openssh_server: {
    name: "openssh_server",
    description: "Install and enable OpenSSH Server (primarily useful on Windows)",
    timeoutSeconds: 60,
    platforms: {
      debian: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if systemctl is-active --quiet sshd 2>/dev/null || systemctl is-active --quiet ssh 2>/dev/null; then
  echo "SSH server already running"
  exit 0
fi

apt-get update -qq
apt-get install -y -qq openssh-server
systemctl enable --now ssh

echo "OpenSSH server installed and running"
`,
      },
      rhel: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

if systemctl is-active --quiet sshd 2>/dev/null; then
  echo "SSH server already running"
  exit 0
fi

dnf -y install openssh-server
systemctl enable --now sshd

echo "OpenSSH server installed and running"
`,
      },
      windows: {
        shell: "powershell",
        script: `
$svc = Get-Service -Name sshd -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
  Write-Output "OpenSSH Server already running"
  exit 0
}

# Install OpenSSH Server capability
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0

Start-Service sshd
Set-Service -Name sshd -StartupType Automatic

# Allow through firewall
New-NetFirewallRule -Name "OpenSSH-Server" -DisplayName "OpenSSH Server (sshd)" -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 -ErrorAction SilentlyContinue

Write-Output "OpenSSH Server installed and running on port 22"
`,
      },
    },
  },

  // ── WinRM (Windows Remote Management) ───────────────────────────────────────

  winrm: {
    name: "winrm",
    description: "Enable WinRM for remote management (Windows only)",
    timeoutSeconds: 30,
    platforms: {
      windows: {
        shell: "powershell",
        script: `
$svc = Get-Service -Name WinRM -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
  Write-Output "WinRM already running"
  exit 0
}

Enable-PSRemoting -Force -SkipNetworkProfileCheck
Set-Item WSMan:\\localhost\\Client\\TrustedHosts -Value "*" -Force

Write-Output "WinRM enabled and configured"
`,
      },
    },
  },

  // ── Chocolatey (Windows package manager) ────────────────────────────────────

  chocolatey: {
    name: "chocolatey",
    description: "Install Chocolatey package manager (Windows only)",
    timeoutSeconds: 120,
    platforms: {
      windows: {
        shell: "powershell",
        script: `
if (Get-Command choco -ErrorAction SilentlyContinue) {
  Write-Output "Chocolatey already installed: $(choco --version)"
  exit 0
}

Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

Write-Output "Chocolatey installed: $(choco --version)"
`,
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // AI / Agents
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Ollama ─────────────────────────────────────────────────────────────────

  ollama: {
    name: "ollama",
    description: "Install Ollama local LLM server for running models like Llama, Mistral, and Gemma locally",
    timeoutSeconds: 300,
    platforms: {
      debian: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

if command -v ollama &>/dev/null; then
  echo "Ollama already installed: $(ollama --version)"
  exit 0
fi

curl -fsSL https://ollama.com/install.sh | sh

echo "Ollama installed: $(ollama --version)"
echo "NOTE: Run 'ollama pull llama3' to download a model, then 'ollama serve' to start the API on :11434"
`,
      },
      rhel: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

if command -v ollama &>/dev/null; then
  echo "Ollama already installed: $(ollama --version)"
  exit 0
fi

curl -fsSL https://ollama.com/install.sh | sh

echo "Ollama installed: $(ollama --version)"
echo "NOTE: Run 'ollama pull llama3' to download a model, then 'ollama serve' to start the API on :11434"
`,
      },
      windows: {
        shell: "powershell",
        script: `
if (Get-Command ollama -ErrorAction SilentlyContinue) {
  Write-Output "Ollama already installed"
  exit 0
}

if (Get-Command winget -ErrorAction SilentlyContinue) {
  winget install -e --id Ollama.Ollama --accept-source-agreements --accept-package-agreements
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
  Write-Output "Ollama installed via winget"
  Write-Output "NOTE: Run 'ollama pull llama3' to download a model"
} else {
  Write-Output "ERROR: winget not available."
  exit 1
}
`,
      },
    },
  },

  // ── Open WebUI ─────────────────────────────────────────────────────────────

  open_webui: {
    name: "open_webui",
    description: "Install Open WebUI — web chat interface for Ollama and OpenAI-compatible APIs (requires Docker)",
    timeoutSeconds: 300,
    dependencies: ["docker"],
    platforms: {
      debian: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

if docker ps --filter name=open-webui --format '{{.Names}}' 2>/dev/null | grep -q open-webui; then
  echo "Open WebUI already running"
  exit 0
fi

if ! command -v docker &>/dev/null; then
  echo "ERROR: Docker is required. Add 'docker' to your recipes list before 'open_webui'."
  exit 1
fi

docker run -d --name open-webui --restart always \
  -p 3000:8080 \
  -v open-webui:/app/backend/data \
  ghcr.io/open-webui/open-webui:main

echo "Open WebUI installed and running on :3000"
echo "NOTE: Configure Ollama URL in the UI settings if Ollama is on a different host."
`,
      },
      rhel: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

if docker ps --filter name=open-webui --format '{{.Names}}' 2>/dev/null | grep -q open-webui; then
  echo "Open WebUI already running"
  exit 0
fi

if ! command -v docker &>/dev/null; then
  echo "ERROR: Docker is required. Add 'docker' to your recipes list before 'open_webui'."
  exit 1
fi

docker run -d --name open-webui --restart always \
  -p 3000:8080 \
  -v open-webui:/app/backend/data \
  ghcr.io/open-webui/open-webui:main

echo "Open WebUI installed and running on :3000"
echo "NOTE: Configure Ollama URL in the UI settings if Ollama is on a different host."
`,
      },
    },
  },

  // ── OpenClaw ───────────────────────────────────────────────────────────────

  openclaw: {
    name: "openclaw",
    description: "Install OpenClaw AI assistant — connects to messaging apps and takes actions on your behalf (requires Docker + Node.js)",
    timeoutSeconds: 600,
    dependencies: ["docker", "node"],
    platforms: {
      debian: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if [ -d /opt/openclaw ] && docker ps --filter name=openclaw --format '{{.Names}}' 2>/dev/null | grep -q openclaw; then
  echo "OpenClaw already installed and running"
  exit 0
fi

if ! command -v docker &>/dev/null; then
  echo "ERROR: Docker is required. Add 'docker' to your recipes list before 'openclaw'."
  exit 1
fi

apt-get update -qq
apt-get install -y -qq git

cd /opt
if [ ! -d openclaw ]; then
  git clone https://github.com/openclaw/openclaw.git
fi
cd openclaw
docker compose up -d

echo "OpenClaw installed at /opt/openclaw and running"
echo "NOTE: Configure your messaging integrations in /opt/openclaw/.env"
`,
      },
      rhel: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

if [ -d /opt/openclaw ] && docker ps --filter name=openclaw --format '{{.Names}}' 2>/dev/null | grep -q openclaw; then
  echo "OpenClaw already installed and running"
  exit 0
fi

if ! command -v docker &>/dev/null; then
  echo "ERROR: Docker is required. Add 'docker' to your recipes list before 'openclaw'."
  exit 1
fi

dnf -y install git

cd /opt
if [ ! -d openclaw ]; then
  git clone https://github.com/openclaw/openclaw.git
fi
cd openclaw
docker compose up -d

echo "OpenClaw installed at /opt/openclaw and running"
echo "NOTE: Configure your messaging integrations in /opt/openclaw/.env"
`,
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Security
  // ═══════════════════════════════════════════════════════════════════════════

  // ── MITRE Caldera ──────────────────────────────────────────────────────────

  caldera: {
    name: "caldera",
    description: "Install MITRE Caldera adversary emulation platform (requires Docker)",
    timeoutSeconds: 600,
    dependencies: ["docker"],
    platforms: {
      debian: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if [ -d /opt/caldera ] && docker ps --filter name=caldera --format '{{.Names}}' 2>/dev/null | grep -q caldera; then
  echo "Caldera already installed and running"
  exit 0
fi

if ! command -v docker &>/dev/null; then
  echo "ERROR: Docker is required. Add 'docker' to your recipes list before 'caldera'."
  exit 1
fi

apt-get update -qq
apt-get install -y -qq git

cd /opt
if [ ! -d caldera ]; then
  git clone https://github.com/mitre/caldera.git --recursive --depth 1
fi
cd caldera
docker compose up -d

echo "Caldera installed at /opt/caldera and running"
echo "NOTE: Default web UI at http://<vm-ip>:8888 — default creds: admin/admin"
`,
      },
      rhel: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

if [ -d /opt/caldera ] && docker ps --filter name=caldera --format '{{.Names}}' 2>/dev/null | grep -q caldera; then
  echo "Caldera already installed and running"
  exit 0
fi

if ! command -v docker &>/dev/null; then
  echo "ERROR: Docker is required. Add 'docker' to your recipes list before 'caldera'."
  exit 1
fi

dnf -y install git

cd /opt
if [ ! -d caldera ]; then
  git clone https://github.com/mitre/caldera.git --recursive --depth 1
fi
cd caldera
docker compose up -d

echo "Caldera installed at /opt/caldera and running"
echo "NOTE: Default web UI at http://<vm-ip>:8888 — default creds: admin/admin"
`,
      },
    },
  },

  // ── Greenbone (OpenVAS) ────────────────────────────────────────────────────

  greenbone: {
    name: "greenbone",
    description: "Install Greenbone/OpenVAS vulnerability scanner (requires Docker)",
    timeoutSeconds: 600,
    dependencies: ["docker"],
    platforms: {
      debian: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

if docker ps --filter name=greenbone --format '{{.Names}}' 2>/dev/null | grep -q greenbone; then
  echo "Greenbone already running"
  exit 0
fi

if ! command -v docker &>/dev/null; then
  echo "ERROR: Docker is required. Add 'docker' to your recipes list before 'greenbone'."
  exit 1
fi

mkdir -p /opt/greenbone && cd /opt/greenbone
curl -fsSL https://greenbone.github.io/docs/latest/_static/docker-compose-community.yml -o docker-compose.yml
docker compose -f docker-compose.yml -p greenbone up -d

echo "Greenbone/OpenVAS installed and running"
echo "NOTE: Web UI at https://<vm-ip>:9392 — default creds: admin/admin"
echo "NOTE: Feed sync may take 10-30 minutes before scanning is possible."
`,
      },
      rhel: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

if docker ps --filter name=greenbone --format '{{.Names}}' 2>/dev/null | grep -q greenbone; then
  echo "Greenbone already running"
  exit 0
fi

if ! command -v docker &>/dev/null; then
  echo "ERROR: Docker is required. Add 'docker' to your recipes list before 'greenbone'."
  exit 1
fi

mkdir -p /opt/greenbone && cd /opt/greenbone
curl -fsSL https://greenbone.github.io/docs/latest/_static/docker-compose-community.yml -o docker-compose.yml
docker compose -f docker-compose.yml -p greenbone up -d

echo "Greenbone/OpenVAS installed and running"
echo "NOTE: Web UI at https://<vm-ip>:9392 — default creds: admin/admin"
echo "NOTE: Feed sync may take 10-30 minutes before scanning is possible."
`,
      },
    },
  },

  // ── CrowdSec ───────────────────────────────────────────────────────────────

  crowdsec: {
    name: "crowdsec",
    description: "Install CrowdSec collaborative intrusion detection system",
    timeoutSeconds: 180,
    platforms: {
      debian: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if command -v cscli &>/dev/null; then
  echo "CrowdSec already installed: $(cscli version 2>&1 | head -1)"
  exit 0
fi

curl -s https://install.crowdsec.net | bash
apt-get update -qq
apt-get install -y -qq crowdsec
systemctl enable --now crowdsec

echo "CrowdSec installed: $(cscli version 2>&1 | head -1)"
echo "NOTE: Use 'cscli collections install' to add detection scenarios."
`,
      },
      rhel: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

if command -v cscli &>/dev/null; then
  echo "CrowdSec already installed: $(cscli version 2>&1 | head -1)"
  exit 0
fi

curl -s https://install.crowdsec.net | bash
dnf -y install crowdsec
systemctl enable --now crowdsec

echo "CrowdSec installed: $(cscli version 2>&1 | head -1)"
echo "NOTE: Use 'cscli collections install' to add detection scenarios."
`,
      },
      windows: {
        shell: "powershell",
        script: `
if (Get-Command cscli -ErrorAction SilentlyContinue) {
  Write-Output "CrowdSec already installed"
  exit 0
}

if (Get-Command winget -ErrorAction SilentlyContinue) {
  winget install -e --id CrowdSecurity.CrowdSec --accept-source-agreements --accept-package-agreements
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
  Write-Output "CrowdSec installed via winget"
} else {
  Write-Output "ERROR: winget not available."
  exit 1
}
`,
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Infrastructure
  // ═══════════════════════════════════════════════════════════════════════════

  // ── k3s ────────────────────────────────────────────────────────────────────

  k3s: {
    name: "k3s",
    description: "Install k3s lightweight Kubernetes (single-node cluster, Linux only)",
    timeoutSeconds: 300,
    platforms: {
      debian: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

if command -v k3s &>/dev/null; then
  echo "k3s already installed: $(k3s --version)"
  exit 0
fi

curl -sfL https://get.k3s.io | sh -

echo "k3s installed: $(k3s --version)"
echo "NOTE: kubeconfig at /etc/rancher/k3s/k3s.yaml"
echo "NOTE: Use 'kubectl get nodes' to verify the cluster is ready."
`,
      },
      rhel: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

if command -v k3s &>/dev/null; then
  echo "k3s already installed: $(k3s --version)"
  exit 0
fi

curl -sfL https://get.k3s.io | sh -

echo "k3s installed: $(k3s --version)"
echo "NOTE: kubeconfig at /etc/rancher/k3s/k3s.yaml"
echo "NOTE: Use 'kubectl get nodes' to verify the cluster is ready."
`,
      },
    },
  },

  // ── Caddy ──────────────────────────────────────────────────────────────────

  caddy: {
    name: "caddy",
    description: "Install Caddy reverse proxy with automatic HTTPS",
    timeoutSeconds: 120,
    platforms: {
      debian: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if command -v caddy &>/dev/null; then
  echo "Caddy already installed: $(caddy version)"
  exit 0
fi

apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update -qq
apt-get install -y -qq caddy
systemctl enable --now caddy

echo "Caddy installed: $(caddy version)"
echo "NOTE: Default config at /etc/caddy/Caddyfile, web root at /usr/share/caddy"
`,
      },
      rhel: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

if command -v caddy &>/dev/null; then
  echo "Caddy already installed: $(caddy version)"
  exit 0
fi

dnf -y install dnf-plugins-core
dnf -y copr enable @caddy/caddy
dnf -y install caddy
systemctl enable --now caddy

echo "Caddy installed: $(caddy version)"
echo "NOTE: Default config at /etc/caddy/Caddyfile"
`,
      },
      windows: {
        shell: "powershell",
        script: `
if (Get-Command caddy -ErrorAction SilentlyContinue) {
  Write-Output "Caddy already installed: $(caddy version)"
  exit 0
}

if (Get-Command winget -ErrorAction SilentlyContinue) {
  winget install -e --id CaddyServer.Caddy --accept-source-agreements --accept-package-agreements
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
  Write-Output "Caddy installed via winget"
} else {
  Write-Output "ERROR: winget not available."
  exit 1
}
`,
      },
    },
  },

  // ── Nginx ──────────────────────────────────────────────────────────────────

  nginx: {
    name: "nginx",
    description: "Install Nginx web server and reverse proxy",
    timeoutSeconds: 120,
    platforms: {
      debian: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if command -v nginx &>/dev/null; then
  echo "Nginx already installed: $(nginx -v 2>&1)"
  exit 0
fi

apt-get update -qq
apt-get install -y -qq nginx
systemctl enable --now nginx

echo "Nginx installed: $(nginx -v 2>&1)"
echo "NOTE: Default config at /etc/nginx/nginx.conf, web root at /var/www/html"
`,
      },
      rhel: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

if command -v nginx &>/dev/null; then
  echo "Nginx already installed: $(nginx -v 2>&1)"
  exit 0
fi

dnf -y install nginx
systemctl enable --now nginx

echo "Nginx installed: $(nginx -v 2>&1)"
echo "NOTE: Default config at /etc/nginx/nginx.conf"
`,
      },
    },
  },

  // ── PostgreSQL ─────────────────────────────────────────────────────────────

  postgresql: {
    name: "postgresql",
    description: "Install PostgreSQL database server",
    timeoutSeconds: 180,
    platforms: {
      debian: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if command -v psql &>/dev/null && systemctl is-active --quiet postgresql 2>/dev/null; then
  echo "PostgreSQL already installed and running: $(psql --version)"
  exit 0
fi

apt-get update -qq
apt-get install -y -qq postgresql postgresql-contrib
systemctl enable --now postgresql

echo "PostgreSQL installed: $(psql --version)"
echo "NOTE: Default user is 'postgres'. Connect with: sudo -u postgres psql"
`,
      },
      rhel: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

if command -v psql &>/dev/null && systemctl is-active --quiet postgresql 2>/dev/null; then
  echo "PostgreSQL already installed and running: $(psql --version)"
  exit 0
fi

dnf -y install postgresql-server postgresql-contrib
postgresql-setup --initdb 2>/dev/null || true
systemctl enable --now postgresql

echo "PostgreSQL installed: $(psql --version)"
echo "NOTE: Default user is 'postgres'. Connect with: sudo -u postgres psql"
`,
      },
      windows: {
        shell: "powershell",
        script: `
if (Get-Command psql -ErrorAction SilentlyContinue) {
  Write-Output "PostgreSQL already installed: $(psql --version)"
  exit 0
}

if (Get-Command winget -ErrorAction SilentlyContinue) {
  winget install -e --id PostgreSQL.PostgreSQL.16 --accept-source-agreements --accept-package-agreements
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
  Write-Output "PostgreSQL installed via winget"
} else {
  Write-Output "ERROR: winget not available."
  exit 1
}
`,
      },
    },
  },

  // ── Redis ──────────────────────────────────────────────────────────────────

  redis: {
    name: "redis",
    description: "Install Redis in-memory data store",
    timeoutSeconds: 120,
    platforms: {
      debian: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if command -v redis-server &>/dev/null && systemctl is-active --quiet redis-server 2>/dev/null; then
  echo "Redis already installed and running: $(redis-server --version)"
  exit 0
fi

apt-get update -qq
apt-get install -y -qq redis-server
systemctl enable --now redis-server

echo "Redis installed: $(redis-server --version)"
echo "NOTE: Listening on localhost:6379. Config at /etc/redis/redis.conf"
`,
      },
      rhel: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

if command -v redis-server &>/dev/null && systemctl is-active --quiet redis 2>/dev/null; then
  echo "Redis already installed and running: $(redis-server --version)"
  exit 0
fi

dnf -y install redis
systemctl enable --now redis

echo "Redis installed: $(redis-server --version)"
echo "NOTE: Listening on localhost:6379. Config at /etc/redis/redis.conf"
`,
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Networking
  // ═══════════════════════════════════════════════════════════════════════════

  // ── WireGuard ──────────────────────────────────────────────────────────────

  wireguard: {
    name: "wireguard",
    description: "Install WireGuard VPN (self-hosted alternative to Tailscale)",
    timeoutSeconds: 120,
    platforms: {
      debian: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if command -v wg &>/dev/null; then
  echo "WireGuard already installed"
  exit 0
fi

apt-get update -qq
apt-get install -y -qq wireguard wireguard-tools

echo "WireGuard installed"
echo "NOTE: Generate keys with 'wg genkey' and configure /etc/wireguard/wg0.conf"
`,
      },
      rhel: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

if command -v wg &>/dev/null; then
  echo "WireGuard already installed"
  exit 0
fi

dnf -y install wireguard-tools

echo "WireGuard installed"
echo "NOTE: Generate keys with 'wg genkey' and configure /etc/wireguard/wg0.conf"
`,
      },
      windows: {
        shell: "powershell",
        script: `
if (Get-Command wg -ErrorAction SilentlyContinue) {
  Write-Output "WireGuard already installed"
  exit 0
}

if (Get-Command winget -ErrorAction SilentlyContinue) {
  winget install -e --id WireGuard.WireGuard --accept-source-agreements --accept-package-agreements
  Write-Output "WireGuard installed via winget"
} else {
  Write-Output "ERROR: winget not available."
  exit 1
}
`,
      },
    },
  },

  // ── Cloudflare Tunnel ──────────────────────────────────────────────────────

  cloudflared: {
    name: "cloudflared",
    description: "Install Cloudflare Tunnel client for exposing services without open ports",
    timeoutSeconds: 120,
    platforms: {
      debian: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if command -v cloudflared &>/dev/null; then
  echo "cloudflared already installed: $(cloudflared --version)"
  exit 0
fi

curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | gpg --dearmor -o /usr/share/keyrings/cloudflare-main.gpg
. /etc/os-release
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $VERSION_CODENAME main" > /etc/apt/sources.list.d/cloudflared.list
apt-get update -qq
apt-get install -y -qq cloudflared

echo "cloudflared installed: $(cloudflared --version)"
echo "NOTE: Run 'cloudflared tunnel login' to authenticate."
`,
      },
      rhel: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

if command -v cloudflared &>/dev/null; then
  echo "cloudflared already installed: $(cloudflared --version)"
  exit 0
fi

rpm -i https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-x86_64.rpm 2>/dev/null || \
  dnf -y upgrade https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-x86_64.rpm

echo "cloudflared installed: $(cloudflared --version)"
echo "NOTE: Run 'cloudflared tunnel login' to authenticate."
`,
      },
      windows: {
        shell: "powershell",
        script: `
if (Get-Command cloudflared -ErrorAction SilentlyContinue) {
  Write-Output "cloudflared already installed: $(cloudflared --version)"
  exit 0
}

if (Get-Command winget -ErrorAction SilentlyContinue) {
  winget install -e --id Cloudflare.cloudflared --accept-source-agreements --accept-package-agreements
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
  Write-Output "cloudflared installed via winget"
  Write-Output "NOTE: Run 'cloudflared tunnel login' to authenticate."
} else {
  Write-Output "ERROR: winget not available."
  exit 1
}
`,
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Observability
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Grafana ────────────────────────────────────────────────────────────────

  grafana: {
    name: "grafana",
    description: "Install Grafana dashboards for monitoring and observability (default port :3000)",
    timeoutSeconds: 180,
    platforms: {
      debian: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if systemctl is-active --quiet grafana-server 2>/dev/null; then
  echo "Grafana already running"
  exit 0
fi

apt-get install -y -qq apt-transport-https software-properties-common curl
curl -fsSL https://apt.grafana.com/gpg.key | gpg --dearmor -o /usr/share/keyrings/grafana.gpg
echo "deb [signed-by=/usr/share/keyrings/grafana.gpg] https://apt.grafana.com stable main" > /etc/apt/sources.list.d/grafana.list
apt-get update -qq
apt-get install -y -qq grafana
systemctl enable --now grafana-server

echo "Grafana installed and running on :3000"
echo "NOTE: Default creds: admin/admin (change on first login)"
`,
      },
      rhel: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

if systemctl is-active --quiet grafana-server 2>/dev/null; then
  echo "Grafana already running"
  exit 0
fi

cat > /etc/yum.repos.d/grafana.repo << 'REPO'
[grafana]
name=grafana
baseurl=https://rpm.grafana.com
repo_gpgcheck=1
enabled=1
gpgcheck=1
gpgkey=https://rpm.grafana.com/gpg.key
sslverify=1
sslcacert=/etc/pki/tls/certs/ca-bundle.crt
REPO
dnf -y install grafana
systemctl enable --now grafana-server

echo "Grafana installed and running on :3000"
echo "NOTE: Default creds: admin/admin (change on first login)"
`,
      },
      windows: {
        shell: "powershell",
        script: `
if (Get-Service grafana -ErrorAction SilentlyContinue) {
  Write-Output "Grafana already installed"
  exit 0
}

if (Get-Command winget -ErrorAction SilentlyContinue) {
  winget install -e --id GrafanaLabs.Grafana --accept-source-agreements --accept-package-agreements
  Write-Output "Grafana installed via winget"
  Write-Output "NOTE: Default port :3000, creds: admin/admin"
} else {
  Write-Output "ERROR: winget not available."
  exit 1
}
`,
      },
    },
  },

  // ── Prometheus ─────────────────────────────────────────────────────────────

  prometheus: {
    name: "prometheus",
    description: "Install Prometheus monitoring server (default port :9090)",
    timeoutSeconds: 180,
    platforms: {
      debian: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

if systemctl is-active --quiet prometheus 2>/dev/null; then
  echo "Prometheus already running"
  exit 0
fi

useradd --no-create-home --shell /bin/false prometheus 2>/dev/null || true
mkdir -p /etc/prometheus /var/lib/prometheus

VERSION="2.51.0"
curl -fsSL "https://github.com/prometheus/prometheus/releases/download/v\${VERSION}/prometheus-\${VERSION}.linux-amd64.tar.gz" | tar -xzf - -C /tmp
cp /tmp/prometheus-\${VERSION}.linux-amd64/prometheus /usr/local/bin/
cp /tmp/prometheus-\${VERSION}.linux-amd64/promtool /usr/local/bin/
cp -r /tmp/prometheus-\${VERSION}.linux-amd64/consoles /etc/prometheus/
cp -r /tmp/prometheus-\${VERSION}.linux-amd64/console_libraries /etc/prometheus/

if [ ! -f /etc/prometheus/prometheus.yml ]; then
  cat > /etc/prometheus/prometheus.yml << 'CFG'
global:
  scrape_interval: 15s
scrape_configs:
  - job_name: "prometheus"
    static_configs:
      - targets: ["localhost:9090"]
  - job_name: "node"
    static_configs:
      - targets: ["localhost:9100"]
CFG
fi

chown -R prometheus:prometheus /etc/prometheus /var/lib/prometheus

cat > /etc/systemd/system/prometheus.service << 'SERVICE'
[Unit]
Description=Prometheus
After=network.target

[Service]
User=prometheus
ExecStart=/usr/local/bin/prometheus --config.file=/etc/prometheus/prometheus.yml --storage.tsdb.path=/var/lib/prometheus
Restart=always

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable --now prometheus

echo "Prometheus installed and running on :9090"
echo "NOTE: Config at /etc/prometheus/prometheus.yml"
`,
      },
      rhel: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

if systemctl is-active --quiet prometheus 2>/dev/null; then
  echo "Prometheus already running"
  exit 0
fi

useradd --no-create-home --shell /bin/false prometheus 2>/dev/null || true
mkdir -p /etc/prometheus /var/lib/prometheus

VERSION="2.51.0"
curl -fsSL "https://github.com/prometheus/prometheus/releases/download/v\${VERSION}/prometheus-\${VERSION}.linux-amd64.tar.gz" | tar -xzf - -C /tmp
cp /tmp/prometheus-\${VERSION}.linux-amd64/prometheus /usr/local/bin/
cp /tmp/prometheus-\${VERSION}.linux-amd64/promtool /usr/local/bin/
cp -r /tmp/prometheus-\${VERSION}.linux-amd64/consoles /etc/prometheus/
cp -r /tmp/prometheus-\${VERSION}.linux-amd64/console_libraries /etc/prometheus/

if [ ! -f /etc/prometheus/prometheus.yml ]; then
  cat > /etc/prometheus/prometheus.yml << 'CFG'
global:
  scrape_interval: 15s
scrape_configs:
  - job_name: "prometheus"
    static_configs:
      - targets: ["localhost:9090"]
  - job_name: "node"
    static_configs:
      - targets: ["localhost:9100"]
CFG
fi

chown -R prometheus:prometheus /etc/prometheus /var/lib/prometheus

cat > /etc/systemd/system/prometheus.service << 'SERVICE'
[Unit]
Description=Prometheus
After=network.target

[Service]
User=prometheus
ExecStart=/usr/local/bin/prometheus --config.file=/etc/prometheus/prometheus.yml --storage.tsdb.path=/var/lib/prometheus
Restart=always

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable --now prometheus

echo "Prometheus installed and running on :9090"
echo "NOTE: Config at /etc/prometheus/prometheus.yml"
`,
      },
    },
  },

  // ── Loki ───────────────────────────────────────────────────────────────────

  loki: {
    name: "loki",
    description: "Install Grafana Loki log aggregation system (default port :3100)",
    timeoutSeconds: 180,
    platforms: {
      debian: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if systemctl is-active --quiet loki 2>/dev/null; then
  echo "Loki already running"
  exit 0
fi

apt-get update -qq
apt-get install -y -qq unzip

useradd --no-create-home --shell /bin/false loki 2>/dev/null || true
mkdir -p /etc/loki /var/lib/loki

VERSION="2.9.6"
curl -fsSL "https://github.com/grafana/loki/releases/download/v\${VERSION}/loki-linux-amd64.zip" -o /tmp/loki.zip
cd /tmp && unzip -o loki.zip && mv loki-linux-amd64 /usr/local/bin/loki && chmod +x /usr/local/bin/loki

if [ ! -f /etc/loki/loki.yml ]; then
  curl -fsSL "https://raw.githubusercontent.com/grafana/loki/v\${VERSION}/cmd/loki/loki-local-config.yaml" -o /etc/loki/loki.yml
fi

chown -R loki:loki /etc/loki /var/lib/loki

cat > /etc/systemd/system/loki.service << 'SERVICE'
[Unit]
Description=Loki
After=network.target

[Service]
User=loki
ExecStart=/usr/local/bin/loki -config.file=/etc/loki/loki.yml
Restart=always

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable --now loki

echo "Loki installed and running on :3100"
echo "NOTE: Config at /etc/loki/loki.yml"
`,
      },
      rhel: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

if systemctl is-active --quiet loki 2>/dev/null; then
  echo "Loki already running"
  exit 0
fi

dnf -y install unzip

useradd --no-create-home --shell /bin/false loki 2>/dev/null || true
mkdir -p /etc/loki /var/lib/loki

VERSION="2.9.6"
curl -fsSL "https://github.com/grafana/loki/releases/download/v\${VERSION}/loki-linux-amd64.zip" -o /tmp/loki.zip
cd /tmp && unzip -o loki.zip && mv loki-linux-amd64 /usr/local/bin/loki && chmod +x /usr/local/bin/loki

if [ ! -f /etc/loki/loki.yml ]; then
  curl -fsSL "https://raw.githubusercontent.com/grafana/loki/v\${VERSION}/cmd/loki/loki-local-config.yaml" -o /etc/loki/loki.yml
fi

chown -R loki:loki /etc/loki /var/lib/loki

cat > /etc/systemd/system/loki.service << 'SERVICE'
[Unit]
Description=Loki
After=network.target

[Service]
User=loki
ExecStart=/usr/local/bin/loki -config.file=/etc/loki/loki.yml
Restart=always

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable --now loki

echo "Loki installed and running on :3100"
echo "NOTE: Config at /etc/loki/loki.yml"
`,
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Dev Runtimes
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Java (OpenJDK) ─────────────────────────────────────────────────────────

  java: {
    name: "java",
    description: "Install OpenJDK 21 (Java Development Kit)",
    timeoutSeconds: 180,
    platforms: {
      debian: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if command -v java &>/dev/null; then
  echo "Java already installed: $(java --version 2>&1 | head -1)"
  exit 0
fi

apt-get update -qq
apt-get install -y -qq openjdk-21-jdk

echo "Java installed: $(java --version 2>&1 | head -1)"
`,
      },
      rhel: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

if command -v java &>/dev/null; then
  echo "Java already installed: $(java --version 2>&1 | head -1)"
  exit 0
fi

dnf -y install java-21-openjdk-devel

echo "Java installed: $(java --version 2>&1 | head -1)"
`,
      },
      windows: {
        shell: "powershell",
        script: `
if (Get-Command java -ErrorAction SilentlyContinue) {
  Write-Output "Java already installed: $(java --version 2>&1 | Select-Object -First 1)"
  exit 0
}

if (Get-Command winget -ErrorAction SilentlyContinue) {
  winget install -e --id EclipseAdoptium.Temurin.21.JDK --accept-source-agreements --accept-package-agreements
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
  Write-Output "Java (Temurin 21) installed via winget"
} else {
  Write-Output "ERROR: winget not available."
  exit 1
}
`,
      },
    },
  },

  // ── .NET SDK ───────────────────────────────────────────────────────────────

  dotnet: {
    name: "dotnet",
    description: "Install .NET SDK 8.0",
    timeoutSeconds: 300,
    platforms: {
      debian: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if command -v dotnet &>/dev/null; then
  echo ".NET already installed: $(dotnet --version)"
  exit 0
fi

apt-get update -qq
apt-get install -y -qq wget apt-transport-https

. /etc/os-release
wget -q "https://packages.microsoft.com/config/ubuntu/\${VERSION_ID}/packages-microsoft-prod.deb" -O /tmp/packages-microsoft-prod.deb
dpkg -i /tmp/packages-microsoft-prod.deb
rm -f /tmp/packages-microsoft-prod.deb

apt-get update -qq
apt-get install -y -qq dotnet-sdk-8.0

echo ".NET installed: $(dotnet --version)"
`,
      },
      rhel: {
        shell: "bash",
        script: `#!/bin/bash
set -euo pipefail

if command -v dotnet &>/dev/null; then
  echo ".NET already installed: $(dotnet --version)"
  exit 0
fi

dnf -y install dotnet-sdk-8.0

echo ".NET installed: $(dotnet --version)"
`,
      },
      windows: {
        shell: "powershell",
        script: `
if (Get-Command dotnet -ErrorAction SilentlyContinue) {
  Write-Output ".NET already installed: $(dotnet --version)"
  exit 0
}

if (Get-Command winget -ErrorAction SilentlyContinue) {
  winget install -e --id Microsoft.DotNet.SDK.8 --accept-source-agreements --accept-package-agreements
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
  Write-Output ".NET SDK 8.0 installed via winget"
} else {
  Write-Output "ERROR: winget not available."
  exit 1
}
`,
      },
    },
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
