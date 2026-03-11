import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { randomUUID } from "node:crypto";

import { ENV } from "./constants.js";
import { ProxmoxClient } from "./services/proxmox-client.js";
import { registerClusterTools } from "./tools/cluster.js";
import { registerVmLifecycleTools } from "./tools/vm-lifecycle.js";
import { registerVmConfigTools } from "./tools/vm-config.js";
import { registerSnapshotTools } from "./tools/snapshots.js";
import { registerTemplateTools } from "./tools/templates.js";
import { registerGuestExecTools } from "./tools/guest-exec.js";
import { registerProvisionTools } from "./tools/provision.js";

// Proxmox uses self-signed certificates by default — disable TLS verification
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

function createServer(): McpServer {
  const server = new McpServer({
    name: "overlord-mcp",
    version: "1.0.0",
  });

  const client = new ProxmoxClient();

  registerClusterTools(server, client);
  registerVmLifecycleTools(server, client);
  registerVmConfigTools(server, client);
  registerSnapshotTools(server, client);
  registerTemplateTools(server, client);
  registerGuestExecTools(server, client);
  registerProvisionTools(server, client);

  return server;
}

async function startStdio(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("overlord-mcp running on stdio");
}

async function startHttp(): Promise<void> {
  const port = parseInt(process.env[ENV.PORT] ?? "3002", 10);
  const app = express();
  app.use(express.json());

  // Track transports by session ID for stateful connections
  const transports = new Map<string, StreamableHTTPServerTransport>();

  // Health check — also verifies Proxmox connectivity
  app.get("/health", async (_req, res) => {
    try {
      const client = new ProxmoxClient();
      const version = await client.getVersion();
      res.json({
        status: "ok",
        server: "overlord-mcp",
        proxmox: version,
      });
    } catch (err) {
      res.status(503).json({
        status: "error",
        server: "overlord-mcp",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // MCP endpoint
  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // New session
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    const server = createServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    // Store by the auto-generated session ID
    const assignedId = transport.sessionId;
    if (assignedId) {
      transports.set(assignedId, transport);
      transport.onclose = () => {
        transports.delete(assignedId);
      };
    }
  });

  // Handle GET for SSE stream (session resumption)
  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res);
      return;
    }
    res.status(400).json({ error: "No valid session. Send a POST to /mcp first." });
  });

  // Handle DELETE for session termination
  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res);
      transports.delete(sessionId);
      return;
    }
    res.status(400).json({ error: "No valid session." });
  });

  app.listen(port, () => {
    console.error(`overlord-mcp HTTP server listening on port ${port}`);
    console.error(`Health check: http://localhost:${port}/health`);
    console.error(`MCP endpoint: http://localhost:${port}/mcp`);
  });
}

async function main(): Promise<void> {
  const transport = process.env[ENV.TRANSPORT]?.toLowerCase();

  if (transport === "http") {
    await startHttp();
  } else {
    await startStdio();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
