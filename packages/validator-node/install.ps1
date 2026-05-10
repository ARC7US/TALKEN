# ─────────────────────────────────────────────────────────────
# TALKEN Validator Node - Windows 安装脚本
# 用法: irm https://raw.githubusercontent.com/ARC7US/TALKEN/master/packages/validator-node/install.ps1 | iex
# ─────────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"
$REPO = "https://github.com/ARC7US/TALKEN.git"
$INSTALL_DIR = "$env:USERPROFILE\talken-validator"
$BRANCH = "master"

function Info($msg)  { Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Ok($msg)    { Write-Host "[OK] $msg" -ForegroundColor Green }
function Warn($msg)  { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Fail($msg)  { Write-Host "[FAIL] $msg" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  TALKEN Validator Node - Windows 安装程序"
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# ── 1. 检查依赖 ──────────────────────────────────────────────

Info "检查系统依赖..."

# Node.js
$nodeExe = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeExe) {
    Warn "未检测到 Node.js"
    $installNode = Read-Host "是否自动安装 Node.js 20？(Y/n)"
    if ($installNode -ne "n") {
        Info "正在下载 Node.js..."
        $nodeUrl = "https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi"
        $nodeMsi = "$env:TEMP\node-installer.msi"
        Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeMsi
        Start-Process msiexec.exe -Wait -ArgumentList "/i $nodeMsi /quiet"
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
        Remove-Item $nodeMsi
    } else {
        Fail "请手动安装 Node.js 18+: https://nodejs.org"
    }
}
$nodeVer = (node -v) -replace 'v','' -split '\.' | Select-Object -First 1
if ([int]$nodeVer -lt 18) {
    Fail "Node.js 版本过低 ($(node -v))，需要 18+"
}
Ok "Node.js $(node -v)"

# Git
$gitExe = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitExe) {
    Warn "未检测到 Git"
    $installGit = Read-Host "是否自动安装 Git？(Y/n)"
    if ($installGit -ne "n") {
        Info "正在下载 Git..."
        $gitUrl = "https://github.com/git-for-windows/git/releases/download/v2.47.0.windows.1/Git-2.47.0-64-bit.exe"
        $gitExe_path = "$env:TEMP\git-installer.exe"
        Invoke-WebRequest -Uri $gitUrl -OutFile $gitExe_path
        Start-Process $gitExe_path -Wait -ArgumentList "/VERYSILENT /NORESTART"
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
        Remove-Item $gitExe_path
    } else {
        Fail "请手动安装 Git: https://git-scm.com"
    }
}
Ok "Git $(git --version | ForEach-Object { $_ -split ' ' | Select-Object -Last 1 })"

# pnpm
$pnpmExe = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpmExe) {
    Info "正在安装 pnpm..."
    npm install -g pnpm 2>$null
    if ($LASTEXITCODE -ne 0) {
        corepack enable
        corepack prepare pnpm@latest --activate
    }
}
Ok "pnpm $(pnpm -v)"

# ── 2. 克隆仓库 ──────────────────────────────────────────────

Write-Host ""
Info "正在下载 TALKEN 代码..."

if (Test-Path $INSTALL_DIR) {
    Warn "目录已存在: $INSTALL_DIR"
    $confirm = Read-Host "是否删除并重新安装？(y/N)"
    if ($confirm -eq "y" -or $confirm -eq "Y") {
        Remove-Item -Recurse -Force $INSTALL_DIR
    } else {
        Info "跳过下载，使用已有目录"
    }
}

if (-not (Test-Path $INSTALL_DIR)) {
    git clone --branch $BRANCH --depth 1 $REPO $INSTALL_DIR
}
Ok "代码下载完成"

# ── 3. 安装依赖 ──────────────────────────────────────────────

Write-Host ""
Info "正在安装依赖..."
Set-Location $INSTALL_DIR
pnpm install 2>&1 | Select-Object -Last 3
Ok "依赖安装完成"

# ── 4. 初始化配置 ────────────────────────────────────────────

Write-Host ""
Info "初始化配置文件..."

$validatorDir = "$INSTALL_DIR\packages\validator-node"
Set-Location $validatorDir

$configFile = "$validatorDir\validator-config.yaml"
if (-not (Test-Path $configFile)) {
    @"
# TALKEN Validator Node 配置文件

node:
  name: "my-validator-001"
  data_dir: "./data"

network:
  server_url: ""
  listen_port: 1789
  nat_type: "full_cone"

staking:
  amount: 100
  auto_restake: true
  min_stake: 100

llm:
  default_provider: "openai"

  providers:
    openai:
      base_url: "https://api.openai.com/v1"
      api_key: ""
      model: "gpt-4o"
      max_tokens: 4096

    anthropic:
      base_url: "https://api.anthropic.com"
      api_key: ""
      model: "claude-sonnet-4-20250514"
      max_tokens: 4096

    deepseek:
      base_url: "https://api.deepseek.com/v1"
      api_key: ""
      model: "deepseek-chat"
      max_tokens: 4096

scoring:
  prompt_template: |
    你是一个任务验证专家。请评估以下任务的执行结果。

    ## 任务描述
    {task_description}

    ## 任务参数
    {task_params}

    ## 执行结果
    {executor_result}

    ## 评分标准
    1. 结果是否正确完成了任务要求
    2. 结果质量是否达标
    3. 是否有明显的错误或遗漏

    请以 JSON 格式返回评分：
    {
      "passed": true/false,
      "score": 0-100,
      "reason": "评分理由"
    }

  timeout: 60
  retries: 2
"@ | Out-File -FilePath $configFile -Encoding utf8
}
Ok "配置文件已生成"

