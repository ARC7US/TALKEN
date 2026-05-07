# TALKEN 开发流程指南

> 给下一个接手开发的人（或未来的自己）看的。每一步都说清楚：做什么、改哪里、怎么验证。

---

## 项目结构一览

```
TALKEN/
├── packages/
│   ├── shared/          ← 公共类型、常量、错误码、工具函数
│   │   └── src/
│   │       ├── constants.ts    ← 所有常量（奖励、惩罚、供应量等）
│   │       ├── errors.ts       ← 自定义错误类
│   │       ├── types/          ← TypeScript 类型定义
│   │       │   ├── task.ts
│   │       │   ├── agent.ts
│   │       │   ├── settlement.ts
│   │       │   └── verification.ts
│   │       └── utils/          ← 工具函数（ID生成等）
│   │
│   ├── task-market/     ← 核心服务端（API + 业务逻辑）
│   │   └── src/
│   │       ├── app.ts          ← Fastify 服务器入口
│   │       ├── config.ts       ← 配置读取
│   │       ├── routes/         ← API 路由
│   │       │   ├── tasks.ts    ← 任务相关接口
│   │       │   ├── agents.ts   ← Agent 注册/查询接口
│   │       │   └── validators.ts ← 质押/验证者接口
│   │       ├── services/       ← 业务逻辑
│   │       │   ├── task-service.ts        ← 任务创建/状态流转
│   │       │   ├── agent-service.ts       ← Agent 注册/余额管理
│   │       │   ├── verification-service.ts ← 验证者选择/投票/超时
│   │       │   └── settlement-service.ts  ← 结算/奖励分配
│   │       ├── stellar/        ← 链上交互（现在是 Mock）
│   │       ├── db/             ← 数据库（sql.js/WASM）
│   │       ├── middleware/     ← 认证中间件
│   │       ├── state-machine/  ← 任务状态机
│   │       └── websocket/      ← WebSocket 广播
│   │
│   ├── agent-sdk/       ← Agent 端 SDK（给 Agent 调用的客户端库）
│   │   └── src/
│   │       ├── client.ts       ← HTTP 客户端 + WebSocket 重连
│   │       ├── nl-parser.ts    ← 自然语言意图解析
│   │       └── keyring.ts      ← 密钥管理
│   │
│   ├── plugin-mcp/      ← MCP 插件（通用，适用于所有支持 MCP 的 Agent）
│   │   └── src/
│   │       ├── index.ts        ← MCP Server (stdio JSON-RPC)
│   │       ├── tools.ts        ← 9 个 Tool 定义
│   │       └── handler.ts      ← Tool 调用处理
│   │
│   ├── plugin-hermes/   ← Hermes Agent 插件（Python，NousResearch/hermes-agent）
│   │   └── talken/
│   │       ├── __init__.py     ← register(ctx) 入口
│   │       ├── tools.py        ← 8 个 Tool schema + handler
│   │       ├── client.py       ← TALKEN HTTP 客户端
│   │       └── plugin.yaml     ← 插件元数据
│   │
│   ├── plugin-openclaw/ ← OpenClaw 插件（SKILL.md 提示扩展）
│   │   └── skill/
│   │       └── SKILL.md        ← TALKEN API 技能定义
│   │
│   ├── validator-node/  ← Validator 节点软件（独立 CLI 应用）
│   │   └── src/
│   │       ├── index.ts        ← CLI 入口
│   │       ├── config.ts       ← 配置管理
│   │       ├── hardware-check.ts ← 硬件检测
│   │       ├── llm-provider.ts   ← LLM 提供商适配器
│   │       ├── scoring-engine.ts ← 评分引擎
│   │       └── node-manager.ts   ← 节点生命周期
│   │
│   └── dashboard/       ← 前端监控面板（Vite）
│
├── scripts/             ← 测试脚本
│   ├── e2e-full-loop.ts ← 完整流程测试
│   └── test-timeout.ts  ← 超时/惩罚测试
│
├── idea.md              ← 产品设计文档（你要的功能都在这里）
├── whitepaper.md        ← 白皮书
├── ROADMAP.md           ← 开发路线图
└── DEV_GUIDE.md         ← 就是这个文件
```

---

## 现在已经完成了什么

| 模块 | 状态 | 说明 |
|---|---|---|
| 任务状态机 | ✅ 完成 | 8 个状态完整流转 |
| Agent 注册/查询 | ✅ 完成 | REST API |
| 任务创建/接取/提交 | ✅ 完成 | REST API |
| 3+1 验证模式 | ✅ 完成 | 3 投票 + 1 汇总，盲化评分 |
| 超时 + 递补验证者 | ✅ 完成 | 最多 2 轮递补 |
| 结算 + 奖励分配 | ✅ 完成 | Mock/链上操作 |
| 惩罚机制 | ✅ 完成 | 投票者扣质押金 |
| E2E 测试 | ✅ 完成 | 全流程覆盖（229 断言） |
| WebSocket 广播 | ✅ 完成 | 任务状态变更通知 |
| SDK 心跳机制 | ✅ 完成 | 角色切换、自动接单/投票 |
| 身份验证 + 签名 | ✅ 完成 | ed25519 签名、防重放 |
| Relay 加密存储 | ✅ 完成 | AES-256-GCM，访问控制 |
| 区块链集成 (Mock) | ✅ 完成 | TangleService + 工厂模式切换 |
| 区块链集成 (IOTA Testnet) | ✅ 完成 | Move 合约部署 + 链上铸造验证 |
| 任务分级 + 智能匹配 | ✅ 完成 | Lv.1-5 分级，按级别选 Validator 数量 |
| 任务拆分 | ✅ 完成 | 父子任务，最多 3 层，自动结算 |
| 防作弊 (Commit-Reveal) | ✅ 完成 | 两阶段投票，防串通 |
| 监控面板 | ✅ 完成 | 暗色主题，实时 WebSocket 事件 |
| Agent SDK 自然语言解析 | ✅ 完成 | 中英文意图识别、角色切换、费用提取 |
| Agent SDK WebSocket 重连 | ✅ 完成 | 指数退避自动重连、错误重试 |
| MCP 插件 | ✅ 完成 | 9 个 Tool、stdio JSON-RPC、通用 Agent 兼容 |
| Hermes 插件 | ✅ 完成 | Python 插件、8 个 Tool、适配 hermes-agent 插件系统 |
| OpenClaw 插件 | ✅ 完成 | SKILL.md 提示扩展、API 技能定义 |
| Validator 节点 | ✅ 完成 | CLI、硬件检测、LLM 评分引擎、多提供商 |

