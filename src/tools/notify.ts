import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebhookSendSchema, WebhookTestSchema } from "../schemas/tools.js";

export function registerNotifyTools(
  server: McpServer,
): void {
  // ── overlord_webhook_send ─────────────────────────────────────────────────
  server.registerTool(
    "overlord_webhook_send",
    {
      description:
        "Send a webhook notification to an external URL. Use this to notify external systems " +
        "(Slack, Discord, PagerDuty, custom endpoints) about infrastructure events.\n\n" +
        "Supports JSON payloads, custom headers, and common webhook formats.\n\n" +
        "Built-in format shortcuts:\n" +
        "  - raw: Send the payload as-is (default)\n" +
        "  - slack: Wrap message in Slack block format { text: message }\n" +
        "  - discord: Wrap in Discord format { content: message }\n\n" +
        "Args:\n" +
        "  - url (string, required): Webhook endpoint URL\n" +
        "  - payload (object, required): JSON payload to send\n" +
        "  - format (string, optional, default 'raw'): 'raw', 'slack', or 'discord'\n" +
        "  - headers (object, optional): Additional HTTP headers\n\n" +
        "Returns: HTTP response status.\n\n" +
        "Example: { url: 'https://hooks.slack.com/services/...', payload: { text: 'VM 201 provisioned' }, format: 'slack' }\n" +
        "Example: { url: 'https://discord.com/api/webhooks/...', payload: { content: 'Backup complete for VM 201' }, format: 'discord' }",
      inputSchema: WebhookSendSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ url, payload, format, headers: extraHeaders }) => {
      let body: Record<string, unknown>;

      switch (format ?? "raw") {
        case "slack":
          body = typeof payload === "object" && "text" in payload
            ? payload
            : { text: JSON.stringify(payload) };
          break;
        case "discord":
          body = typeof payload === "object" && "content" in payload
            ? payload
            : { content: JSON.stringify(payload) };
          break;
        default:
          body = payload;
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(extraHeaders ?? {}),
      };

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      const text = JSON.stringify(
        {
          sent: true,
          status: res.status,
          status_text: res.statusText,
          success: res.ok,
        },
        null, 2,
      );
      return { content: [{ type: "text" as const, text }], isError: !res.ok };
    },
  );

  // ── overlord_webhook_test ─────────────────────────────────────────────────
  server.registerTool(
    "overlord_webhook_test",
    {
      description:
        "Send a test notification to a webhook URL to verify it's working.\n\n" +
        "Args:\n" +
        "  - url (string, required): Webhook endpoint URL\n" +
        "  - format (string, optional, default 'raw'): 'raw', 'slack', or 'discord'\n\n" +
        "Returns: HTTP response status.\n\n" +
        "Example: { url: 'https://hooks.slack.com/services/...', format: 'slack' }",
      inputSchema: WebhookTestSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ url, format }) => {
      const testMessage = "Overlord MCP test notification — webhook is working.";
      let body: Record<string, unknown>;

      switch (format ?? "raw") {
        case "slack":
          body = { text: testMessage };
          break;
        case "discord":
          body = { content: testMessage };
          break;
        default:
          body = { message: testMessage, timestamp: new Date().toISOString(), source: "overlord-mcp" };
      }

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const text = JSON.stringify(
        { test: true, status: res.status, success: res.ok },
        null, 2,
      );
      return { content: [{ type: "text" as const, text }], isError: !res.ok };
    },
  );
}
