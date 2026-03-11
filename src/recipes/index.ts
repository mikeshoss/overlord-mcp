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
