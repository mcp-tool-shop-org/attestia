<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.md">English</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/Attestia/readme.png" alt="Attestia" width="400">
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/Attestia/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/Attestia/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://codecov.io/gh/mcp-tool-shop-org/Attestia"><img src="https://codecov.io/gh/mcp-tool-shop-org/Attestia/graph/badge.svg" alt="codecov"></a>
  <a href="https://mcp-tool-shop-org.github.io/attestia/"><img src="https://img.shields.io/badge/Landing_Page-live-blue" alt="Landing Page"></a>
  <a href="https://opensource.org/license/mit/"><img src="https://img.shields.io/badge/License-MIT-yellow" alt="MIT License"></a>
</p>

<p align="center"><strong>证明某个事件、交易或状态转换已经发生，并将其与链绑定。</strong></p>

---

## 使命

我们认为，无论资金存在于何处，无论其如何流动，都应该像创造它的系统一样受到严格的监管。智能合约执行。区块链记录。但没有人进行“证明”。

Attestia 为资金提供了这一层：跨链、组织和个人，实现结构化治理、确定性会计和经过人工批准的意图。

我们不会转移您的资金。我们会证明发生了什么，限制可以发生什么，并使财务记录变得不可篡改。

### 我们的价值观

- **以真实性为先，速度为后。** 每一个财务事件都是只追加、可重放且可调和的。如果无法证明，那么它就没有发生。
- **人类批准；机器验证。** AI 提供建议，智能合约执行，但没有任何操作会在没有明确的人工授权的情况下发生。永远如此。
- **结构化治理，而非政治治理。** 我们不会对什么是有效的进行投票。我们会定义始终成立的不变性——身份是明确的，血统是完整的，顺序是确定的。
- **意图不是执行。** 声明你想要什么和执行它是两个独立的行动，具有独立的流程。两者之间的差距就是信任的所在。
- **链是见证者，而不是权威。** XRPL 进行证明。以太坊进行结算。但权威源于结构化规则，而不是任何链的共识。
- **简单的基础设施胜出。** 世界不需要另一个 DeFi 协议。它需要底层的会计层——使其他一切都值得信赖的金融基础设施。

## 在系统中的位置

Attestia、Cognate 和 RepoMesh 是三个产品。

**Attestia** 证明某个事件、交易或状态转换已经发生，并将该证明与链绑定。它所提供的领域是财务真实性：个人保险库、组织金库和注册表。它的证明基本要素是只追加事件存储和默克尔证明。

**Cognate** 是这些基本要素上的 AI 治理领域：模型血统、策略决策、代理能力以及提示和输出的完整性。它不保存第二个事件存储。

**RepoMesh** 是发布网络：签名事件、节点清单和与 XRPL 绑定的信任时钟。它维护自己的 RFC 6962 分散账本。它不使用 Attestia 的默克尔树。

当 Cognate 需要证明时，它会调用 Attestia；当它需要检查发布时，它会调用 RepoMesh。

---

## 架构

Attestia 是三个系统，一个真理：

```
┌─────────────────────────────────────────────────────────┐
│                      ATTESTIA                           │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   Personal   │  │     Org      │  │              │  │
│  │    Vault     │  │   Treasury   │  │   Registrum  │  │
│  │              │  │              │  │              │  │
│  │  Observe.    │  │  Distribute. │  │  Govern.     │  │
│  │  Budget.     │  │  Account.    │  │  Attest.     │  │
│  │  Allocate.   │  │  Reconcile.  │  │  Constrain.  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                 │                 │           │
│         └────────────┬────┘                 │           │
│                      │                      │           │
│              ┌───────┴───────┐              │           │
│              │  Cross-System │◀─────────────┘           │
│              │ Reconciliation│                           │
│              └───────┬───────┘                           │
│                      │                                   │
│              ┌───────┴───────┐                           │
│              │ XRPL Witness  │                           │
│              │  (attestation)│                           │
│              └───────────────┘                           │
└─────────────────────────────────────────────────────────┘
```

