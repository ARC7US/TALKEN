# TALKEN Validator Node - 首次配置指南

## 前置条件

- Node.js 18+ 
- 一个 Arbitrum 钱包（有 ETH 支付 gas，约 $0.01 即可）
- ≥100 TALKEN 代币
- 一个 LLM API Key（OpenAI / Anthropic / DeepSeek 任选）

## 第一步：安装

### 方式一：一键安装（推荐）

```bash
# 下载安装脚本
curl -fsSL https://raw.githubusercontent.com/ARC7US/TALKEN/master/packages/validator-node/install.sh -o install.sh

# 运行
bash install.sh
```

脚本会自动：检查依赖 → 克隆代码 → 安装依赖 → 交互式配置 → 硬件检查 → 可选质押

### 方式二：手动安装

```bash
git clone https://github.com/ARC7US/TALKEN.git
cd TALKEN/packages/validator-node
pnpm install
```

## 第二步：初始化配置

```bash
npx tsx src/index.ts init
```

这会在当前目录生成 `validator-config.yaml`，用编辑器打开它：

```yaml
node:
  name: "my-validator-001"    # 给你的节点起个名字
  data_dir: "./data"

network:
  server_url: ""              # 你的公网地址，例如 ws://123.45.67.89:1789
  listen_port: 1789           # 监听端口，一般不用改
  nat_type: "full_cone"       # NAT 类型，详见下方说明

staking:
  amount: 100                 # 质押金额（TALKEN）
  auto_restake: true
  min_stake: 100

llm:
  default_provider: "openai"  # 改成你用的提供商: openai / anthropic / deepseek

  providers:
    openai:
      base_url: "https://api.openai.com/v1"
      api_key: ""             # 填入你的 API Key
      model: "gpt-4o"

    anthropic:
      base_url: "https://api.anthropic.com"
      api_key: ""
      model: "claude-sonnet-4-20250514"

    deepseek:
      base_url: "https://api.deepseek.com/v1"
      api_key: ""
      model: "deepseek-chat"

scoring:
  # 评分提示词模板，一般不需要修改
  prompt_template: |
    ...
  timeout: 60
  retries: 2
```

### 需要修改的项

| 配置项 | 说明 |
|--------|------|
| `node.name` | 节点名称，自定义即可 |
| `network.server_url` | 你的公网可访问地址（见下方说明） |
| `llm.default_provider` | 选择你要用的 LLM 提供商 |
| `llm.providers.<provider>.api_key` | 对应提供商的 API Key |

### server_url 怎么填？

这个地址是其他 Agent 连接你节点用的，必须是公网可访问的：

- **有公网 IP**：`ws://你的公网IP:1789`
- **有域名**：`wss://relay.你的域名.com`（需要配 TLS 反向代理）
- **家庭宽带（有 NAT）**：需要在路由器做端口转发，把 1789 端口映射到你电脑的内网 IP
- **云服务器**：确保防火墙开放 1789 端口

### NAT 类型说明

| 类型 | 说明 | 适用场景 |
|------|------|----------|
| `full_cone` | 完全锥型，最容易连接 | 云服务器、公网 IP |
| `port_restricted` | 端口限制型 | 家庭宽带（做了端口转发） |
| `symmetric` | 对称型，最难连接 | 多层 NAT，建议换网络环境 |

## 第三步：检查硬件

```bash
npx tsx src/index.ts check
```

最低要求：
- CPU：4 核
- 内存：4 GB
- 带宽：20 Mbps

## 第四步：质押并注册

质押 100 TALKEN 并在 Arbitrum 链上注册你的节点：

```bash
# 设置钱包私钥
export TALKEN_WALLET_PRIVATE_KEY="0x你的私钥"

# 质押并注册
npx tsx src/index.ts stake --url ws://你的公网IP:1789
```

这条命令会：
1. 检查你的钱包是否有 ≥100 TALKEN
2. 授权 RelayRegistry 合约使用 100 TALKEN
3. 在链上注册你的节点 URL
4. 插件通过读取链上事件就能自动发现你的节点

### 查看质押状态

```bash
npx tsx src/index.ts stake-status
```

### 解除质押（退还 100 TALKEN）

```bash
npx tsx src/index.ts unstake
```

## 第五步：启动节点

```bash
# 方式一：直接启动
npx tsx src/index.ts start

# 方式二：通过环境变量传入 API Key
OPENAI_API_KEY=sk-xxx npx tsx src/index.ts start

# 方式三：使用 systemd 后台运行（Linux）
# 创建 /etc/systemd/system/talken-validator.service
```

启动成功后会看到：

```
Validator Node Status:
  Name:     my-validator-001
  Port:     1789
  Status:   Running
  ...

Relay server listening on port 1789 (HTTP + WebSocket)
Waiting for tasks...
```

## 完整流程示例

```bash
# 1. 安装
cd packages/validator-node
pnpm install

# 2. 初始化配置
npx tsx src/index.ts init

# 3. 编辑配置文件
#    - 设置 node.name
#    - 设置 network.server_url
#    - 设置 LLM provider 和 api_key

# 4. 检查硬件
npx tsx src/index.ts check

# 5. 质押并注册（只需一次）
export TALKEN_WALLET_PRIVATE_KEY="0xabc..."
npx tsx src/index.ts stake --url ws://1.2.3.4:1789

# 6. 启动节点
npx tsx src/index.ts start
```

## 常见问题

**Q: 质押的 TALKEN 去哪了？**
A: 质押后 TALKEN 会转移到 RelayRegistry 合约中锁定。执行 `unstake` 会全额退还。

**Q: 可以同时跑多个节点吗？**
A: 每个钱包地址只能注册一个节点。要跑多个节点需要多个钱包。

**Q: 节点需要一直在线吗？**
A: 是的。离线节点会被网络标记为不可用，影响信誉评分。

**Q: 怎么更换节点的 URL？**
A: 先 `unstake` 解除注册，再用新 URL 重新 `stake`。

**Q: LLM API 费用谁承担？**
A: 节点运营者自己承担。评分一个任务大约消耗几百 token，费用很低。

**Q: 怎么查看收益？**
A: 当前版本暂未实现收益查询，后续会添加 `earnings` 命令。
