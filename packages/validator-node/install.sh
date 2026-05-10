#!/usr/bin/env bash

# ─────────────────────────────────────────────────────────────
# TALKEN Validator Node - 一键安装脚本
#
# 用法（两种方式任选）:
#   方式一（推荐）:
#     curl -fsSL https://raw.githubusercontent.com/ARC7US/TALKEN/master/packages/validator-node/install.sh -o install.sh
#     bash install.sh
#
#   方式二:
#     curl -fsSL https://raw.githubusercontent.com/ARC7US/TALKEN/master/packages/validator-node/install.sh | bash
# ─────────────────────────────────────────────────────────────

# 关键：如果通过管道执行（curl | bash），stdin 不是终端，所有 read 都会失败。
# 这里检测并用 /dev/tty 重新执行脚本，让 stdin 指向真正的终端。
if [ ! -t 0 ] && [ -e /dev/tty ]; then
    exec bash "$0" </dev/tty
fi

set -e

REPO="https://github.com/ARC7US/TALKEN.git"
INSTALL_DIR="$HOME/talken-validator"
BRANCH="master"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail()  { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }

# 安全的交互式输入函数
ask() {
    local prompt="$1"
    local default="$2"
    local answer
    echo -n "$prompt"
    read -r answer
    echo "${answer:-$default}"
}

echo ""
echo "═══════════════════════════════════════════"
echo "  TALKEN Validator Node - 安装程序"
echo "═══════════════════════════════════════════"
echo ""

# ── 1. 检查依赖 ──────────────────────────────────────────────

info "检查系统依赖..."

# Node.js
if ! command -v node &>/dev/null; then
    warn "未检测到 Node.js，正在安装..."
    if command -v apt-get &>/dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif command -v brew &>/dev/null; then
        brew install node
    elif command -v dnf &>/dev/null; then
        sudo dnf install -y nodejs
    else
        fail "无法自动安装 Node.js。请手动安装 Node.js 18+: https://nodejs.org"
    fi
fi
NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VER" -lt 18 ]; then
    fail "Node.js 版本过低 ($(node -v))，需要 18+。请升级: https://nodejs.org"
fi
ok "Node.js $(node -v)"

# Git
if ! command -v git &>/dev/null; then
    warn "未检测到 Git，正在安装..."
    if command -v apt-get &>/dev/null; then
        sudo apt-get install -y git
    elif command -v brew &>/dev/null; then
        brew install git
    elif command -v dnf &>/dev/null; then
        sudo dnf install -y git
    else
        fail "无法自动安装 Git。请手动安装。"
    fi
fi
ok "Git $(git --version | awk '{print $3}')"

# pnpm
if ! command -v pnpm &>/dev/null; then
    info "正在安装 pnpm..."
    npm install -g pnpm 2>/dev/null || true

    # 刷新 PATH
    NPM_GLOBAL=$(npm config get prefix 2>/dev/null)
    export PATH="$NPM_GLOBAL/bin:$PATH"
    hash -r

    if ! command -v pnpm &>/dev/null; then
        warn "npm 全局安装 pnpm 失败，尝试 corepack..."
        corepack enable 2>/dev/null || true
        corepack prepare pnpm@latest --activate 2>/dev/null || true
        hash -r
    fi

    if ! command -v pnpm &>/dev/null; then
        fail "pnpm 安装失败。请手动安装: npm install -g pnpm"
    fi
fi
ok "pnpm $(pnpm -v)"

# ── 2. 克隆仓库 ──────────────────────────────────────────────

echo ""
info "正在下载 TALKEN 代码..."

if [ -d "$INSTALL_DIR" ]; then
    warn "目录已存在: $INSTALL_DIR"
    confirm=$(ask "是否删除并重新安装？(y/N): " "n")
    if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
        rm -rf "$INSTALL_DIR"
    else
        info "跳过下载，使用已有目录"
    fi
fi

if [ ! -d "$INSTALL_DIR" ]; then
    git clone --branch "$BRANCH" --depth 1 "$REPO" "$INSTALL_DIR"
fi
ok "代码下载完成"

# ── 3. 安装依赖 ──────────────────────────────────────────────

echo ""
info "正在安装依赖..."
cd "$INSTALL_DIR"
pnpm install 2>&1 | tail -5
ok "依赖安装完成"

# ── 4. 初始化配置 ────────────────────────────────────────────

echo ""
info "初始化配置文件..."

cd "$INSTALL_DIR/packages/validator-node"

CONFIG_FILE="$INSTALL_DIR/packages/validator-node/validator-config.yaml"

if [ ! -f "$CONFIG_FILE" ]; then
    cat > "$CONFIG_FILE" << 'YAML'
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
YAML
fi
ok "配置文件已生成"

# ── 5. 交互式配置 ────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════"
echo "  配置向导"
echo "═══════════════════════════════════════════"
echo ""