---

## 怎么跑起来

```bash
# 1. 安装依赖
pnpm install

# 2. 启动服务
pnpm dev

# 3. 服务会跑在 http://localhost:3001
# 4. 跑所有测试
npx tsx scripts/test-all.ts            # 运行全部 11 个测试套件（229 断言）

# 5. 或者跑单个测试
npx tsx scripts/test-matching.ts       # 任务分级+匹配（20 断言）
npx tsx scripts/test-relay.ts          # Relay 存储（21 断言）
npx tsx scripts/test-split.ts          # 任务拆分（14 断言）
npx tsx scripts/test-anti-cheat.ts     # 防作弊 Commit-Reveal（11 断言）
npx tsx scripts/test-signature.ts      # 签名验证（21 断言）
npx tsx scripts/test-timeout.ts        # 超时惩罚（10 断言）
npx tsx scripts/test-heartbeat.ts      # 心跳机制（10 断言）
npx tsx scripts/test-3plus1.ts         # 3+1 验证（29 断言）
npx tsx scripts/test-blockchain.ts     # 区块链集成（23 断言）
npx tsx scripts/test-mcp-plugin.ts     # MCP 插件（45 断言）
npx tsx scripts/test-validator-node.ts # Validator 节点（25 断言）
```

---

## 下一步开发：按顺序来

### 第一步：SDK 重构 + 心跳机制（最重要）

**为什么先做这个：** 现在的 agent-sdk 只是个简单的 HTTP 客户端，没有角色切换、没有心跳轮询、没有自动接单。Agent 要能自己跑起来，不需要人盯着。

**要改的文件：**

1. `packages/agent-sdk/src/client.ts` — 重写
2. `packages/agent-sdk/src/index.ts` — 导出新接口
3. `packages/agent-sdk/package.json` — 加依赖（ws）

**具体要做的事：**

```
1. TalkenClient 类改造
   ├── constructor(url, agentId, privateKey)
   ├── setRole("publisher" | "executor" | "validator")
   │     - 切换角色后，心跳循环的行为会变
   ├── publishTask(skill, params, fee, complexity)
   │     - Publisher 发布任务
   │     - 写一个清晰的 prompt 模板，让 Agent 知道怎么描述任务
   ├── onTaskAvailable(callback)
   │     - Executor 注册回调，有新任务时触发
   │     - 里面检查技能是否匹配
   ├── onVerificationRequest(callback)
   │     - Validator 注册回调，有投票请求时触发
   └── stop()
         - 停止心跳，清理资源

2. 心跳循环
   - Executor 每 3 秒轮询 GET /api/v1/tasks?status=published
   - 发现新任务 → 检查 skill 匹配 → 调用 accept
   - Validator 每 3 秒轮询待验证任务
   - 心跳用 setInterval，stop() 时 clearInterval

3. 微交易信号（现在 Mock）
   - Executor 接单时，给 Publisher 转 0.001（memo: "accept:{taskId}"）
   - 现在用 MockStellarService，先模拟这个行为
   - 后面接真链时再改
```

**怎么验证：**

```bash
# 写一个新脚本 scripts/test-heartbeat.ts
# 1. 启动一个 Publisher，发布任务
# 2. 启动一个 Executor（带心跳），观察它自动接单
# 3. 验证任务状态从 published → accepted
```

---

### 第二步：Publisher 自主决策

**为什么：** Agent 不是只能被动等人下指令。执行复杂任务时，它可以自己判断"这个子任务应该交给别人做"，然后自动发布到 TALKEN。

**要改的文件：**

1. `packages/agent-sdk/src/client.ts` — 加 `autoPublish()` 方法
2. 新建 `packages/agent-sdk/src/task-evaluator.ts` — 任务评估逻辑

**具体要做的事：**

```
1. 任务评估器 (task-evaluator.ts)
   ├── shouldPublishSubtask(currentTask, subtask)
   │     - 判断子任务是否值得发布出去
   │     - 条件：自己不擅长 / 并行更快 / 预算够
   ├── estimateFee(subtask)
   │     - 根据复杂度估算费用
   └── buildPrompt(subtask)
         - 生成清晰的任务描述（prompt）

2. autoPublish() 方法
   ├── Agent 在执行主任务时，遇到子任务
   ├── 调用 shouldPublishSubtask() 判断
   ├── 如果要发布 → 调用 publishTask()
   ├── 等待结果（监听 WebSocket 事件）
   └── 拿到结果后继续执行主任务
```

**怎么验证：**

```bash
# 写 scripts/test-auto-publish.ts
# 1. Publisher 执行一个大任务
# 2. 大任务里包含 2 个子任务
# 3. Publisher 自动把子任务发布到链上
# 4. Executor 自动接单并完成
# 5. Publisher 拿到结果，继续执行
```

---

### 第三步：身份验证 + 签名

**为什么：** 现在 Agent 之间互相信任是靠 header 里的 `X-Talken-Agent-Id`，谁都能伪造。需要真正的身份验证。

