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

<p align="center"><strong>证明某个事件、交易或状态转换已经发生，并将其绑定到一条链上。</strong></p>

---

## 使命

我们认为，无论资金存在于何处，无论其如何流动，都应该像创造它的系统一样受到严格的监管。智能合约执行。区块链记录。但没有人进行“证明”。

Attestia 为资金提供这一层保障：跨链、组织和个人，实现结构化治理、确定性会计和经过人工批准的意图。

我们不会转移您的资金。我们会证明发生了什么，限制可以发生什么，并使财务记录变得不可篡改。

### 我们的价值观

- **以真实性为先，速度为后。** 每一个财务事件都是只追加、可重放且可调和的。如果无法证明，则它没有发生。
- **人类批准；机器验证。** AI 提供建议，智能合约执行，但没有任何操作会在没有明确的人工授权的情况下发生。永远如此。
- **结构化治理，而非政治治理。** 我们不会对什么是有效的进行投票。我们会定义始终成立的不变性——身份是明确的，血统是完整的，顺序是确定的。
- **意图与执行是不同的。** 声明您想要什么和执行它是两个独立的行动，具有独立的流程。两者之间的差距是信任的所在。
- **链是见证者，而不是权威。** XRPL 进行证明。以太坊进行结算。但权威源于结构化规则，而不是来自任何链的共识。
- **简单的基础设施胜出。** 世界不需要另一个 DeFi 协议。它需要底层的会计层——使其他一切都值得信赖的金融基础设施。

## 在系统中的位置

Attestia、Cognate 和 RepoMesh 是三个产品。

**Attestia** 证明某个事件、交易或状态转换已经发生，并将该证明绑定到一条链上。它所提供的领域是财务真实性：个人保险库、组织金库和登记簿。它的证明基本要素是只追加事件存储和默克尔证明。

**Cognate** 是这些基本要素上的 AI 治理领域：模型血统、策略决策、代理能力以及提示和输出的完整性。它不保存第二个事件存储。

**RepoMesh** 是发布网络：签名事件、节点清单和基于 XRPL 的信任时钟。它维护自己的 RFC 6962 分散账本。它不使用 Attestia 的默克尔树。

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
| **Registrum** | 结构化登记簿——11 个不变性、双重见证验证、XRPL 证明 | 未改变——宪法层 |

---

## 两分钟内试用

了解 Attestia 的最快方法是观察一个支付流程如何完整地执行。交互式演示运行完整的 **意图 → 批准 → 执行 → 验证 → 证明 → 证据** 流水线——每个阶段都针对实际的域包（匹配、哈希、XRPL 风格的证明、默克尔证明）进行实时计算，而不是模拟。

```bash
pnpm install   # Install all dependencies
pnpm build     # Build all packages
pnpm demo      # Walk the full pipeline (~10s, paced for readability)
```

您将看到一个单独的工资支付如何逐步成为一个可以独立验证的密码学证明。添加 `--fast` 以跳过节奏并立即运行：`pnpm demo --fast`（`pnpm demo --help` 列出了所有标志）。

---

## 核心模式

每个交互都遵循一个流程：

```
Intent → Approve → Execute → Verify
```

1. **意图**——用户或系统声明期望的结果
2. **批准**——登记簿进行结构化验证；人工明确签名
3. **执行**——提交链上交易
4. **验证**——对账确认；XRPL 证明记录

没有一个步骤是可选的。没有一个步骤会被自动移除。

---

## 原则

| 原则 | 实现 |
|-----------|---------------|
| 只追加记录 | 没有 UPDATE，没有 DELETE——只有新的条目 |
| 失败时关闭 | 不同意会停止系统，绝不会默默地修复 |
| 确定性重放 | 相同的事件总是产生相同的结果 |
| 仅限咨询 AI | AI 可以分析、警告、建议——但绝不能批准、签名或执行 |
| 多链观察 | 以太坊、XRPL、Solana、L2——链无关的读取层 |
| 结构化身份 | 明确、不可变、唯一——不是生物识别，而是宪法的 |

---

## 状态

14 个包、2564 个测试、95% 以上的代码覆盖率，所有测试都通过。公开构建。

