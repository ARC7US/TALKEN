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
  default_provider: "custom"
  providers:
    custom:
      protocol: "openai"
      base_url: ""
      api_key: ""
      model: ""
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
Write-Host "  节点配置"
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

$nodeName = Read-Host "  节点名称 [my-validator-001]"
if (-not $nodeName) { $nodeName = "my-validator-001" }

Write-Host ""
Write-Host "  你的节点需要一个公网可访问的地址。"
Write-Host "  如果有公网 IP，输入 ws://你的IP:1789"
Write-Host "  如果没有，按回车跳过（稍后可手动配置）"
$serverUrl = Read-Host "  节点地址"

# ── 5a. LLM 配置 ─────────────────────────────────────────────

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  LLM 配置（用于评分任务结果）"
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  选择 API 协议:"
Write-Host "    1) OpenAI 兼容协议（OpenAI / DeepSeek / vLLM / Ollama 等）"
Write-Host "    2) Anthropic 协议（Claude）"
$protocolChoice = Read-Host "  选择 [1]"
if (-not $protocolChoice) { $protocolChoice = "1" }

switch ($protocolChoice) {
    "1" { $protocol = "openai" }
    "2" { $protocol = "anthropic" }
    default { $protocol = "openai" }
}

Write-Host ""
if ($protocol -eq "openai") {
    Write-Host "  输入 LLM 端点地址:"
    Write-Host "  例如: https://api.openai.com/v1"
    Write-Host "        https://api.deepseek.com/v1"
    Write-Host "        http://localhost:11434/v1 (Ollama)"
} else {
    Write-Host "  输入 LLM 端点地址:"
    Write-Host "  例如: https://api.anthropic.com"
}
$llmBaseUrl = Read-Host "  端点"
$llmBaseUrl = $llmBaseUrl.TrimEnd("/")

Write-Host ""
$apiKey = Read-Host "  API Key"

# 自动检测模型
Write-Host ""
Info "正在检测可用模型..."

$detectedModel = ""

if ($protocol -eq "openai") {
    try {
        $headers = @{ "Authorization" = "Bearer $apiKey" }
        $modelsResponse = Invoke-RestMethod -Uri "$llmBaseUrl/models" -Headers $headers -TimeoutSec 10 -ErrorAction Stop
        $models = $modelsResponse.data
        if ($models) {
            $preferred = $models | Where-Object { $_.id -match "gpt-4|claude|deepseek|qwen|llama" } | Select-Object -First 1
            if ($preferred) {
                $detectedModel = $preferred.id
            } else {
                $detectedModel = $models[0].id
            }
        }
    } catch {
        # 检测失败，手动输入
    }
} elseif ($protocol -eq "anthropic") {
    try {
        $headers = @{
            "x-api-key" = $apiKey
            "anthropic-version" = "2023-06-01"
            "Content-Type" = "application/json"
        }
        $body = '{"model":"claude-sonnet-4-20250514","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}'
        $testResponse = Invoke-RestMethod -Uri "$llmBaseUrl/v1/messages" -Method Post -Headers $headers -Body $body -TimeoutSec 10 -ErrorAction Stop
        if ($testResponse.content) {
            $detectedModel = "claude-sonnet-4-20250514"
        }
    } catch {
        # 检测失败，手动输入
    }
}

if ($detectedModel) {
    Ok "检测到模型: $detectedModel"
    $useDetected = Read-Host "  使用该模型？(Y/n)"
    if ($useDetected -eq "n" -or $useDetected -eq "N") {
        $detectedModel = ""
    }
}

if (-not $detectedModel) {
    if ($protocol -eq "openai") {
        Write-Host "  未能自动检测，请手动输入模型名称。"
        Write-Host "  例如: gpt-4o, deepseek-chat, qwen-plus, llama3"
    } else {
        Write-Host "  请输入模型名称。"
        Write-Host "  例如: claude-sonnet-4-20250514, claude-haiku-4-5-20251001"
    }
    $detectedModel = Read-Host "  模型名称"
}

if (-not $detectedModel) {
    Fail "模型名称不能为空。"
}

# 写入配置
$content = Get-Content $configFile -Raw
$content = $content -replace 'name: ".*"', "name: `"$nodeName`""
if ($serverUrl) {
    $content = $content -replace 'server_url: ".*"', "server_url: `"$serverUrl`""
}
$content = $content -replace 'default_provider: ".*"', 'default_provider: "custom"'

# 替换 providers 块
$providersBlock = @"
  providers:
    custom:
      protocol: "$protocol"
      base_url: "$llmBaseUrl"
      api_key: "$apiKey"
      model: "$detectedModel"
      max_tokens: 4096