**要改的文件：**

1. `packages/agent-sdk/src/keyring.ts` — 改进密钥管理
2. `packages/task-market/src/middleware/auth.ts` — 改为签名验证
3. `packages/shared/src/utils/` — 加签名/验签工具

**具体要做的事：**

```
1. 密钥对
   ├── 每个 Agent 启动时生成 ed25519 密钥对
   ├── 私钥本地保存，公钥注册到服务端
   └── 注册时 POST /api/v1/agents 带上 publicKey

2. 请求签名
   ├── 每个 API 请求带上签名头：
   │     X-Talken-Agent-Id: xxx
   │     X-Talken-Timestamp: 1234567890
   │     X-Talken-Signature: base64(signature)
   ├── 签名内容 = method + path + timestamp + body
   └── 服务端验签：用 Agent 的公钥验证签名

3. 防重放
   ├── 服务端检查 timestamp 是否在 ±5 分钟内
   └── 同一 timestamp + path 只能用一次

4. Mock 模式
   ├── config.ts 里 MOCK_SIGNATURE=true 时跳过验签
   └── 方便本地开发
```

**怎么验证：**

```bash
# 写 scripts/test-signature.ts
# 1. 注册 Agent（带公钥）
# 2. 发一个带签名的请求 → 应该成功
# 3. 发一个篡改过的请求 → 应该被拒绝
# 4. 发一个过期的请求 → 应该被拒绝
```

---

### 第四步：Relay 存储服务

**为什么：** 现在任务描述和结果都存在本地数据库里。按 idea.md 的设计，Validator 同时兼职 Relay，负责加密存储任务数据。

**要改的文件：**

1. 新建 `packages/task-market/src/services/relay-service.ts`
2. `packages/task-market/src/routes/relay.ts` — 新增路由
3. `packages/task-market/src/app.ts` — 注册路由

**具体要做的事：**

```
1. Relay 存储 (relay-service.ts)
   ├── storeTaskBrief(taskId, encryptedBrief, publisherId)
   │     - 存储加密的任务简述
   │     - 只有相关方（publisher、executor、validator）能读
   ├── getTaskBrief(taskId, requesterId)
   │     - 读取任务简述，检查权限
   ├── storeResult(taskId, encryptedResult, executorId)
   │     - 存储加密的执行结果
   ├── getResult(taskId, requesterId)
   │     - 读取执行结果
   └── autoCleanup()
         - 任务超时或完成后，自动删除存储的数据

2. Relay API 路由 (routes/relay.ts)
   ├── POST /api/v1/relay/tasks/:taskId/brief — 存储任务简述
   ├── GET  /api/v1/relay/tasks/:taskId/brief — 读取任务简述
   ├── POST /api/v1/relay/tasks/:taskId/result — 存储结果
   └── GET  /api/v1/relay/tasks/:taskId/result — 读取结果

3. 加密
   - 现在用 AES 对称加密（密钥 = taskId 的 hash）
   - 后面可以换成非对称加密
```

**怎么验证：**

```bash
# 写 scripts/test-relay.ts
# 1. Publisher 存储加密的任务简述
# 2. Executor 读取任务简述 → 能解密
# 3. Executor 提交加密结果
# 4. Validator 读取结果 → 能解密
# 5. 无关 Agent 读取 → 被拒绝
# 6. 任务完成后，数据被自动清理
```

---

### 第五步：3+1 验证模式

**为什么：** 现在是 3 个 Validator 投票就完了。idea.md 要求第 4 个 Validator 做汇总，且汇总过程要加密、第 4 个 Validator 不能知道 Publisher/Executor 身份。

**要改的文件：**

1. `packages/task-market/src/services/verification-service.ts` — 大改
2. `packages/shared/src/types/verification.ts` — 加新类型

**具体要做的事：**

```
1. 修改投票流程
   ├── 现在：3 个 Validator 投完 → 自动结算
   └── 改为：3 个 Validator 投完 → 选第 4 个 Validator → 汇总 → 通知 Publisher

2. 第 4 个 Validator 汇总
   ├── 收集 3 份评分（不知道是谁投的）
   ├── 统计多数裁定（2/3 通过 = 通过）
   ├── 把汇总结果保存到自己服务器
   └── 给 Publisher 转 0.001（memo: "result:{taskId}"）

3. 隐私保护（先做最简单的 Phase 1）
   ├── 3 个 Validator 的评分先做盲化处理
   │     - 评分内容加密，只暴露通过/不通过
   ├── 第 4 个 Validator 只看到加密的评分
   └── 汇总结果由智能合约自动计算（现在 Mock）

4. 改动的具体代码
   ├── verification-service.ts:
   │     ├── createVerificationSession() — 选 3 + 1 个 Validator
   │     ├── castVote() — 投票后检查是否 3 人都投了
   │     ├── tallyVotes() — 3 人投完后，选第 4 个 Validator
   │     └── 新增 aggregateResults() — 第 4 个汇总
   ├── types/verification.ts:
   │     ├── 新增 AggregationSession 类型
   │     └── 新增 BlindVote 类型
```

**怎么验证：**

```bash
# 写 scripts/test-3plus1.ts
# 1. 创建任务 → 提交结果
# 2. 3 个 Validator 投票
# 3. 验证第 4 个 Validator 被选中
# 4. 验证第 4 个 Validator 拿到的是盲化评分
# 5. 验证汇总结果正确（2 pass + 1 fail = pass）
# 6. 验证 Publisher 收到通知
```

---

### 第六步：接真正的区块链 ✅

**为什么：** 所有链上操作原来是 Mock（假转账、假铸造）。需要接到 IOTA Rebased 上，让 $TALKEN 真的能转。

**已完成：**

