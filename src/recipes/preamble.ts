/**
 * Preambles prepended to every provisioning script.
 *
 * Provides shared helper functions (retry, checksum validation,
 * architecture detection, /tmp cleanup) so individual recipes
 * stay focused on installation logic.
 *
 * The preamble is composed into each script via composeScript()
 * at module-load time — the final string is self-contained.
 */

export const BASH_PREAMBLE = `#!/bin/bash
set -euo pipefail

# ── Architecture detection ──────────────────────────────────────────────────
detect_arch() {
  case "$(uname -m)" in
    x86_64)  echo "amd64" ;;
    aarch64) echo "arm64" ;;
    armv7l)  echo "armv7" ;;
    *)       echo "$(uname -m)" ;;
  esac
}
ARCH="$(detect_arch)"

# ── Retry wrapper for curl ──────────────────────────────────────────────────
# Usage: retry_curl <max_attempts> <curl_args...>
retry_curl() {
  local max_attempts="\$1"; shift
  local attempt=1
  while [ "\$attempt" -le "\$max_attempts" ]; do
    if curl "\$@"; then return 0; fi
    echo "curl failed (attempt \$attempt/\$max_attempts), retrying in \${attempt}s..." >&2
    sleep "\$attempt"
    attempt=\$((attempt + 1))
  done
  echo "curl failed after \$max_attempts attempts" >&2
  return 1
}

# ── Download file with SHA256 verification ──────────────────────────────────
# Usage: download_verified <url> <output_path> <expected_sha256>
download_verified() {
  local url="\$1" output="\$2" expected_sha="\$3"
  retry_curl 3 -fsSL -o "\$output" "\$url"
  local actual_sha
  actual_sha="\$(sha256sum "\$output" | awk '{print \$1}')"
  if [ "\$actual_sha" != "\$expected_sha" ]; then
    echo "CHECKSUM MISMATCH for \$output" >&2
    echo "  expected: \$expected_sha" >&2
    echo "  actual:   \$actual_sha" >&2
    rm -f "\$output"
    return 1
  fi
}

# ── /tmp cleanup on exit ────────────────────────────────────────────────────
_cleanup_files=()
register_cleanup() { _cleanup_files+=("\$@"); }
_do_cleanup() {
  for f in "\${_cleanup_files[@]:-}"; do rm -rf "\$f" 2>/dev/null; done
}
trap _do_cleanup EXIT

# ── Distro ID (for repo URL selection) ──────────────────────────────────────
detect_distro_id() {
  if [ -f /etc/os-release ]; then . /etc/os-release; echo "\$ID"; else echo "unknown"; fi
}
`;

export const POWERSHELL_PREAMBLE = `$ErrorActionPreference = "Stop"

# ── Architecture detection ──────────────────────────────────────────────────
function Get-Arch {
  $arch = (Get-CimInstance Win32_Processor).Architecture
  switch ($arch) {
    9  { "amd64" }
    12 { "arm64" }
    default { "amd64" }
  }
}
$ARCH = Get-Arch

# ── Download with retry ────────────────────────────────────────────────────
function Invoke-DownloadWithRetry {
  param(
    [Parameter(Mandatory)][string]$Uri,
    [Parameter(Mandatory)][string]$OutFile,
    [int]$MaxAttempts = 3
  )
  for ($i = 1; $i -le $MaxAttempts; $i++) {
    try {
      Invoke-WebRequest -Uri $Uri -OutFile $OutFile -UseBasicParsing
      return
    } catch {
      if ($i -eq $MaxAttempts) { throw }
      Write-Warning "Download failed (attempt $i/$MaxAttempts), retrying in $($i)s..."
      Start-Sleep -Seconds $i
    }
  }
}

# ── SHA256 checksum assertion ───────────────────────────────────────────────
function Assert-Checksum {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$ExpectedSHA256
  )
  $actual = (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $ExpectedSHA256.ToLower()) {
    Remove-Item $Path -Force -ErrorAction SilentlyContinue
    throw "CHECKSUM MISMATCH for $Path (expected: $ExpectedSHA256, actual: $actual)"
  }
}
`;
