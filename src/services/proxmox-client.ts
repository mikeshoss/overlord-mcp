import { ENV } from "../constants.js";
import type { ProxmoxApiResponse, TicketResponse } from "../types.js";

// Proxmox uses self-signed certificates by default.
// This disables TLS verification globally for all fetch calls.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

export class ProxmoxClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly endpoint: string,
  ) {
    super(message);
    this.name = "ProxmoxClientError";
  }
}

export class ProxmoxClient {
  private readonly baseUrl: string;
  private readonly tokenId?: string;
  private readonly tokenSecret?: string;
  private readonly user?: string;
  private readonly password?: string;

  private ticket?: string;
  private csrfToken?: string;
  private ticketExpiry: number = 0;

  constructor() {
    const host = process.env[ENV.PROXMOX_HOST];
    if (!host) {
      throw new Error(`${ENV.PROXMOX_HOST} environment variable is required`);
    }
    this.baseUrl = host.replace(/\/+$/, "");

    this.tokenId = process.env[ENV.PROXMOX_TOKEN_ID];
    this.tokenSecret = process.env[ENV.PROXMOX_TOKEN_SECRET];
    this.user = process.env[ENV.PROXMOX_USER];
    this.password = process.env[ENV.PROXMOX_PASSWORD];

    if (!this.tokenId && !this.user) {
      throw new Error(
        `Either ${ENV.PROXMOX_TOKEN_ID}/${ENV.PROXMOX_TOKEN_SECRET} (API token) or ${ENV.PROXMOX_USER}/${ENV.PROXMOX_PASSWORD} (ticket auth) must be set`,
      );
    }
  }

  private useTokenAuth(): boolean {
    return !!(this.tokenId && this.tokenSecret);
  }

  private async ensureTicket(): Promise<void> {
    if (this.useTokenAuth()) return;

    // Proxmox tickets are valid for 2 hours; refresh at 1h50m
    if (this.ticket && Date.now() < this.ticketExpiry) return;

    const url = `${this.baseUrl}/api2/json/access/ticket`;
    const body = new URLSearchParams({
      username: this.user!,
      password: this.password!,
    });

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new ProxmoxClientError(
        `Authentication failed: ${text}`,
        res.status,
        "access/ticket",
      );
    }

    const json = (await res.json()) as ProxmoxApiResponse<TicketResponse>;
    this.ticket = json.data.ticket;
    this.csrfToken = json.data.CSRFPreventionToken;
    // Refresh 10 minutes before the 2-hour expiry
    this.ticketExpiry = Date.now() + 110 * 60 * 1000;
  }

  private async getHeaders(method: string): Promise<Record<string, string>> {
    const headers: Record<string, string> = {};

    if (this.useTokenAuth()) {
      headers["Authorization"] = `PVEAPIToken=${this.tokenId}=${this.tokenSecret}`;
    } else {
      await this.ensureTicket();
      headers["Cookie"] = `PVEAuthCookie=${this.ticket}`;
      if (method !== "GET" && this.csrfToken) {
        headers["CSRFPreventionToken"] = this.csrfToken;
      }
    }

    return headers;
  }

  private buildUrl(path: string, params?: Record<string, string>): string {
    const cleanPath = path.replace(/^\/+/, "");
    const url = new URL(`/api2/json/${cleanPath}`, this.baseUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  private async request<T>(
    method: string,
    path: string,
    options?: {
      params?: Record<string, string>;
      data?: Record<string, unknown>;
    },
  ): Promise<T> {
    const url = this.buildUrl(path, options?.params);
    const headers = await this.getHeaders(method);

    const fetchOptions: RequestInit = { method, headers };

    if (options?.data && (method === "POST" || method === "PUT")) {
      headers["Content-Type"] = "application/json";
      fetchOptions.body = JSON.stringify(options.data);
    }

    const res = await fetch(url, fetchOptions);

    if (!res.ok) {
      let errorMessage: string;
      try {
        const errorBody = await res.json() as { errors?: Record<string, string> };
        if (errorBody.errors) {
          errorMessage = Object.entries(errorBody.errors)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ");
        } else {
          errorMessage = JSON.stringify(errorBody);
        }
      } catch {
        errorMessage = await res.text();
      }
      throw new ProxmoxClientError(
        `Proxmox API error (${method} ${path}): ${errorMessage}`,
        res.status,
        path,
      );
    }

    const json = (await res.json()) as ProxmoxApiResponse<T>;
    return json.data;
  }

  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    return this.request<T>("GET", path, { params });
  }

  async post<T>(path: string, data?: Record<string, unknown>): Promise<T> {
    return this.request<T>("POST", path, { data });
  }

  async put<T>(path: string, data?: Record<string, unknown>): Promise<T> {
    return this.request<T>("PUT", path, { data });
  }

  async delete<T>(path: string, params?: Record<string, string>): Promise<T> {
    return this.request<T>("DELETE", path, { params });
  }

  async getVersion(): Promise<{ version: string; release: string }> {
    return this.get<{ version: string; release: string }>("version");
  }

  async getNextId(): Promise<number> {
    const id = await this.get<string>("cluster/nextid");
    return parseInt(id, 10);
  }
}
