#!/usr/bin/env bash

# ─────────────────────────────────────────────────────────────
# TALKEN Validator Node - 一键安装脚本
#
# 用法:
#   curl -fsSL https://raw.githubusercontent.com/ARC7US/TALKEN/master/packages/validator-node/install.sh -o install.sh
#   bash install.sh
# ─────────────────────────────────────────────────────────────

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

# 确定输入源：优先 /dev/tty，否则用 stdin
if [ -e /dev/tty ]; then
    TTY="/dev/tty"
else
    TTY="/dev/stdin"
fi

ask() {
    local prompt="$1"
    local default="$2"
    local answer
    printf "%s" "$prompt" >"$TTY"
    read -r answer <"$TTY"
    echo "${answer:-$default}"
}

ask_secret() {
    local prompt="$1"
    local answer
    printf "%s" "$prompt" >"$TTY"
    read -rs answer <"$TTY"
    echo "" >"$TTY"
    echo "$answer"
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
    NPM_GLOBAL=$(npm config get prefix 2>/dev/null)
    export PATH="$NPM_GLOBAL/bin:$PATH"
    hash -r
    if ! command -v pnpm &>/dev/null; then
        corepack enable 2>/dev/null || true
        corepack prepare pnpm@latest --activate 2>/dev/null || true
        hash -r
    fi
    if ! command -v pnpm &>/dev/null; then
        fail "pnpm 安装失败。请手动安装: npm install -g pnpm"
    fi
fi
ok "pnpm $(pnpm -v)"

# curl (用于检测 LLM 端点)
if ! command -v curl &>/dev/null; then
    fail "需要 curl。请安装: apt-get install curl"
fi

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
YAML
fi
ok "配置文件已生成"

# ── 5. 交互式配置 ────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════"
echo "  节点配置"
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

# ── 5a. LLM 配置 ─────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════"
echo "  LLM 配置（用于评分任务结果）"
echo "═══════════════════════════════════════════"
echo ""
echo "  选择 API 协议:"
echo "    1) OpenAI 兼容协议（OpenAI / DeepSeek / vLLM / Ollama 等）"
echo "    2) Anthropic 协议（Claude）"
protocol_choice=$(ask "  选择 [1]: " "1")

case $protocol_choice in
    1) protocol="openai" ;;
    2) protocol="anthropic" ;;
    *) protocol="openai" ;;
esac

echo ""
echo "  输入 LLM 端点地址:"
if [ "$protocol" = "openai" ]; then
    echo "  例如: https://api.openai.com/v1"
    echo "        https://api.deepseek.com/v1"
    echo "        http://localhost:11434/v1 (Ollama)"
else
    echo "  例如: https://api.anthropic.com"
fi
llm_base_url=$(ask "  端点: " "")

# 移除末尾斜杠
llm_base_url="${llm_base_url%/}"

echo ""
api_key=$(ask_secret "  API Key: ")

# 自动检测模型
echo ""
info "正在检测可用模型..."