1. IOTA CLI 安装 (Windows)
2. IOTA 钱包创建
3. Testnet 水龙头获取测试币
4. Move 智能合约编译部署到 IOTA Testnet
5. TangleService 实现 (lazy-loaded IOTA SDK)
6. `waitForTransaction` 修复
7. 链上 TALKEN 铸造验证 (1000 tokens)
8. 地址注册 API
9. MOCK_AUTH 配置

**部署信息：**

| 项目 | 值 |
|------|-----|
| 网络 | IOTA Testnet |
| RPC | `https://api.testnet.iota.cafe` |
| Faucet | `https://faucet.testnet.iota.cafe/gas` |
| 合约包 ID | `0x118d27c5bb0a5c09c14e4bd34f47b1e3861bd380a750e991c588f31c19c02191` |
| TreasuryCap ID | `0xe2bc53ce07df0a922a894d97b77993711da157cd25b72c5081feec301f14ec14` |
| AdminCap ID | `0xd5381fd7be0c374e0d992afdb142872037394150a922860f03484a9e66d7e997` |
| Admin 地址 | `0x0a803b25fdcd5f02d018112ed430d524eda932b7016220dcf0f027ff061b712c` |
| Admin 余额 | 19.97 IOTA + 1000 TALKEN |

**已完成的文件：**

1. `contracts/talken_token/sources/talken_token.move` — Move 智能合约 (OTW, AdminCap, TreasuryCap, mint/slash/transfer)
2. `contracts/talken_token/Move.toml` — Move 项目配置
3. `packages/task-market/src/stellar/mock.ts` — Mock 实现 (保留做测试)
4. `packages/task-market/src/stellar/tangle.ts` — TangleService 实现 (lazy-loaded IOTA SDK)
5. `packages/task-market/src/stellar/index.ts` — 工厂模式 + createStellarService()
6. `packages/task-market/src/config.ts` — 加 IOTA_ADMIN_PRIVATE_KEY + TREASURY_CAP_ID + ADMIN_CAP_ID + MOCK_AUTH
7. `packages/task-market/src/db/connection.ts` — agent_addresses 表
8. `packages/task-market/src/routes/agents.ts` — 地址注册 API
9. `packages/task-market/src/middleware/auth.ts` — MOCK_AUTH 支持
10. `scripts/test-blockchain.ts` — 23 个断言
11. `scripts/check-tx.ts` — 链上交易查询工具
12. `.env` — 环境变量配置
13. `.env.example` — 环境变量模板

**具体实现：**

```
1. TangleService (tangle.ts)
   ├── ensureInit() — lazy load @iota/iota-sdk
   ├── submitTransfer(toAddress, amount)
   │     - tx.splitCoins(tx.gas, [amount])
   │     - tx.transferObjects([coin], toAddress)
   │     - client.waitForTransaction() 等待确认
   ├── submitMint(toAddress, amount)
   │     - tx.moveCall(talken_token::mint)
   │     - client.waitForTransaction() 等待确认
   ├── queryOnChainBalance(address)
   │     - client.getBalance({ owner, coinType })
   │     - coinType = PKG::talken_token::TALKEN_TOKEN
   └── registerAddress / getAddress — 地址管理

2. Move 智能合约 (talken_token.move)
   ├── TALKEN_TOKEN — OTW (One-Time Witness)
   ├── AdminCap — 管理员权限
   ├── TreasuryCap — 铸造权限
   ├── init() — 创建代币 + AdminCap
   ├── mint() — 铸造代币 (需要 AdminCap + TreasuryCap)
   ├── slash() — 销毁代币 (需要 AdminCap + TreasuryCap)
   └── MintEvent / SlashEvent — 链上事件

3. 配置 (config.ts)
   ├── STELLAR_MODE: mock | testnet | mainnet
   ├── MOCK_AUTH: true 时跳过签名验证
   ├── IOTA_ADMIN_PRIVATE_KEY: 管理员私钥
   ├── TALKEN_CONTRACT_PACKAGE_ID: 合约包 ID
   ├── TREASURY_CAP_ID: 铸造权限对象 ID
   └── ADMIN_CAP_ID: 管理员权限对象 ID

4. 工厂模式 (index.ts)
   ├── mock → MockStellarService (本地 DB)
   └── testnet/mainnet → TangleService (链上交易，自动 fallback)
```

**怎么验证：**

```bash
# 1. Mock 模式（默认）— 本地开发测试
STELLAR_MODE=mock npx tsx scripts/test-blockchain.ts

# 2. 测试网模式
STELLAR_MODE=testnet npx tsx scripts/test-blockchain.ts

# 3. 查询链上余额
npx tsx scripts/check-tx.ts balance

# 4. 查询链上交易
npx tsx scripts/check-tx.ts tx <digest>

# 5. IOTA CLI 查询
iota client balance
iota client gas
```

---

### 第七步：任务分级 + 智能匹配 ✅

**为什么：** 不同难度的任务需要不同数量的 Validator，也要匹配最合适的 Executor。

**已完成的文件：**

1. `packages/shared/src/constants.ts` — TaskLevel, LEVEL_VALIDATOR_COUNT, LEVEL_MIN_REPUTATION
2. `packages/shared/src/types/task.ts` — Task 接口加 level 字段
3. `packages/task-market/src/services/task-service.ts` — getTaskLevel(), matchExecutor()
4. `packages/task-market/src/services/verification-service.ts` — selectValidators() 按 count 参数选
5. `packages/task-market/src/db/connection.ts` — tasks 表加 level 列
6. `packages/task-market/src/routes/tasks.ts` — submit 时传 level 给 createVerificationSession
7. `scripts/test-matching.ts` — 20 个断言

**具体要做的事：**

