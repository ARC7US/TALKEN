#!/usr/bin/env node

/**
 * TALKEN MCP Server
 *
 * A Model Context Protocol (MCP) server that exposes TALKEN Agent Network
 * capabilities as tools for any MCP-compatible agent.
 *
 * Usage:
 *   npx @talken/plugin-mcp
 *
 * Environment variables:
 *   TALKEN_URL        - Task Market server URL (default: http://localhost:3001)
 *   TALKEN_AGENT_ID   - Agent ID (default: auto-generated)
 *   TALKEN_SKILLS     - Comma-separated skills (default: search,code,analyze)
 */

import { TALKEN_TOOLS } from "./tools.js";
import { initClient, handleToolCall, getClient } from "./handler.js";

// ── MCP Protocol Types ───────────────────────────────────────────────────

interface McpRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface McpResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface McpNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

// ── MCP Server ───────────────────────────────────────────────────────────

const SERVER_INFO = {
  name: "talken-mcp",
  version: "0.1.0",
};

const CAPABILITIES = {
  tools: {},
};

function sendResponse(response: McpResponse): void {
  const data = JSON.stringify(response);
  const message = `Content-Length: ${Buffer.byteLength(data)}\r\n\r\n${data}`;
  process.stdout.write(message);
}

function sendNotification(notification: McpNotification): void {
  const data = JSON.stringify(notification);
  const message = `Content-Length: ${Buffer.byteLength(data)}\r\n\r\n${data}`;
  process.stdout.write(message);
}

function sendError(id: number | string, code: number, message: string): void {
  sendResponse({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handleRequest(request: McpRequest): Promise<void> {
  const { id, method, params } = request;

  // Notifications (no id) don't need responses
  if (id === undefined) {
    if (method === "notifications/initialized") {
      // Client confirmed initialization
    }
    return;
  }

  switch (method) {
    case "initialize": {
      sendResponse({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: CAPABILITIES,
          serverInfo: SERVER_INFO,
        },
      });
      break;
    }

    case "tools/list": {
      sendResponse({
        jsonrpc: "2.0",
        id,
        result: { tools: TALKEN_TOOLS },
      });
      break;
    }

    case "tools/call": {
      const toolName = params?.name as string;
      const toolArgs = (params?.arguments as Record<string, unknown>) ?? {};

      if (!TALKEN_TOOLS.find((t) => t.name === toolName)) {
        sendError(id, -32602, `Unknown tool: ${toolName}`);
        break;
      }

      const result = await handleToolCall(toolName, toolArgs);
      sendResponse({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: result.content }],
        },
      });
      break;
    }

    case "ping": {
      sendResponse({ jsonrpc: "2.0", id, result: {} });
      break;
    }

    default: {
      sendError(id, -32601, `Method not found: ${method}`);
      break;
    }
  }
}

// ── stdio Transport ──────────────────────────────────────────────────────

let inputBuffer = "";

function processBuffer(): void {
  // Look for Content-Length header
  const headerEnd = inputBuffer.indexOf("\r\n\r\n");
  if (headerEnd === -1) return;

  const header = inputBuffer.substring(0, headerEnd);
  const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
  if (!lengthMatch) {
    // Skip malformed header
    inputBuffer = inputBuffer.substring(headerEnd + 4);
    processBuffer();
    return;
  }

  const contentLength = parseInt(lengthMatch[1], 10);
  const bodyStart = headerEnd + 4;

  if (inputBuffer.length < bodyStart + contentLength) return; // Wait for more data

  const body = inputBuffer.substring(bodyStart, bodyStart + contentLength);
  inputBuffer = inputBuffer.substring(bodyStart + contentLength);

  try {
    const request = JSON.parse(body) as McpRequest;
    handleRequest(request).catch((err) => {
      if (request.id !== undefined) {
        sendError(request.id, -32603, `Internal error: ${err.message}`);
      }
    });
  } catch {
    // Invalid JSON
  }

  // Process more messages in buffer
  if (inputBuffer.length > 0) processBuffer();
}

function startServer(): void {
  // Initialize TALKEN client
  const baseUrl = process.env.TALKEN_URL ?? "http://localhost:3001";
  const agentId = process.env.TALKEN_AGENT_ID ?? `mcp-agent-${Date.now().toString(36)}`;
  const skills = (process.env.TALKEN_SKILLS ?? "search,code,analyze").split(",").map((s) => s.trim());

  initClient({ baseUrl, agentId, skills });

  // Register with TALKEN (fire and forget)
  const c = getClient();
  if (c) {
    c.register({ name: agentId, skills }).catch(() => {
      // Registration may fail if server is not running
    });
  }

  // Read from stdin
  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (chunk: string) => {
    inputBuffer += chunk;
    processBuffer();
  });

  process.stdin.on("end", () => {
    process.exit(0);
  });

  // Handle SIGINT
  process.on("SIGINT", () => {
    process.exit(0);
  });
}

startServer();
