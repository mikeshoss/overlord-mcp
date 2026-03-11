export interface ProxmoxApiResponse<T> {
  data: T;
}

export interface ClusterResource {
  vmid: number;
  name: string;
  node: string;
  status: string;
  type: string;
  cpu: number;
  mem: number;
  maxmem: number;
  disk: number;
  maxdisk: number;
  template: number;
  uptime?: number;
  netin?: number;
  netout?: number;
}

export interface ClusterStatusEntry {
  type: string;
  name: string;
  id: string;
  online?: number;
  quorate?: number;
  nodeid?: number;
  ip?: string;
  local?: number;
  level?: string;
}

export interface NodeStatus {
  cpu: number;
  memory: {
    used: number;
    total: number;
    free: number;
  };
  rootfs: {
    used: number;
    total: number;
    free: number;
    avail: number;
  };
  uptime: number;
  loadavg: [string, string, string];
  cpuinfo: {
    cpus: number;
    model: string;
    sockets: number;
    cores: number;
  };
  pveversion: string;
}

export interface VmConfig {
  name?: string;
  description?: string;
  memory?: number;
  cores?: number;
  sockets?: number;
  cpu?: string;
  ostype?: string;
  boot?: string;
  onboot?: number;
  agent?: string;
  net0?: string;
  scsi0?: string;
  ide2?: string;
  scsihw?: string;
  digest?: string;
  [key: string]: unknown;
}

export interface TaskStatus {
  upid: string;
  node: string;
  pid: number;
  starttime: number;
  status: string;
  exitstatus?: string;
  type: string;
  user?: string;
  id?: string;
}

export interface Snapshot {
  name: string;
  description?: string;
  snaptime?: number;
  parent?: string;
  vmstate?: number;
}

export interface GuestExecResponse {
  pid: number;
}

export interface GuestExecStatus {
  exited: number;
  exitcode?: number;
  "out-data"?: string;
  "err-data"?: string;
}

export interface GuestExecResult {
  pid: number;
  exited: boolean;
  exitcode: number;
  stdout: string;
  stderr: string;
}

export interface TicketResponse {
  ticket: string;
  CSRFPreventionToken: string;
}

export interface ProxmoxVersion {
  version: string;
  release: string;
  repoid: string;
}

export interface NextIdResponse {
  data: string;
}