detected_model=""
if [ "$protocol" = "openai" ]; then
    # OpenAI 兼容协议: GET /v1/models
    models_response=$(curl -s --max-time 10 \
        -H "Authorization: Bearer $api_key" \
        "$llm_base_url/models" 2>/dev/null || echo "")

    if [ -n "$models_response" ]; then
        # 尝试用 node 解析 JSON（比 jq 更可靠）
        detected_model=$(node -e "
            const data = JSON.parse(process.argv[1] || '{}');
            const models = data.data || data.models || [];
            const ids = models.map(m => m.id || m);
            const preferred = ids.find(id => /gpt-4|claude|deepseek|qwen|llama/i.test(id));
            console.log(preferred || ids[0] || '');
        " "$models_response" 2>/dev/null || echo "")
    fi
elif [ "$protocol" = "anthropic" ]; then
    # Anthropic 没有公开的 models 端点，尝试调用一个最小请求来验证 key
    test_response=$(curl -s --max-time 10 \
        -H "x-api-key: $api_key" \
        -H "anthropic-version: 2023-06-01" \
        -H "Content-Type: application/json" \
        -d '{"model":"claude-sonnet-4-20250514","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}' \
        "$llm_base_url/v1/messages" 2>/dev/null || echo "")

    if echo "$test_response" | grep -q '"content"'; then
        detected_model="claude-sonnet-4-20250514"
    fi
fi

if [ -n "$detected_model" ]; then
    ok "检测到模型: $detected_model"
    use_detected=$(ask "  使用该模型？(Y/n): " "y")
    if [ "$use_detected" = "n" ] || [ "$use_detected" = "N" ]; then
        detected_model=""
    fi
fi

if [ -z "$detected_model" ]; then
    if [ "$protocol" = "openai" ]; then
        echo "  未能自动检测，请手动输入模型名称。"
        echo "  例如: gpt-4o, deepseek-chat, qwen-plus, llama3"
    else
        echo "  请输入模型名称。"
        echo "  例如: claude-sonnet-4-20250514, claude-haiku-4-5-20251001"
    fi
    detected_model=$(ask "  模型名称: " "")
fi

if [ -z "$detected_model" ]; then
    fail "模型名称不能为空。"
fi

# 写入配置
if [ -n "$node_name" ]; then
    sed -i "s/name: .*/name: \"$node_name\"/" "$CONFIG_FILE"
fi

if [ -n "$server_url" ]; then
    sed -i "s|server_url: .*|server_url: \"$server_url\"|" "$CONFIG_FILE"
fi

# 写入 LLM 配置
cat > /tmp/talken_llm.py << 'PYEOF'
import sys, re

config_file = sys.argv[1]
protocol = sys.argv[2]
base_url = sys.argv[3]
api_key = sys.argv[4]
model = sys.argv[5]

with open(config_file, 'r') as f:
    content = f.read()

# 替换 default_provider
content = re.sub(r'default_provider:.*', f'default_provider: "custom"', content)

# 构建新的 providers 块
providers_block = f'''  providers:
    custom:
      protocol: "{protocol}"
      base_url: "{base_url}"
      api_key: "{api_key}"
      model: "{model}"
      max_tokens: 4096'''

# 替换 providers 部分
content = re.sub(
    r'  providers:\n(?:    \w+:\n(?:      .*\n)*)*',
    providers_block + '\n',
    content
)

with open(config_file, 'w') as f:
    f.write(content)
PYEOF

if command -v python3 &>/dev/null; then
    python3 /tmp/talken_llm.py "$CONFIG_FILE" "$protocol" "$llm_base_url" "$api_key" "$detected_model"
elif command -v python &>/dev/null; then
    python /tmp/talken_llm.py "$CONFIG_FILE" "$protocol" "$llm_base_url" "$api_key" "$detected_model"
else
    # 纯 bash 后备方案
    sed -i "s|default_provider:.*|default_provider: \"custom\"|" "$CONFIG_FILE"
    sed -i "s|protocol:.*|protocol: \"$protocol\"|" "$CONFIG_FILE"
    sed -i "s|base_url:.*|base_url: \"$llm_base_url\"|" "$CONFIG_FILE"
    sed -i "/custom:/,/api_key:/ s|api_key:.*|api_key: \"$api_key\"|" "$CONFIG_FILE"
    sed -i "s|model:.*|model: \"$detected_model\"|" "$CONFIG_FILE"
fi
rm -f /tmp/talken_llm.py

ok "LLM 配置已保存: $protocol / $detected_model"

# ── 5b. 硬件检查 ─────────────────────────────────────────────

echo ""
info "检查硬件..."
node "$INSTALL_DIR/packages/validator-node/scripts/check-hardware.mjs" 2>&1 || warn "硬件检查未通过，节点可能运行不稳定"

# ── 6. 质押（必须） ──────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════"
echo "  质押 TALKEN（必须）"
echo "═══════════════════════════════════════════"
echo ""
echo "  运营节点需要质押 100 TALKEN 到链上合约。"
echo "  质押后你的节点会被其他 Agent 自动发现。"
echo "  解除质押时 TALKEN 会全额退还。"
echo ""

while true; do
    private_key=$(ask_secret "  钱包私钥 (0x...): ")
    if [ -n "$private_key" ]; then
        break
    fi
    warn "私钥不能为空，请重新输入。"
done

echo ""
info "正在质押并注册节点..."

# 获取配置中的端口
PORT_VAL=$(grep 'listen_port' "$CONFIG_FILE" | grep -o '[0-9]*' || echo "1789")
SERVER_URL_VAL=$(grep 'server_url' "$CONFIG_FILE" | sed 's/.*: *"\(.*\)".*/\1/')
RELAY_URL="${SERVER_URL_VAL:-ws://0.0.0.0:$PORT_VAL}"

# 使用独立脚本（纯 node，不依赖 tsx）
TALKEN_WALLET_PRIVATE_KEY="$private_key" \
    node "$INSTALL_DIR/packages/validator-node/scripts/stake.mjs" "$RELAY_URL" 2>&1

stake_exit=$?

# 质押成功后，加密存储私钥
if [ $stake_exit -eq 0 ]; then
    echo ""
    info "正在加密存储私钥..."

    while true; do
        key_password=$(ask_secret "  设置加密密码（启动节点时需要）: ")
        if [ ${#key_password} -lt 6 ]; then
            warn "密码至少 6 位，请重新设置。"
            continue
        fi
        key_password2=$(ask_secret "  确认密码: ")
        if [ "$key_password" = "$key_password2" ]; then
            break
        fi
        warn "两次密码不一致，请重新设置。"
    done

    TALKEN_WALLET_PRIVATE_KEY="$private_key" TALKEN_KEY_PASSWORD="$key_password" \
        node "$INSTALL_DIR/packages/validator-node/scripts/encrypt-key.mjs" 2>&1
else
    warn "质押失败，跳过密钥加密存储。"
fi

# ── 7. 创建启动脚本 ──────────────────────────────────────────

echo ""
info "创建启动脚本..."

cat > "$INSTALL_DIR/start.sh" << SCRIPT
#!/usr/bin/env bash
cd "\$(dirname "\$0")"
echo "Starting TALKEN Validator Node..."
echo "请输入密钥密码以启动节点："
pnpm --filter @talken/validator-node run start
SCRIPT
chmod +x "$INSTALL_DIR/start.sh"

cat > "$INSTALL_DIR/start.cmd" << 'SCRIPT'
@echo off
cd /d "%~dp0"
echo Starting TALKEN Validator Node...
echo 请输入密钥密码以启动节点：
pnpm --filter @talken/validator-node run start
SCRIPT

ok "启动脚本已创建"

# ── 完成 ─────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════"
echo -e "  ${GREEN}安装完成！${NC}"
echo "═══════════════════════════════════════════"
echo ""
echo "  配置文件: $CONFIG_FILE"
echo "  加密密钥: ~/.talken/key.enc"
echo ""
echo "  启动节点（需要输入密码）:"
echo "    $INSTALL_DIR/start.sh"
echo ""
echo "  常用命令（在 ~/talken-validator 目录下运行）:"
echo "    pnpm --filter @talken/validator-node exec tsx src/index.ts status"
echo "    pnpm --filter @talken/validator-node exec tsx src/index.ts stake-status"
echo "    pnpm --filter @talken/validator-node exec tsx src/index.ts unstake"
echo ""
echo "  更多信息: $INSTALL_DIR/packages/validator-node/SETUP.md"
echo ""