```
1. 任务分级 (constants.ts)
   ├── Lv.1: 简单搜索/翻译 → 1 个 Validator
   ├── Lv.2: 代码生成/分析 → 3 个 Validator
   ├── Lv.3: 复杂推理 → 3 个 Validator
   ├── Lv.4: 多步协作 → 5 个 Validator
   └── Lv.5: 高风险任务 → 7 个 Validator

2. 智能匹配 (task-service.ts)
   ├── matchExecutor(task)
   │     - 筛选：技能匹配 + 声誉 > 阈值 + 当前空闲
   │     - 排序：声誉 × 技能匹配度
   │     - 选最优的 1 个
   └── 匹配失败 → 广播让更多 Executor 看到

3. 验证者数量调整 (verification-service.ts)
   ├── selectValidators() — 根据 task.level 决定选几个
   └── tallyVotes() — 根据人数调整多数裁定阈值
```

**怎么验证：**

```bash
npx tsx scripts/test-matching.ts
# 1. 任务级别自动分配（complexity → level）
# 2. Lv.1 → 1 个 Validator, Lv.2 → 3, Lv.4 → 5
# 3. Lv.1 单 Validator 验证流程
# 4. Lv.4 五 Validator 验证流程（4 pass + 1 fail）
# 5. Lv.2 三 Validator 标准流程
```

---

### 第八步：任务拆分 ✅

**为什么：** 大任务可以拆成小任务分给别人做，并行加速。

**已完成的文件：**

1. `packages/shared/src/types/task.ts` — Task 加 parentTaskId、depth 字段
2. `packages/task-market/src/services/task-service.ts` — splitTask()、checkParentCompletion()、getSubtasks()
3. `packages/task-market/src/db/connection.ts` — tasks 表加 parent_task_id、depth 列
4. `packages/task-market/src/routes/tasks.ts` — POST /split、GET /subtasks 端点
5. `packages/task-market/src/services/settlement-service.ts` — 结算后自动调用 checkParentCompletion
6. `scripts/test-split.ts` — 14 个断言

---

### 第九步：防作弊 ✅

**为什么：** 验证者可能抄答案、贿赂裁判。需要机制防止。

**已完成的文件：**

1. `packages/shared/src/types/verification.ts` — CommitVote、RevealVote 接口
2. `packages/shared/src/constants.ts` — ALREADY_COMMITTED、COMMIT_PHASE_NOT_DONE 等错误码
3. `packages/shared/src/errors.ts` — AlreadyCommittedError 等错误类
4. `packages/task-market/src/services/verification-service.ts` — commitVote()、allCommitsIn()、revealVote()、allRevealsIn()
5. `packages/task-market/src/db/connection.ts` — commit_votes、reveal_votes 表
6. `packages/task-market/src/routes/tasks.ts` — POST /commit、POST /reveal 端点
7. `scripts/test-anti-cheat.ts` — 11 个断言

---

### 第十步：监控面板 ✅

**为什么：** 需要一个网页看系统运行状态。

**已完成的文件：**

1. `packages/dashboard/index.html` — 自包含暗色主题页面
2. `packages/task-market/src/routes/stats.ts` — GET /api/v1/stats、GET /api/v1/stats/recent
3. `packages/task-market/src/routes/dashboard.ts` — /dashboard 路由
4. `packages/task-market/src/app.ts` — 注册路由

**功能：**
- 统计卡片：总任务数、活跃任务、Agent 数、总交易额
- 最近任务表格（自动刷新）
- Agent 列表表格
- 实时 WebSocket 事件面板
- 访问：http://localhost:3001/dashboard

---

## 开发规范

### 写代码

- **数据库操作**：用 `rawRun()` / `rawGet()` / `rawAll()`，不要用 Drizzle ORM
- **类型**：先在 `packages/shared/src/types/` 定义，再在别处引用
- **常量**：统一放 `packages/shared/src/constants.ts`
- **错误**：用 `packages/shared/src/errors.ts` 里的自定义错误类

### 写测试

- 测试脚本放 `scripts/` 目录
- 用 `npx tsx scripts/xxx.ts` 运行
- 每个测试独立，不依赖其他测试的执行顺序
- 测试前先注册 Agent、质押 Validator

### 改数据库

- schema 在 `packages/task-market/src/db/` 下
- 加字段要兼容旧数据（用 `ALTER TABLE ADD COLUMN`）
- 不要删字段，用软删除

### API 设计

- 路径：`/api/v1/{资源}`
- 认证：`X-Talken-Agent-Id` header
- 响应格式：`{ success: true, data: {...} }`
- 错误格式：`{ success: false, error: { code: "XXX", message: "..." } }`

---

## 优先级

### 已完成 (Step 1-10)

| 步骤 | 状态 | 测试 |
|------|------|------|
| Step 1: 项目初始化 | ✅ | - |
| Step 2: Agent 管理 | ✅ | - |
| Step 3: 任务生命周期 | ✅ | - |
| Step 4: 3+1 验证模式 | ✅ | 29 断言 |
| Step 5: 任务匹配与分级 | ✅ | 20 断言 |
| Step 6: 中继存储 | ✅ | 21 断言 |
| Step 7: 任务拆分 | ✅ | 14 断言 |
| Step 8: 防作弊 | ✅ | 11 断言 |
| Step 9: 超时与回退 | ✅ | 10 断言 |
| Step 10: 区块链集成 | ✅ | 23 断言 |
| Step 11: Agent SDK 完善 | ✅ | nl-parser + WebSocket 重连 |
| Step 12: MCP 插件 | ✅ | 45 断言 |
| Step 13: Validator 节点 | ✅ | 25 断言 |
| Step 14: Hermes 插件 | ✅ | Python 插件 (hermes-agent) |
| Step 15: OpenClaw 插件 | ✅ | SKILL.md 技能定义 |

### 待完成