# ── 5. 交互式配置 ────────────────────────────────────────────

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  配置向导"
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

$nodeName = Read-Host "节点名称 [my-validator-001]"
if (-not $nodeName) { $nodeName = "my-validator-001" }

Write-Host ""
Write-Host "你的节点需要一个公网可访问的地址。"
Write-Host "如果有公网 IP，输入 ws://你的IP:1789"
Write-Host "如果没有，按回车跳过"
$serverUrl = Read-Host "节点地址"

Write-Host ""
Write-Host "选择 LLM 提供商（用于评分任务结果）:"
Write-Host "  1) OpenAI"
Write-Host "  2) Anthropic"
Write-Host "  3) DeepSeek"
$llmChoice = Read-Host "选择 [1]"
if (-not $llmChoice) { $llmChoice = "1" }

switch ($llmChoice) {
    "1" { $provider = "openai" }
    "2" { $provider = "anthropic" }
    "3" { $provider = "deepseek" }
    default { $provider = "openai" }
}

Write-Host ""
$apiKey = Read-Host "$provider API Key"

# 更新配置文件
$content = Get-Content $configFile -Raw
$content = $content -replace 'name: ".*"', "name: `"$nodeName`""
if ($serverUrl) {
    $content = $content -replace 'server_url: ".*"', "server_url: `"$serverUrl`""
}
$content = $content -replace 'default_provider: ".*"', "default_provider: `"$provider`""

if ($apiKey) {
    # 更新对应 provider 的 api_key
    $inProvider = $false
    $lines = $content -split "`n"
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match "^\s+$provider:") { $inProvider = $true }
        if ($inProvider -and $lines[$i] -match 'api_key:') {
            $lines[$i] = $lines[$i] -replace 'api_key: ".*"', "api_key: `"$apiKey`""
            $inProvider = $false
        }
    }
    $content = $lines -join "`n"
}

$content | Out-File -FilePath $configFile -Encoding utf8
Ok "配置已保存"

# ── 6. 硬件检查 ──────────────────────────────────────────────

Write-Host ""
Info "检查硬件..."
try {
    npx tsx src/index.ts check 2>&1
} catch {
    Warn "硬件检查未通过，节点可能运行不稳定"
}

# ── 7. 质押（可选） ──────────────────────────────────────────

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  质押 TALKEN（可选）"
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "质押 100 TALKEN 可以让你的节点被其他 Agent 自动发现。"
Write-Host "不质押也可以运行节点，但只能通过直接连接使用。"
Write-Host ""
$doStake = Read-Host "是否现在质押？(y/N)"

if ($doStake -eq "y" -or $doStake -eq "Y") {
    Write-Host ""
    $privateKey = Read-Host "钱包私钥 (0x...)"
    if ($privateKey) {
        $stakeUrl = Read-Host "节点公网地址 (ws://IP:1789)"
        if ($stakeUrl) {
            Info "正在质押..."
            $env:TALKEN_WALLET_PRIVATE_KEY = $privateKey
            npx tsx src/index.ts stake --url $stakeUrl
            Remove-Item Env:\TALKEN_WALLET_PRIVATE_KEY
        } else {
            Warn "未输入地址，跳过质押"
        }
    } else {
        Warn "未输入私钥，跳过质押"
    }
}

# ── 8. 创建启动脚本 ──────────────────────────────────────────

Write-Host ""
Info "创建启动脚本..."

@"
@echo off
cd /d "$validatorDir"
echo Starting TALKEN Validator Node...
npx tsx src/index.ts start
"@ | Out-File -FilePath "$INSTALL_DIR\start.cmd" -Encoding ascii

Ok "启动脚本已创建"

# ── 完成 ─────────────────────────────────────────────────────

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "  安装完成！"
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  配置文件: $validatorDir\validator-config.yaml"
Write-Host ""
Write-Host "  启动节点:" -ForegroundColor Cyan
Write-Host "    $INSTALL_DIR\start.cmd"
Write-Host ""
Write-Host "  或手动启动:" -ForegroundColor Cyan
Write-Host "    cd $validatorDir"
Write-Host "    npx tsx src/index.ts start"
Write-Host ""
Write-Host "  常用命令:" -ForegroundColor Cyan
Write-Host "    npx tsx src/index.ts status       # 查看状态"
Write-Host "    npx tsx src/index.ts stake-status  # 查看质押状态"
Write-Host "    npx tsx src/index.ts unstake       # 解除质押"
Write-Host ""
Write-Host "  更多信息: $validatorDir\SETUP.md"
Write-Host ""
