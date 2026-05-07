@echo off
REM TALKEN MCP Server Launcher (Windows)
REM Usage: start.cmd
REM
REM Environment variables:
REM   TALKEN_URL      - Task Market server (default: http://localhost:3001)
REM   TALKEN_AGENT_ID - Your agent ID (default: auto-generated)
REM   TALKEN_SKILLS   - Comma-separated skills (default: search,code,analyze)

cd /d "%~dp0\..\.."
npx tsx packages\plugin-mcp\src\index.ts %*