"@

$content = [regex]::Replace($content, '  providers:\n(?:    \w+:\n(?:      .*\n)*)*', $providersBlock + "`n")

$content | Out-File -FilePath $configFile -Encoding utf8
Ok "LLM 配置已保存: $protocol / $detectedModel"

# ── 5b. 硬件检查 ─────────────────────────────────────────────

Write-Host ""
Info "检查硬件..."
try {
    node "$INSTALL_DIR\packages\validator-node\scripts\check-hardware.mjs" 2>&1
} catch {
    Warn "硬件检查未通过，节点可能运行不稳定"
}

# ── 6. 质押（必须） ──────────────────────────────────────────

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  质押 TALKEN（必须）"
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  运营节点需要质押 100 TALKEN 到链上合约。"
Write-Host "  质押后你的节点会被其他 Agent 自动发现。"
Write-Host "  解除质押时 TALKEN 会全额退还。"
Write-Host ""
Write-Host "  注意：钱包需要少量 ETH 支付 Gas 费（约 `$0.01）" -ForegroundColor Yellow
Write-Host ""

do {
    $privateKey = Read-Host "  钱包私钥 (0x...)"
    if (-not $privateKey) {
        Warn "私钥不能为空，请重新输入。"
    }
} while (-not $privateKey)

Write-Host ""
Info "正在质押并注册节点..."

# 获取配置中的端口
$portMatch = Select-String -Path $configFile -Pattern 'listen_port' | ForEach-Object { if ($_ -match '(\d+)') { $matches[1] } }
if (-not $portMatch) { $portMatch = "1789" }

$serverUrlMatch = ""
if ($serverUrl) {
    $serverUrlMatch = $serverUrl
}
if (-not $serverUrlMatch) {
    $serverUrlMatch = "ws://0.0.0.0:$portMatch"
}

$env:TALKEN_WALLET_PRIVATE_KEY = $privateKey
node "$INSTALL_DIR\packages\validator-node\scripts\stake.mjs" $serverUrlMatch 2>&1
$stakeExit = $LASTEXITCODE

# 质押成功后，加密存储私钥
if ($stakeExit -eq 0) {
    Write-Host ""
    Info "正在加密存储私钥..."

    do {
        $keyPassword = Read-Host "  设置加密密码（启动节点时需要）" -AsSecureString
        $keyPasswordPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($keyPassword))
        if ($keyPasswordPlain.Length -lt 6) {
            Warn "密码至少 6 位，请重新设置。"
            continue
        }
        $keyPassword2 = Read-Host "  确认密码" -AsSecureString
        $keyPassword2Plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($keyPassword2))
        if ($keyPasswordPlain -eq $keyPassword2Plain) {
            break
        }
        Warn "两次密码不一致，请重新设置。"
    } while ($true)

    $env:TALKEN_KEY_PASSWORD = $keyPasswordPlain
    node "$INSTALL_DIR\packages\validator-node\scripts\encrypt-key.mjs" 2>&1
    Remove-Item Env:\TALKEN_KEY_PASSWORD
} else {
    Warn "质押失败，跳过密钥加密存储。"
}

Remove-Item Env:\TALKEN_WALLET_PRIVATE_KEY

# ── 7. 创建管理脚本 ──────────────────────────────────────────

Write-Host ""
Info "创建管理脚本..."

@"
@echo off
cd /d "$validatorDir"
pnpm --filter @talken/validator-node run start
"@ | Out-File -FilePath "$INSTALL_DIR\start.cmd" -Encoding ascii

@"
@echo off
cd /d "$validatorDir"
pnpm --filter @talken/validator-node run stop
"@ | Out-File -FilePath "$INSTALL_DIR\stop.cmd" -Encoding ascii

Ok "管理脚本已创建"

# ── 完成 ─────────────────────────────────────────────────────

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "  安装完成！"
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  配置文件: $validatorDir\validator-config.yaml"
Write-Host "  加密密钥: $env:USERPROFILE\.talken\key.enc"
Write-Host ""
Write-Host "  启动节点:" -ForegroundColor Cyan
Write-Host "    $INSTALL_DIR\start.cmd"
Write-Host ""
Write-Host "  管理命令:" -ForegroundColor Cyan
Write-Host "    $INSTALL_DIR\stop.cmd      - 停止节点"
Write-Host "    使用 talken-validator logs 查看日志"
Write-Host ""
Write-Host "  更多信息: $validatorDir\SETUP.md"
Write-Host ""