| 系统 | 角色 | 来源 |
|--------|------|--------|
| **Personal Vault** | 多链投资组合观察、预算分配、意图声明 | 由 NextLedger 演化而来 |
| **Org Treasury** | 确定性工资单、DAO 分配、双重闸道融资、复式记账 | 由工资引擎演化而来 |
| **Registrum** | 结构化注册表——11 个不变性、双重见证验证、XRPL 证明 | 未更改——宪法层 |

---

## 在 2 分钟内试用

了解 Attestia 的最快方法是观察一个支付流程如何完整地执行。交互式演示端到端运行**完整的“意图 → 批准 → 执行 → 验证 → 存证 → 证明”**流水线——每个阶段都针对实际的域包（匹配、哈希、XRPL 样式的证明、默克尔证明）进行实时计算，而不是模拟。

```bash
pnpm install   # Install all dependencies
pnpm build     # Build all packages
pnpm demo      # Walk the full pipeline (~10s, paced for readability)
```

您将看到单个工资支付如何逐步成为一个可以独立验证的密码学证明。添加 `--fast` 以跳过节奏并立即运行：`pnpm demo --fast`（`pnpm demo --help` 列出了所有标志）。

---

## 核心模式

每个交互都遵循一个流程：

```
Intent → Approve → Execute → Verify
```

1. **意图**——用户或系统声明期望的结果
2. **批准**——注册表进行结构化验证；人工明确签名
3. **执行**——提交链上交易
4. **验证**——对账确认；XRPL 证明记录

没有步骤是可选的。没有步骤会被自动省略。

---

## 原则

| 原则 | 实施 |
|-----------|---------------|
| 只追加记录 | 没有更新，没有删除——只有新的条目 |
| 失败时关闭 | 不同意会停止系统，绝不会默默地修复 |
| 确定性重放 | 相同的事件总是产生相同的结果 |
| 仅限咨询 AI | AI 可以分析、警告、建议——但绝不会批准、签名或执行 |
| 多链观察 | 以太坊、XRPL、Solana、L2s——链无关的读取层 |
| 结构化身份 | 明确、不可变、唯一——不是生物识别，而是宪法的 |

---

## 状态

版本 2.1.2。15 个工作区包，CI 中有 2,594 个测试，以及 3 个捆绑包烟雾测试，每个包的语句覆盖率达到 94.9–100%，所有测试都通过。公开构建。

| 包 | 测试 | 目的 |
|---------|-------|---------|
| `@attestia/types` | 75 | 共享域类型（零依赖） |
| `@attestia/registrum` | 368 | 宪法治理——11 个不变性、双重见证 |
| `@attestia/ledger` | 156 | 只追加复式记账引擎 |
| `@attestia/chain-observer` | 295 | 多链只读观察（EVM + XRPL + Solana + L2s） |
| `@attestia/vault` | 91 | 个人保险库——投资组合、预算、意图 |
| `@attestia/treasury` | 109 | 组织金库——工资、分配、融资闸道 |
| `@attestia/reconciler` | 98 | 3D 跨系统匹配 + 注册表证明 |
| `@attestia/witness` | 295 | XRPL 链上证明、多重签名治理、重试 |
| `@attestia/verify` | 273 | 重放验证、合规证据、SLA 强制执行 |
| `@attestia/event-store` | 263 | 只追加事件持久性、JSONL、哈希链、34 种事件类型 |
| `@attestia/proof` | 94 | 默克尔树（RFC 6962）、包含证明、证明包装 |
| `@attestia/sdk` | 115 | 面向外部用户的类型化 HTTP 客户端 SDK |
| `@attestia/node` | 362 | Hono REST API — 持久化存储、身份验证、多租户、密钥管理/保险库/治理，OpenAPI |
| `@mcptoolshop/attestia` | 3 | 发布的 npm 包：将上述所有库打包成一个，并使用子路径导出（烟雾测试，由 `pnpm test` 运行；CI 的覆盖测试不包括这些）。 |
| `@attestia/demo` | — | 交互式 CLI 演示 — 演示完整的 Attestia 流水线（私有，无测试）。 |

### 2.1 版本的新内容