# 节点名称
node_name=$(ask "  节点名称 [my-validator-001]: " "my-validator-001")

# 公网地址
echo ""
echo "  你的节点需要一个公网可访问的地址。"
echo "  如果有公网 IP，输入 ws://你的IP:1789"
echo "  如果没有，按回车跳过（稍后可手动配置）"
server_url=$(ask "  节点地址: " "")

# LLM 提供商
echo ""
echo "  选择 LLM 提供商（用于评分任务结果）:"
echo "    1) OpenAI"
echo "    2) Anthropic"
echo "    3) DeepSeek"
llm_choice=$(ask "  选择 [1]: " "1")

case $llm_choice in
    1) provider="openai" ;;
    2) provider="anthropic" ;;
    3) provider="deepseek" ;;
    *) provider="openai" ;;
esac

# API Key
echo ""
api_key=$(ask "  ${provider} API Key: " "")

# 更新配置文件
if [ -n "$node_name" ]; then
    sed -i "s/name: .*/name: \"$node_name\"/" "$CONFIG_FILE"
fi

if [ -n "$server_url" ]; then
    sed -i "s|server_url: .*|server_url: \"$server_url\"|" "$CONFIG_FILE"
fi

sed -i "s/default_provider: .*/default_provider: \"$provider\"/" "$CONFIG_FILE"

if [ -n "$api_key" ]; then
    case $provider in
        openai)
            sed -i "/openai:/,/api_key:/ s/api_key: .*/api_key: \"$api_key\"/" "$CONFIG_FILE"
            ;;
        anthropic)
            sed -i "/anthropic:/,/api_key:/ s/api_key: .*/api_key: \"$api_key\"/" "$CONFIG_FILE"
            ;;
        deepseek)
            sed -i "/deepseek:/,/api_key:/ s/api_key: .*/api_key: \"$api_key\"/" "$CONFIG_FILE"
            ;;
    esac
fi

ok "配置已保存"

# ── 6. 硬件检查 ──────────────────────────────────────────────

echo ""
info "检查硬件..."
npx tsx src/index.ts check 2>&1 || warn "硬件检查未通过，节点可能运行不稳定"

# ── 7. 质押（可选） ──────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════"
echo "  质押 TALKEN（可选）"
echo "═══════════════════════════════════════════"
echo ""
echo "  质押 100 TALKEN 可以让你的节点被其他 Agent 自动发现。"
echo "  不质押也可以运行节点，但只能通过直接连接使用。"
echo ""
do_stake=$(ask "  是否现在质押？(y/N): " "n")

if [ "$do_stake" = "y" ] || [ "$do_stake" = "Y" ]; then
    echo ""
    private_key=$(ask "  钱包私钥 (0x...): " "")
    if [ -n "$private_key" ]; then
        stake_url=$(ask "  节点公网地址 (ws://IP:1789): " "")
        if [ -n "$stake_url" ]; then
            info "正在质押..."
            TALKEN_WALLET_PRIVATE_KEY="$private_key" npx tsx src/index.ts stake --url "$stake_url" 2>&1
        else
            warn "未输入地址，跳过质押"
        fi
    else
        warn "未输入私钥，跳过质押"
    fi
fi

# ── 8. 创建启动脚本 ──────────────────────────────────────────

echo ""
info "创建启动脚本..."

cat > "$INSTALL_DIR/start.sh" << SCRIPT
#!/usr/bin/env bash
export PATH="\$(npm config get prefix)/bin:\$PATH"
cd "\$(dirname "\$0")/packages/validator-node"
echo "Starting TALKEN Validator Node..."
npx tsx src/index.ts start
SCRIPT
chmod +x "$INSTALL_DIR/start.sh"

cat > "$INSTALL_DIR/start.cmd" << 'SCRIPT'
@echo off
cd /d "%~dp0\packages\validator-node"
echo Starting TALKEN Validator Node...
npx tsx src/index.ts start
SCRIPT

ok "启动脚本已创建"

# ── 完成 ─────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════"
echo -e "  ${GREEN}安装完成！${NC}"
echo "═══════════════════════════════════════════"
echo ""
echo "  配置文件: $CONFIG_FILE"
echo ""
echo "  启动节点:"
echo "    $INSTALL_DIR/start.sh"
echo ""
echo "  或手动启动:"
echo "    cd $INSTALL_DIR/packages/validator-node"
echo "    npx tsx src/index.ts start"
echo ""
echo "  常用命令:"
echo "    npx tsx src/index.ts status       # 查看状态"
echo "    npx tsx src/index.ts stake-status  # 查看质押状态"
echo "    npx tsx src/index.ts unstake       # 解除质押"
echo ""
echo "  更多信息: $INSTALL_DIR/packages/validator-node/SETUP.md"
echo ""