| 包 | 测试 | 目的 |
|---------|-------|---------|
| `@attestia/types` | 75 | 共享域类型（零依赖） |
| `@attestia/registrum` | 368 | 宪法治理——11 个不变性、双重见证 |
| `@attestia/ledger` | 156 | 只追加复式记账引擎 |
| `@attestia/chain-observer` | 295 | 多链只读观察（EVM + XRPL + Solana + L2） |
| `@attestia/vault` | 91 | 个人保险库——投资组合、预算、意图 |
| `@attestia/treasury` | 109 | 组织金库——工资单、分配、融资闸道 |
| `@attestia/reconciler` | 98 | 3D 跨系统匹配 + 登记簿证明 |
| `@attestia/witness` | 295 | XRPL 链上证明、多重签名治理、重试 |
| `@attestia/verify` | 273 | 重放验证、合规证据、SLA 强制执行 |
| `@attestia/event-store` | 253 | 只追加事件持久化、JSONL、哈希链、34 种事件类型 |
| `@attestia/proof` | 94 | 默克尔树（RFC 6962）、包含证明、证明包装 |
| `@attestia/sdk` | 115 | 面向外部用户的类型化 HTTP 客户端 SDK |
| `@attestia/node` | 342 | Hono REST API — 持久性存储、身份验证、多租户、资金管理/保险库/治理、OpenAPI |
| `@attestia/demo` | — | 交互式 CLI 演示 — 演示完整的 Attestia 流水线（私有，无测试） |

### 开发

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm test             # Run all tests (2,564)
pnpm test:coverage    # Run with coverage reporting
pnpm typecheck        # Type-check all packages
pnpm bench            # Run benchmarks
```

### XRPL 集成测试

一个独立的 `rippled` 节点在 Docker 中运行，用于进行确定性的链上集成测试 — 无测试网络依赖，无需水龙头，账本关闭时间小于一秒。

```bash
docker compose up -d              # Start standalone rippled
pnpm --filter @attestia/witness run test:integration  # Run on-chain round-trip tests
docker compose down               # Stop rippled
```

### 文档

| 文档 | 目的 |
|----------|---------|
| [HANDBOOK.md](HANDBOOK.md) | 高层概述和完整软件包参考 |
| [ROADMAP.md](ROADMAP.md) | 分阶段项目路线图 |
| [DESIGN.md](DESIGN.md) | 架构决策 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 软件包图、数据流、安全模型 |
| [REFERENCE_ARCHITECTURE.md](REFERENCE_ARCHITECTURE.md) | 五层堆栈、部署模式、信任边界 |
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | 带有 curl 示例 + SDK 用法的 API 集成 |
| [VERIFICATION_GUIDE.md](VERIFICATION_GUIDE.md) | 审计员逐步重现指南 |
| [THREAT_MODEL.md](THREAT_MODEL.md) | 每个组件的 STRIDE 分析 |
| [CONTROL_MATRIX.md](CONTROL_MATRIX.md) | 威胁 → 控制 → 文件 → 测试映射 |
| [SECURITY.md](SECURITY.md) | 负责任的披露政策 |
| [INSTITUTIONAL_READINESS.md](INSTITUTIONAL_READINESS.md) | 采用准备情况清单 |
| [PERFORMANCE_BASELINE.md](PERFORMANCE_BASELINE.md) | 记录的基准测试 |

---

## 安全与数据范围

- **访问的数据：** 读取和写入财务账本条目、证明记录和密码学证明。当见证模块处于活动状态时，连接到区块链节点（XRPL）。
- **未访问的数据：** 无遥测数据。不存储用户凭据。不使用第三方分析。
- **所需权限：** 对本地数据目录的读/写访问权限。仅用于区块链证明的网络访问权限。有关完整的 STRIDE 分析，请参阅 [THREAT_MODEL.md](THREAT_MODEL.md)。

## 评分卡

| 关卡 | 状态 |
|------|--------|
| A. 安全基线 | 通过 |
| B. 错误处理 | 通过 |
| C. 操作文档 | 通过 |
| D. 发布规范 | 通过 |
| E. 身份 | 通过 |

## 许可证

[MIT](LICENSE)

---

由 <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a> 构建