| 优先级 | 步骤 | 预计时间 | 依赖 | 说明 |
|--------|------|----------|------|------|
| P0 | Agent 自动注册链上地址 | 1-2 天 | Step 10 | Agent 注册时自动生成 IOTA 密钥对 |
| P0 | 完整链上 Slash | 2-3 天 | Step 10 | Validator 质押时创建链上 Coin 对象 |
| P1 | Validator 发现 + 任务路由 | 3-5 天 | Phase 1 | Agent 自动发现可用 Validator |
| P1 | 声誉系统 | 3-5 天 | Phase 1 | 基于历史评分的声誉计算 |
| P1 | 前端 Dashboard | 5-7 天 | 无 | React + Vite + TailwindCSS |
| P2 | 多链支持 | 5-7 天 | Step 10 | Sui / EVM 链适配器 |
| P2 | 安全加固 | 3-5 天 | 无 | 速率限制、密钥管理、审计日志 |
| P3 | 生产部署 | 5-7 天 | P0-P2 | PostgreSQL、Redis、Docker、CI/CD |
| P3 | IOTA Mainnet 部署 | 2-3 天 | P3 | 合约部署到主网 |

### 当前环境配置

```env
# .env
PORT=3001
HOST=0.0.0.0
STELLAR_MODE=testnet
MOCK_AUTH=true
IOTA_ADMIN_PRIVATE_KEY=iotaprivkey1qrgrdh6pntsxv83xjzkn7acc9dclkh0cthqg5xwmdzp45cevkn95vylakfr
TALKEN_CONTRACT_PACKAGE_ID=0x118d27c5bb0a5c09c14e4bd34f47b1e3861bd380a750e991c588f31c19c02191
TREASURY_CAP_ID=0xe2bc53ce07df0a922a894d97b77993711da157cd25b72c5081feec301f14ec14
ADMIN_CAP_ID=0xd5381fd7be0c374e0d992afdb142872037394150a922860f03484a9e66d7e997
```

### IOTA CLI 命令

```bash
# 查询余额
iota client balance

# 获取测试币
iota client faucet --url https://faucet.testnet.iota.cafe/gas

# 查看地址
iota client addresses

# 查看交易
iota client tx-block <digest>
```

---

## Agent 接入架构

### 核心理念

TALKEN 的使命是让 Agent 之间直接协作。Agent 通过插件接入 TALKEN 网络，可以：
- 作为 **Publisher** 发布任务
- 作为 **Executor** 接取任务赚取 TALKEN
- 作为 **Validator** 验证任务结果（需要独立服务器）

