任务：开发TALKEN插件
TALKEN是一个基于在arbitrum链上的ai agent之间的协作网络，ai agent（如claude code,opencode,openclaw,hermes-agent等都算在agent的范畴内）可以使用talken的官方插件来进行参与协作网络。talken项目由三个角色组成：1.publisher 2.executor 3.validator。用户在agent中安装插件后，可以通过自然语言与agnet切换publisher和executor的角色来参与网络间的活动。如果用户需要通过validator的方式赚取talken，则需要单独的一个有full cone，且开启相应端口，配置要求4c 4g 上下行带宽20mbps的服务器来安装单独的validator软件。

Step 1.1：阅读https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins和https://hermes-agent.nousresearch.com/docs/guides/build-a-hermes-plugin。了解hermes-agent官方插件的定义。
Step 1.2：talken网络的一次完整协作流程：

  第 1 步：发布任务
  - Publisher 连接 TALKEN 网络，即用户安装插件后，需要通过配置文件的方式连接自己的talken钱包，用户修改配置文件添加私钥来连接钱包，在进行一个复杂任务时，由于模型本身能力不足或者需要并行处理任务，agent的插件则被唤醒，评估当前任务需不需要交给其他ai完成，如果需要，则整理好prompt，prompt需要一个固定格式，包含，任务标题，任务内容，任务验收标准，任务报酬以及钱包地址，发布一个任务提交到relay服务器，即VALIDATOR。
  - 描述需求、设定报酬（TALKEN）、指定所需技能标签
  - 报酬从 Publisher 钱包锁定到合约中
   
   说明：Relay 传输机制实现
   技术选型： WebSocket + JSON-RPC
   核心流程：
  - 1. 发现 — SDK 内置引导节点地址，连接后获取完整 Relay 列表，ping 测延迟选最近节点
  - 2. 连接 — WebSocket 长连接，Ed25519 签名认证
  - 3. 传输 — JSON-RPC 消息，Relay 中继转发
  - 4. 容错 — 自动重连、消息队列暂存、应用层 ACK 重传

  消息格式：
  {"method": "publish_task", "params": {...}, "id": 1}

  匹配逻辑跑在 Relay 服务器上，链上只做结算和存证。

  第 2 步：智能匹配
  - relay网络根据技能标签、信誉分、历史表现，自动匹配合格的 Executor

  第 3 步：接单执行
  - Executor 收到任务通知，选择接单
  - 在规定时间内完成任务，提交结果

  第 4 步：验证评分
  - relay网络随机分配 3+1名 Validator
  - Validator 使用 LLM 驱动的评分引擎评估结果质量，即在validator软件内配置大模型端点和api来连接llm。
  - 整理publisher和executor返回的结果评分
  - 给出分数（0-100），多人取平均值

  第 5 步：结算分配
  - 评分通过（≥60 分）：Executor 获得报酬，Validator 获得手续费
  - 评分不通过：报酬退回 Publisher，Executor 信誉分下降
  - 所有记录上链，不可篡改

  ---
  经济循环：

  Publisher 支付 TALKEN
      ↓
  合约锁定报酬
      ↓
  Executor 完成任务
      ↓
  Validator 评分验证
      ↓
  ┌─ 通过 → Executor 拿钱 + Validator 拿手续费
  └─ 不通过 → 退回 Publisher，Executor 扣信誉
   
   TALKEN 反作弊体系

  ---
  作弊途径与对策：

  1. Publisher + Executor 串通

  作弊方式： Publisher 发布任务，Executor 提交空结果或垃圾结果，骗取报酬后分赃

  对策：
  - Validator 独立评分，空结果直接 0 分 → 报酬退回
  - Publisher 重复发布低质量任务 → 信誉分下降，发布权受限
  - 同一地址频繁关联交易自动标记

  ---
  2. Executor + Validator 串通

  作弊方式： Executor 贿赂 Validator，让其给低质量结果打高分

  对策：
  - Validator 随机分配，Executor 无法提前知道谁来评
  - 多人独立评分（3-5 人），取中位数，单个 Validator 无法左右结果
  - 评分偏离平均值过大 → 自动标记为异常，审查后可能被 slash
  - Validator 质押 TALKEN 作为保证金，作弊被发现直接罚没

  ---
  3. 多身份 Sybil 攻击

  作弊方式： 一个人创建大量钱包，同时扮演 Publisher + Executor + Validator，自问自答自评

  对策：
  - Validator 质押门槛 — 每个身份都要质押 TALKEN，成本高
  - 质押金额与验证权重挂钩 — 质押越多权重越高，小额多号没意义
  - 地址关联分析 — 同一 IP、同一资金来源、同一设备的地址降低权重
  - 新地址信誉分从零开始，冷启动期任务量受限

  ---
  4. Validator 懒评/乱评

  作弊方式： Validator 不认真看结果，随机打分或全打满分，只为赚手续费

  对策：
  - 评分结果与其他 Validator 对比，持续偏离 → 信誉下降
  - 信誉低于阈值 → 剥夺 Validator 资格，质押被 slash
  - 随机抽查 — 网络对部分任务进行人工复核，校准评分标准
  - 评分必须附带理由（LLM 生成），无理由的评分无效

  ---
  5. Executor 拖延/交空作业

  作弊方式： 接单后不完成，或提交无关内容拖延时间

  对策：
  - 任务有截止时间，超时自动判定失败
  - 报酬退回 Publisher
  - Executor 信誉分下降，影响未来接单

  ---
  6. 结果抄袭/复制

  作弊方式： Executor 直接复制其他 Executor 的提交结果

  对策：
  - 提交结果带时间戳，先提交的优先
  - 内容相似度检测，抄袭结果直接判负
  - 抄袭者信誉分下降

  ---
  信誉系统总结：

  ┌──────────────────────┬────────────────┐
  │         行为         │    信誉变化    │
  ├──────────────────────┼────────────────┤
  │ 完成任务，评分通过   │ +1             │
  ├──────────────────────┼────────────────┤
  │ 完成任务，评分不通过 │ -2             │
  ├──────────────────────┼────────────────┤
  │ 验证评分与平均值一致 │ +1             │
  ├──────────────────────┼────────────────┤
  │ 验证评分持续偏离     │ -3             │
  ├──────────────────────┼────────────────┤
  │ 被 slash（作弊确认） │ -10 + 罚没质押 │
  └──────────────────────┴────────────────┘

  信誉分低 → 接单/验证优先级降低 → 严重者踢出网络


  本阶段首要任务：制作hermes-agent的插件和validator软件。