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

<p align="center"><strong>为去中心化世界构建可靠的金融基础设施。</strong></p>

---

## 使命

我们相信，无论资金存在于何处、如何流动，都应该像创造它的系统一样受到严格的审查。智能合约执行。区块链记录。但没有人进行“证明”。

Attestia 是缺失的一层：结构化治理、确定性会计和经过人工批准的意图——统一于各个链、组织和个人。

我们不会转移您的资金。我们会证明发生了什么，限制可能发生的事情，并使金融记录变得不可篡改。

### 我们的价值观

- **以真实性为先于速度。** 每一个金融事件都是只追加、可重放和可调和的。如果无法证明，那么它就没有发生过。
- **人类批准；机器验证。** AI 提供建议，智能合约执行，但没有任何操作会在没有明确的人工授权的情况下进行。永远如此。
- **结构化治理，而非政治治理。** 我们不会对什么是有效的内容进行投票。我们定义了始终成立的不变性——身份是明确的，血统是完整的，顺序是确定的。
- **意图不是执行。** 声明你想要什么和实际去做是两个独立的行动，具有不同的流程。两者之间的差距就是信任之所在。
- **链是见证者，而不是权威。** XRPL 进行证明。以太坊进行结算。但权威源于结构化规则，而非任何链的共识。
- **简单的基础设施胜出。** 世界不需要另一个 DeFi 协议。它需要底层的会计层——使其他一切都值得信赖的金融基础架构。

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
| **Personal Vault** | 多链投资组合观察、预算分配、意图声明 | 源自 NextLedger |
| **Org Treasury** | 确定性工资单、DAO 分配、双重验证的资金，复式记账 | 源自 Payroll Engine |
| **Registrum** | 结构化注册表——11 个不变性、双重见证验证、XRPL 证明 | 未变——宪法层 |

---

## 在 2 分钟内试用

了解 Attestia 的最快方法是观察一个支付流程如何完整地进行。交互式演示运行完整的“意图 → 批准 → 执行 → 验证 → 证明 → 证据”流水线——每个阶段都针对实际的域包（匹配、哈希、XRPL 式证明、默克尔树证明）进行实时计算，而不是模拟。

```bash
pnpm install   # Install all dependencies
pnpm build     # Build all packages
pnpm demo      # Walk the full pipeline (~10s, paced for readability)
```

您将看到一个单独的工资支付如何逐步成为一个可以独立验证的密码学证明。添加 `--fast` 以跳过延迟并立即运行：`pnpm demo --fast`（`pnpm demo --help` 列出了所有标志）。

---

## 核心模式

每个交互都遵循一个流程：

```
Intent → Approve → Execute → Verify
```

1. **意图**——用户或系统声明期望的结果。
2. **批准**——Registrum 从结构上进行验证；人工明确签名。
3. **执行**——提交链上的交易。
4. **验证**——调和确认；XRPL 证明记录。

没有一个步骤是可选的。没有一个步骤会被自动省略。

---

## 原则

| 原则 | 实施 |
|-----------|---------------|
| 仅追加记录 | 没有 UPDATE，也没有 DELETE——只有新的条目 |
| 失败时关闭 | 不同意会停止系统，绝不会默默地修复 |
| 确定性重放 | 相同的事件总是产生相同的结果 |
| 仅提供建议的 AI | AI 可以分析、警告、提出建议——但绝不会批准、签名或执行 |
| 多链观察 | 以太坊、XRPL、Solana、L2——与链无关的读取层 |
| 结构化身份 | 明确、不可变、唯一——不是生物识别，而是宪法的 |

---

## 状态

14 个包，2564 个测试，95% 以上的代码覆盖率，所有测试都通过。公开进行构建。

| 包 | 测试 | 目的 |
|---------|-------|---------|
| `@attestia/types` | 75 | 共享域类型（零依赖） |
| `@attestia/registrum` | 368 | 宪法治理——11 个不变性、双重见证 |
| `@attestia/ledger` | 156 | 仅追加的复式记账引擎 |
| `@attestia/chain-observer` | 295 | 多链只读观察（EVM + XRPL + Solana + L2） |
| `@attestia/vault` | 91 | 个人保险库——投资组合、预算、意图 |
| `@attestia/treasury` | 109 | 组织金库——工资单、分配、资金验证 |
| `@attestia/reconciler` | 98 | 3D 跨系统匹配 + Registrum 证明 |
| `@attestia/witness` | 295 | XRPL 链上证明、多重签名治理、重试 |
| `@attestia/verify` | 273 | 重放验证、合规证据、SLA 强制执行 |
| `@attestia/event-store` | 253 | 仅追加的事件持久化、JSONL、哈希链、34 种事件类型 |
| `@attestia/proof` | 94 | 默克尔树（RFC 6962）、包含证明、证明包装 |
| `@attestia/sdk` | 115 | 用于外部消费者的定型 HTTP 客户端 SDK |
| `@attestia/node` | 342 | Hono REST API——持久存储、身份验证、多租户、金库/保险库/治理、OpenAPI |
| `@attestia/demo` | — | 交互式 CLI 演示——逐步了解完整的 Attestia 流水线（私有，无测试） |

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

一个独立的 `rippled` 节点在 Docker 中运行，用于进行确定性的链上集成测试——没有测试网络依赖，也没有水龙头，账本关闭时间小于一秒。

```bash
docker compose up -d              # Start standalone rippled
pnpm --filter @attestia/witness run test:integration  # Run on-chain round-trip tests
docker compose down               # Stop rippled
```

### 文档

| 文档 | 目的 |
|----------|---------|
| [HANDBOOK.md](HANDBOOK.md) | 执行摘要和完整的包参考 |
| [ROADMAP.md](ROADMAP.md) | 分阶段的项目路线图 |
| [DESIGN.md](DESIGN.md) | 架构决策 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 包图、数据流、安全模型 |
| [REFERENCE_ARCHITECTURE.md](REFERENCE_ARCHITECTURE.md) | 5 层堆栈、部署模式、信任边界 |
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | 使用 curl 示例 + SDK 用法的 API 集成 |
| [VERIFICATION_GUIDE.md](VERIFICATION_GUIDE.md) | 审计师逐步操作指南 |
| [THREAT_MODEL.md](THREAT_MODEL.md) | 按组件进行的 STRIDE 分析 |
| [CONTROL_MATRIX.md](CONTROL_MATRIX.md) | 威胁 → 控制 → 文件 → 测试映射 |
| [SECURITY.md](SECURITY.md) | 负责任的披露政策 |
| [INSTITUTIONAL_READINESS.md](INSTITUTIONAL_READINESS.md) | 采用准备情况检查表 |
| [PERFORMANCE_BASELINE.md](PERFORMANCE_BASELINE.md) | 记录的基准测试 |

---

## 安全与数据范围

- **访问的数据：** 读取和写入财务账本条目、证明记录和密码学证据。当见证模块处于活动状态时，连接到区块链节点（XRPL）。
- **未访问的数据：** 无遥测数据。不存储用户凭据。不进行第三方分析。
- **所需权限：** 对本地数据目录的读/写访问权限。仅用于区块链证明的网络访问权限。有关完整的 STRIDE 分析，请参阅 [THREAT_MODEL.md](THREAT_MODEL.md)。

## 评分表

| 关卡 | 状态 |
|------|--------|
| A. 安全基线 | 通过 |
| B. 错误处理 | 通过 |
| C. 操作手册 | 通过 |
| D. 发布规范 | 通过 |
| E. 身份验证 | 通过 |

## 许可证

[MIT](LICENSE)

---

由 <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a> 构建
