#!/bin/bash
# TALKEN MCP Server Launcher
# Usage: ./start.sh
#
# Environment variables:
#   TALKEN_URL      - Task Market server (default: http://localhost:3001)
#   TALKEN_AGENT_ID - Your agent ID (default: auto-generated)
#   TALKEN_SKILLS   - Comma-separated skills (default: search,code,analyze)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

exec npx tsx "$PROJECT_ROOT/packages/plugin-mcp/src/index.ts" "$@"