- **2.1.2：事件日志的崩溃恢复。** 如果写入器在写入一行数据的过程中被终止，则 `JsonlEventStore` 在重新打开时会跳过未完成的最后一行，并且第一次追加写入时会写入一个换行符，以便新的事件从新的一行开始。未完成的片段会保留在文件中，并且每次加载时都会被跳过。那些 `append()` 返回成功的事件会保存在磁盘上。日志中间的损坏事件仍然会导致存储拒绝打开（`INTEGRITY_VIOLATION`，默认配置为 `verifyOnLoad: true`）。事件存储的 README 中说明了[恢复后会发生什么](packages/event-store/README.md)。
- **2.1.1：Zod 4。** 现在使用 Zod 4.6.7 进行验证。`details.issues[].message` 和 `ConfigError` 文本中内置验证消息的措辞已更改（例如，`"Required"` 现在是 `"Invalid input: expected <type>, received undefined"`）。错误代码、问题路径、HTTP 错误包和 Attestia 自身的改进消息均未更改，因此请匹配代码和路径，而不是消息文本。
- **2.1.0：服务的持久化事件日志。** `ATTESTIA_EVENTS_FILE` 将该文件作为配置的拥有者的事件日志打开。如果未设置，则服务将保留在内存中。格式错误的 `API_KEYS` 条目不再会将密钥放入启动错误中。

有关完整列表，请参阅 [CHANGELOG.md](CHANGELOG.md)。

### 开发

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm test             # Run all tests (2,597)
pnpm test:coverage    # Run with coverage reporting
pnpm typecheck        # Type-check all packages
pnpm bench            # Run benchmarks
```

### XRPL 集成测试

一个独立的 `rippled` 节点在 Docker 中运行，用于进行确定性的链上集成测试 — 无测试网络依赖，无水龙头，亚秒级账本关闭。

```bash
docker compose up -d              # Start standalone rippled
pnpm --filter @attestia/witness run test:integration  # Run on-chain round-trip tests
docker compose down               # Stop rippled
```

### 文档

| 文档 | 目的 |
|----------|---------|
| [HANDBOOK.md](HANDBOOK.md) | 高层概述和完整的包参考 |
| [ROADMAP.md](ROADMAP.md) | 分阶段的项目路线图 |
| [DESIGN.md](DESIGN.md) | 架构决策 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 包图、数据流、安全模型 |
| [REFERENCE_ARCHITECTURE.md](REFERENCE_ARCHITECTURE.md) | 5 层堆栈、部署模式、信任边界 |
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | 使用 curl 示例 + SDK 用法进行 API 集成 |
| [VERIFICATION_GUIDE.md](VERIFICATION_GUIDE.md) | 审计员逐步重放指南 |
| [THREAT_MODEL.md](THREAT_MODEL.md) | 每个组件的 STRIDE 分析 |
| [CONTROL_MATRIX.md](CONTROL_MATRIX.md) | 威胁 → 控制 → 文件 → 测试映射 |
| [SECURITY.md](SECURITY.md) | 负责任的披露政策 |
| [INSTITUTIONAL_READINESS.md](INSTITUTIONAL_READINESS.md) | 采用准备情况检查表 |
| [PERFORMANCE_BASELINE.md](PERFORMANCE_BASELINE.md) | 记录的基准测试 |

---

## 安全性和数据范围

- **访问的数据：** 读取和写入财务账本条目、证明记录和密码学证明。当设置时，该服务会将事件日志写入 `ATTESTIA_EVENTS_FILE` 命名的文件。当见证模块处于活动状态时，连接到区块链节点（XRPL）。
- **未访问的数据：** 无遥测数据。不存储用户凭据。无第三方分析。
- **磁盘上的完整性：** 事件日志仅追加且哈希链接。崩溃时未完成的最后一行将被跳过，并且日志将恢复；任何破坏链的损坏都将导致存储默认情况下拒绝打开。
- **所需的权限：** 对本地数据目录的读/写访问权限。仅用于区块链证明的网络访问权限。有关完整的 STRIDE 分析，请参阅 [THREAT_MODEL.md](THREAT_MODEL.md)。

## 评分卡

| 关卡 | 状态 |
|------|--------|
| A. 安全基线 | 通过 |
| B. 错误处理 | 通过 |
| C. 运维文档 | 通过 |
| D. 发布卫生 | 通过 |
| E. 身份 | 通过 |

## 许可证

[MIT](LICENSE)

---

由 <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a> 构建