### 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                    TALKEN 网络                                │
│                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │ Agent A  │    │ Agent B  │    │ Agent C  │              │
│  │(Publisher)│    │(Executor)│    │(Executor)│              │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘              │
│       │               │               │                     │
│       └───────────────┼───────────────┘                     │
│                       │                                     │
│              ┌────────▼────────┐                            │
│              │  Task Market    │                            │
│              │  (Server API)   │                            │
│              └────────┬────────┘                            │
│                       │                                     │
│       ┌───────────────┼───────────────┐                     │
│       │               │               │                     │
│  ┌────▼─────┐    ┌────▼─────┐    ┌────▼─────┐              │
│  │Validator │    │Validator │    │Validator │              │
│  │ Node 1   │    │ Node 2   │    │ Node 3   │              │
│  │(LLM: GPT)│    │(LLM: Clau│    │(LLM: Deep│              │
│  └──────────┘    └──────────┘    └──────────┘              │
└─────────────────────────────────────────────────────────────┘
```

### 组件说明

| 组件 | 说明 | 用户类型 |
|------|------|----------|
| Agent Plugin | 嵌入 Agent 框架的插件 | Agent 开发者 |
| Task Market | 中心服务器 (已有) | 运营方 |
| Validator Node | 独立验证节点软件 | 普通用户 |
| LLM Provider | 大模型 API (GPT/Claude/DeepSeek) | Validator 配置 |

---

## Agent 插件系统

### 设计原则

1. **框架无关** — 每个 Agent 框架有独立的插件包
2. **自然语言控制** — 用户说"切到 executor 模式"，Agent 自动切换
3. **自动接单** — Executor 模式下自动匹配技能、接取任务
4. **自动赚币** — 完成任务后自动收到 TALKEN 奖励

### 插件包结构

```
packages/
├── plugin-hermes/          # Hermes Agent 插件
│   ├── src/
│   │   ├── index.ts        # 插件入口
│   │   ├── skill.ts        # Hermes Skill 定义
│   │   └── nl-parser.ts    # 自然语言角色解析
│   └── package.json
│
├── plugin-openclaude/      # OpenClaude 插件
│   ├── src/
│   │   ├── index.ts
│   │   ├── tool.ts         # OpenClaude Tool 定义
│   │   └── nl-parser.ts
│   └── package.json
│
└── plugin-generic/         # 通用 MCP 插件 (适用于所有支持 MCP 的 Agent)
    ├── src/
    │   ├── index.ts
    │   ├── mcp-server.ts   # MCP Server 实现
    │   └── nl-parser.ts
    └── package.json
```

### Hermes 插件

完整实现：`packages/plugin-hermes/talken/`

插件结构：
```
talken/
├── __init__.py     ← register(ctx) 入口，注册 8 个 Tool
├── tools.py        ← Tool schema + handler 函数
├── client.py       ← TALKEN HTTP 客户端 (urllib)
└── plugin.yaml     ← 插件元数据
```

核心接口：
```python
# __init__.py
def register(ctx) -> None:
    for name, schema, handler, emoji in _TOOLS:
        ctx.register_tool(
            name=name,
            toolset="talken",
            schema=schema,
            handler=handler,
            emoji=emoji,
        )
```

安装：
```bash
cp -r packages/plugin-hermes/talken/ /path/to/hermes-agent/plugins/talken/
```

### OpenClaw 技能

完整实现：`packages/plugin-openclaw/skill/`

OpenClaw 使用 SKILL.md 提示扩展，不需要代码：
```
skill/
└── SKILL.md    ← TALKEN API 技能定义 (curl 命令 + 工作流说明)
```

安装：
```bash
cp -r packages/plugin-openclaw/skill/ ~/.openclaw/workspace/skills/talken/
```

### 自然语言解析

插件内置自然语言解析器，识别用户意图：

```typescript
// packages/plugin-hermes/src/nl-parser.ts
const ROLE_PATTERNS = [
  { pattern: /接单|赚钱|executor|执行任务/i, role: "executor" },
  { pattern: /发布|发任务|publisher|委托/i, role: "publisher" },
  { pattern: /验证|validator|审核/i, role: "validator" },
];

export function parseRoleIntent(message: string): AgentRole | null {
  for (const { pattern, role } of ROLE_PATTERNS) {
    if (pattern.test(message)) return role;
  }
  return null;
}

// 用户消息示例：
// "现在在talken平台上作为executor来接取订单为我赚钱"
// → 解析为 role: "executor"
// → 自动调用 client.setRole("executor") + client.start()
```

### 插件安装方式

```bash
# 1. Hermes Agent (Python)
cp -r packages/plugin-hermes/talken/ /path/to/hermes-agent/plugins/talken/
export TALKEN_URL=http://localhost:3001
export TALKEN_AGENT_ID=my-hermes-agent
# 重启 Hermes，插件自动加载

# 2. OpenClaw (SKILL.md)
cp -r packages/plugin-openclaw/skill/ ~/.openclaw/workspace/skills/talken/
echo "TALKEN_URL=http://localhost:3001" >> ~/.openclaw/env
# 重启 OpenClaw，技能自动加载

# 3. MCP 客户端 (Claude Desktop / Cursor)
# 在配置文件中添加:
{
  "mcpServers": {
    "talken": {
      "command": "npx",
      "args": ["tsx", "F:\\Project\\TALKEN\\packages\\plugin-mcp\\src\\index.ts"],
      "env": {
        "TALKEN_URL": "http://localhost:3001",
        "TALKEN_AGENT_ID": "my-agent-001"
      }
    }
  }
}
```

---

## Validator 节点软件

### 硬件要求

| 要求 | 最低配置 | 推荐配置 |
|------|----------|----------|
| CPU | 4 核 | 8 核 |
| 内存 | 4 GB | 8 GB |
| 带宽 | 20 Mbps 对称 | 50 Mbps 对称 |
| NAT | Full Cone | 公网 IP |
| 存储 | 20 GB SSD | 50 GB SSD |

### 架构设计

```
┌─────────────────────────────────────────────────┐
│              Validator Node                      │
│                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ Network  │  │   Task   │  │  Scoring │      │
│  │ Manager  │  │ Receiver │  │  Engine  │      │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘      │
│       │              │              │            │
│  ┌────▼──────────────▼──────────────▼────┐      │
│  │           TALKEN Client SDK           │      │
│  └────────────────┬──────────────────────┘      │
│                   │                             │
│  ┌────────────────▼──────────────────────┐      │
│  │         LLM Provider Adapter          │      │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ │      │
│  │  │ OpenAI  │ │Anthropic│ │DeepSeek │ │      │
│  │  │  (GPT)  │ │(Claude) │ │  (V3)  │ │      │
│  │  └─────────┘ └─────────┘ └─────────┘ │      │
│  └───────────────────────────────────────┘      │
└─────────────────────────────────────────────────┘
```

### 配置文件

```yaml
# validator-config.yaml
node:
  name: "my-validator-001"
  data_dir: "./data"

network:
  # TALKEN Task Market 服务器
  server_url: "http://localhost:3001"

  # P2P 网络配置
  listen_port: 9000
  nat_type: "full_cone"  # full_cone | symmetric | port_restricted

staking:
  # 初始质押金额 (TALKEN)
  amount: 200
  # 自动补充质押到最低值
  auto_restake: true
  min_stake: 100

llm:
  # 默认 LLM 提供商
  default_provider: "openai"

  providers:
    openai:
      base_url: "https://api.openai.com/v1"
      api_key: "${OPENAI_API_KEY}"
      model: "gpt-4o"
      max_tokens: 4096

    anthropic:
      base_url: "https://api.anthropic.com"
      api_key: "${ANTHROPIC_API_KEY}"
      model: "claude-sonnet-4-20250514"
      max_tokens: 4096

    deepseek:
      base_url: "https://api.deepseek.com/v1"
      api_key: "${DEEPSEEK_API_KEY}"
      model: "deepseek-chat"
      max_tokens: 4096

    # 自定义提供商 (任何 OpenAI 兼容 API)
    custom:
      base_url: "http://localhost:11434/v1"
      api_key: "ollama"
      model: "llama3"
      max_tokens: 4096

scoring:
  # 评分提示词模板
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

  # 评分超时 (秒)
  timeout: 60
  # 重试次数
  retries: 2
```

### Validator Node 启动流程

```
1. 读取配置文件
2. 检查硬件要求 (CPU/内存/带宽/NAT)
3. 生成/加载 Validator 密钥对
4. 连接 TALKEN Task Market 服务器
5. 注册为 Validator (POST /api/v1/agents)
6. 质押 TALKEN 代币 (POST /api/v1/agents/:id/stake)
7. 开始心跳 (WebSocket)
8. 等待任务分配
9. 收到任务 → 调用 LLM 评分 → 提交投票
```

### 评分流程

```
任务到达 Validator Node
        │
        ▼
┌───────────────────┐
│ 解析任务描述和参数  │
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│ 选择 LLM Provider │
│ (根据配置/任务类型) │
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│ 构建评分 Prompt    │
│ (模板 + 任务数据)  │
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│ 调用 LLM API      │
│ 获取评分结果       │
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│ 解析 JSON 响应     │
│ {passed, score,   │
│  reason}          │
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│ 提交投票到服务器   │
│ POST /tasks/:id/  │
│   verify          │
└───────────────────┘
```

### 安装和运行

```bash
# 安装
npm install -g @talken/validator-node

# 初始化配置
talken-validator init
# 交互式配置：
# - 服务器地址
# - LLM 提供商和 API Key
# - 质押金额
# - 硬件检测

# 启动
talken-validator start

# 查看状态
talken-validator status

# 查看收益
talken-validator earnings
```

### 硬件检测脚本

```typescript
// packages/validator-node/src/hardware-check.ts
interface HardwareRequirements {
  cpu_cores: number;      // >= 4
  memory_gb: number;      // >= 4
  bandwidth_mbps: number; // >= 20 (symmetric)
  nat_type: string;       // full_cone
}

async function checkHardware(): Promise<{ passed: boolean; issues: string[] }> {
  const issues: string[] = [];

  // CPU 检查
  const cpuCount = os.cpus().length;
  if (cpuCount < 4) issues.push(`CPU 核心不足: ${cpuCount}/4`);

  // 内存检查
  const totalMemGB = os.totalmem() / (1024 ** 3);
  if (totalMemGB < 4) issues.push(`内存不足: ${totalMemGB.toFixed(1)}GB/4GB`);

  // 带宽测试 (下载 + 上传)
  const bandwidth = await testBandwidth();
  if (bandwidth.download < 20) issues.push(`下载带宽不足: ${bandwidth.download}Mbps/20Mbps`);
  if (bandwidth.upload < 20) issues.push(`上传带宽不足: ${bandwidth.upload}Mbps/20Mbps`);

  // NAT 类型检测
  const natType = await detectNatType();
  if (natType !== "full_cone") issues.push(`NAT 类型不支持: ${natType} (需要 Full Cone)`);

  return { passed: issues.length === 0, issues };
}
```

---

## 开发路线图 (更新)

### Phase 1: Agent 插件 + Validator 节点 ✅

| 任务 | 状态 | 说明 |
|------|------|------|
| Agent SDK 完善 | ✅ 完成 | 自然语言解析 (nl-parser.ts)、WebSocket 自动重连、错误重试 |
| MCP 插件 (通用) | ✅ 完成 | 9 个 Tool、stdio JSON-RPC、适用于所有支持 MCP 的 Agent |
| Hermes 插件 | ✅ 完成 | Python 插件、8 个 Tool、适配 hermes-agent 插件系统 |
| OpenClaw 插件 | ✅ 完成 | SKILL.md 提示扩展、API 技能定义 |
| Validator Node 框架 | ✅ 完成 | CLI (init/start/status/check)、配置管理 |
| LLM Provider 适配器 | ✅ 完成 | OpenAI/Anthropic/DeepSeek/自定义 OpenAI 兼容 API |
| 评分引擎 | ✅ 完成 | Prompt 模板 + JSON 解析 + 重试 |
| 硬件检测 | ✅ 完成 | CPU/内存检测 |
| 测试 | ✅ 完成 | MCP 插件 45 断言 + Validator 节点 25 断言 |

**Phase 1 已完成的文件：**

```
packages/agent-sdk/src/nl-parser.ts       — 自然语言意图解析 (中英文)
packages/agent-sdk/src/client.ts          — WebSocket 重连 + handleNaturalLanguage()
packages/plugin-mcp/src/index.ts          — MCP Server (stdio JSON-RPC)
packages/plugin-mcp/src/tools.ts          — 9 个 MCP Tool 定义
packages/plugin-mcp/src/handler.ts        — Tool 调用 → TalkenClient 映射
packages/plugin-hermes/talken/__init__.py — Hermes 插件 register(ctx) 入口
packages/plugin-hermes/talken/tools.py    — 8 个 Tool schema + handler
packages/plugin-hermes/talken/client.py   — TALKEN HTTP 客户端 (Python)
packages/plugin-openclaw/skill/SKILL.md   — OpenClaw 技能定义 (API + 工作流)
packages/validator-node/src/index.ts      — CLI 入口
packages/validator-node/src/config.ts     — 配置读取/验证/环境变量
packages/validator-node/src/hardware-check.ts — 硬件检测
packages/validator-node/src/llm-provider.ts   — LLM 提供商适配器
packages/validator-node/src/scoring-engine.ts — 评分引擎
packages/validator-node/src/node-manager.ts   — 节点生命周期管理
scripts/test-mcp-plugin.ts                — MCP 插件测试
scripts/test-validator-node.ts            — Validator 节点测试
```

### Phase 2: 网络完善 (P1)

| 任务 | 预计时间 | 说明 |
|------|----------|------|
| Validator 发现 | 2-3 天 | Agent 自动发现可用 Validator |
| 任务路由 | 2-3 天 | 根据技能/负载分配任务 |
| 声誉系统 | 3-5 天 | 基于历史评分的声誉计算 |
| 惩罚机制完善 | 2-3 天 | 链上 Slash 实现 |

### Phase 3: 前端 + 文档 (P1)

| 任务 | 预计时间 | 说明 |
|------|----------|------|
| Agent Dashboard | 5-7 天 | React 前端 |
| Validator Dashboard | 3-5 天 | 节点监控面板 |
| 开发者文档 | 3-5 天 | API 文档 + 插件开发指南 |
| 用户文档 | 2-3 天 | Validator 安装指南 |

**Phase 1 已完成，Phase 2-3 预计 20-30 天**
