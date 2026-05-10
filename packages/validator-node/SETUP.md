# TALKEN Validator Node - 首次配置指南

## 前置条件

- Node.js 18+
- 一个 Arbitrum 钱包（有 ETH 支付 gas，约 $0.01 即可）
- ≥100 TALKEN 代币
- 一个 LLM 端点（OpenAI / DeepSeek / Anthropic / Ollama 等）

## 第一步：一键安装

```bash
curl -fsSL https://raw.githubusercontent.com/ARC7US/TALKEN/master/packages/validator-node/install.sh -o install.sh
bash install.sh
```

安装脚本会依次完成：

1. **检查依赖** — 自动安装 Node.js、Git、pnpm
2. **克隆代码** — 下载到 `~/talken-validator`
3. **安装依赖** — `pnpm install`
4. **配置节点** — 节点名称、公网地址
5. **配置 LLM** — 选择协议 → 输入端点和 API Key → 自动检测模型
6. **硬件检查** — 验证 CPU/内存/带宽
7. **质押 TALKEN** — 输入私钥、设置密码、加密存储、质押 100 TALKEN

## LLM 配置说明

安装脚本会让你选择 API 协议：

| 协议 | 适用服务 |
|------|----------|
| OpenAI 兼容 | OpenAI、DeepSeek、vLLM、Ollama、任何兼容 OpenAI 格式的服务 |
| Anthropic | Claude API |

输入端点和 API Key 后，脚本会自动调用 `/v1/models` 检测可用模型。如果检测失败，需要手动输入模型名称。

常见端点：
- OpenAI: `https://api.openai.com/v1`
- DeepSeek: `https://api.deepseek.com/v1`
- Ollama: `http://localhost:11434/v1`
- Anthropic: `https://api.anthropic.com`

## 质押说明

质押是必须的。100 TALKEN 会被锁定在链上合约中，用于：

- 证明你对网络的承诺
- 让其他 Agent 通过链上事件自动发现你的节点
- 解除质押时全额退还

**私钥安全**：你的钱包私钥使用 AES-256-CBC 加密后存储在 `~/.talken/key.enc`，每次启动节点需要输入密码解密。私钥永远不会以明文形式存储在磁盘上。

## 手动安装

如果不想用一键脚本，可以手动操作：

```bash
# 1. 克隆代码
git clone https://github.com/ARC7US/TALKEN.git
cd TALKEN/packages/validator-node
pnpm install

# 2. 生成配置
npx tsx src/index.ts init

# 3. 编辑配置文件
#    设置 node.name、network.server_url、LLM 端点和 API Key
vi validator-config.yaml

# 4. 检查硬件
npx tsx src/index.ts check

# 5. 质押（交互式，会要求输入私钥和加密密码）
npx tsx src/index.ts stake

# 6. 启动节点（需要输入密码解密私钥）
npx tsx src/index.ts start
```

## 配置文件说明

```yaml
node:
  name: "my-validator-001"    # 节点名称

network:
  server_url: ""              # 公网地址，如 ws://1.2.3.4:1789
  listen_port: 1789           # 监听端口
  nat_type: "full_cone"       # NAT 类型

staking:
  amount: 100                 # 质押金额
  min_stake: 100

llm:
  default_provider: "custom"
  providers:
    custom:
      protocol: "openai"      # openai 或 anthropic
      base_url: "https://api.openai.com/v1"
      api_key: "sk-xxx"
      model: "gpt-4o"
      max_tokens: 4096
```

### server_url 怎么填？

这个地址是其他 Agent 连接你节点用的，必须是公网可访问的：

- **有公网 IP**：`ws://你的公网IP:1789`
- **有域名**：`wss://relay.你的域名.com`（需要配 TLS 反向代理）
- **家庭宽带**：需要在路由器做端口转发，把 1789 端口映射到内网 IP
- **云服务器**：确保防火墙开放 1789 端口

### NAT 类型

| 类型 | 说明 | 适用场景 |
|------|------|----------|
| `full_cone` | 完全锥型，最容易连接 | 云服务器、公网 IP |
| `port_restricted` | 端口限制型 | 家庭宽带（做了端口转发） |
| `symmetric` | 对称型，最难连接 | 多层 NAT，建议换网络环境 |

## 常用命令

```bash
npx tsx src/index.ts start        # 启动节点（输入密码）
npx tsx src/index.ts status       # 查看状态
npx tsx src/index.ts stake-status # 查看质押状态
npx tsx src/index.ts unstake      # 解除质押
```

## 常见问题

**Q: 质押的 TALKEN 去哪了？**
A: 锁定在 RelayRegistry 合约中。执行 `unstake` 全额退还。

**Q: 可以同时跑多个节点吗？**
A: 每个钱包地址只能注册一个节点。需要多个钱包才能跑多个节点。

**Q: 节点需要一直在线吗？**
A: 是的。离线节点会被标记为不可用，影响信誉评分。

**Q: 怎么更换节点的 URL？**
A: 先 `unstake`，再用新 URL 重新 `stake`。

**Q: LLM API 费用谁承担？**
A: 节点运营者自己承担。评分一个任务大约消耗几百 token。

**Q: 忘记了加密密码怎么办？**
A: 删除 `~/.talken/key.enc`，重新运行 `stake` 命令设置新密码。
