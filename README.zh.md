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

<p align="center"><strong>去中心化世界的金融基础设施。</strong></p>

---

## 使命

我们相信，无论资金存在于何处，流动方式如何，它都应该像创建它的系统一样，具有同样的严谨性。智能合约执行，区块链记录，但缺少一个环节：*确认*。

Attestia 弥补了这个缺失：它提供结构化的治理、确定的记账以及经过人工批准的意图，并在链、组织和个人之间实现统一。

我们不移动您的资金。我们证明发生了什么，限制可能发生的事情，并确保金融记录不可篡改。

### 我们的价值观

- **真实性胜过速度。** 每一个金融事件都是只追加、可重放和可调和的。如果无法证明，则未发生。
- **人类批准；机器验证。** 人工智能提供建议，智能合约执行，但没有任何操作可以在没有明确的人工授权的情况下进行。永远。
- **结构化治理，而非政治治理。** 我们不投票决定哪些内容是有效的。我们定义了无条件成立的不变量——身份是明确的，血缘是完整的，顺序是确定的。
- **意图不是执行。** 声明您想要什么和执行它，是两个不同的行为，并且有不同的环节。信任存在于这两者之间的差距中。
- **链是见证者，而非权威。** XRPL 确认，以太坊结算。但权威来自于结构化的规则，而不是任何链的共识。
- **可靠的基础设施是关键。** 世界不需要另一个 DeFi 协议。它需要一个底层的记账层——一个使所有其他事物都值得信赖的金融基础设施。

---

## 架构

Attestia 由三个系统组成，但只有一个真理：

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

| 系统 | 角色 | 起源 |
|--------|------|--------|
| **Personal Vault** | 多链投资组合观察、预算分配、意图声明 | 源自 NextLedger |
| **Org Treasury** | 确定性工资、DAO 分配、双重授权资金、复式记账 | 源自 Payroll Engine |
| **Registrum** | 结构化注册器——11 个不变量、双重见证验证、XRPL 确认 | 未改变——宪法层 |

---

## 在 2 分钟内体验一下

了解 Attestia 最快的方法是观看一个支付流程的整个过程。交互式演示运行完整的 **意图 → 批准 → 执行 → 验证 → 确认 → 证明** 流程，对实际的域包进行实时计算（匹配、哈希、XRPL 风格的确认、Merkle 证明），而不是模拟。

```bash
pnpm install   # Install all dependencies
pnpm build     # Build all packages
pnpm demo      # Walk the full pipeline (~10s, paced for readability)
```

您将看到一个工资支付变成一个可以独立验证的密码学证明，一步一步。要跳过配速并立即运行，请添加 `--fast`：`pnpm demo --fast` (`pnpm demo --help` 列出了所有标志)。

---

## 核心模式

每一次交互都遵循以下流程：

```
Intent → Approve → Execute → Verify
```

1. **意图**——用户或系统声明期望的结果
2. **批准**——注册器进行结构化验证；人类进行明确签名
3. **执行**——提交链上交易
4. **验证**——对账确认；XRPL 确认记录

任何步骤都不是可选的。任何步骤都不是自动化的。

---

## 原则

| 原则 | 实现 |
|-----------|---------------|
| 只追加的记录 | 没有更新，没有删除——只有新的条目 |
| 失效优先 | 出现分歧时，系统会停止，而不是静默恢复 |
| 确定性重放 | 相同的事件始终产生相同的状态 |
| 仅提供咨询人工智能 | 人工智能可以分析、警告、建议，但不能批准、签名或执行 |
| 多链观察 | 以太坊、XRPL、Solana、L2——链无关的读取层 |
| 结构化身份 | 明确的、不可变的、唯一的——不是生物识别的，而是基于宪法的。 |

---

## 状态

14个软件包，2220个测试用例，覆盖率96.80%，所有测试均通过。正在公开构建。

| 软件包 | 测试用例 | 目的 |
|---------|-------|---------|
| `@attestia/types` | 72 | 共享领域类型（无依赖） |
| `@attestia/registrum` | 341 | 基于宪法的治理——11个不变规则，双重验证 |
| `@attestia/ledger` | 154 | 仅追加的、双重记账引擎 |
| `@attestia/chain-observer` | 278 | 多链只读观察（EVM + XRPL + Solana + L2） |
| `@attestia/vault` | 75 | 个人保险箱——投资组合、预算、意图 |
| `@attestia/treasury` | 92 | 组织资金——工资、分配、资金审批 |
| `@attestia/reconciler` | 81 | 3D跨系统匹配 + Registrum 认证 |
| `@attestia/witness` | 278 | XRPL链上认证，多重签名治理，重试机制 |
| `@attestia/verify` | 242 | 回放验证，合规性证据，SLA执行 |
| `@attestia/event-store` | 226 | 仅追加的事件持久化，JSONL格式，哈希链，34种事件类型 |
| `@attestia/proof` | 75 | 默克尔树，包含证明，认证证明打包 |
| `@attestia/sdk` | 79 | 用于外部消费者的类型化HTTP客户端SDK |
| `@attestia/node` | 227 | Hono REST API——34个端点，身份验证，多租户，公共API，合规性 |
| `@attestia/demo` | — | 交互式CLI演示——逐步了解Attestia的整个流程（私有，不包含测试） |

### 开发

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm test             # Run all tests (2,220)
pnpm test:coverage    # Run with coverage reporting
pnpm typecheck        # Type-check all packages
pnpm bench            # Run benchmarks
```

### XRPL集成测试

一个独立的`rippled`节点在Docker中运行，用于确定性的链上集成测试——无需测试网络，无需测试币，账本关闭时间小于一秒。

```bash
docker compose up -d              # Start standalone rippled
pnpm --filter @attestia/witness run test:integration  # Run on-chain round-trip tests
docker compose down               # Stop rippled
```

### 文档

| 文档 | 目的 |
|----------|---------|
| [HANDBOOK.md](HANDBOOK.md) | 执行摘要和完整软件包参考 |
| [ROADMAP.md](ROADMAP.md) | 分阶段的项目路线图 |
| [DESIGN.md](DESIGN.md) | 架构决策 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 软件包图，数据流，安全模型 |
| [REFERENCE_ARCHITECTURE.md](REFERENCE_ARCHITECTURE.md) | 五层架构，部署模式，信任边界 |
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | API集成示例（curl）+ SDK使用指南 |
| [VERIFICATION_GUIDE.md](VERIFICATION_GUIDE.md) | 审计员的逐步回放指南 |
| [THREAT_MODEL.md](THREAT_MODEL.md) | 每个组件的STRIDE分析 |
| [CONTROL_MATRIX.md](CONTROL_MATRIX.md) | 威胁→控制→文件→测试映射 |
| [SECURITY.md](SECURITY.md) | 负责任的披露政策 |
| [INSTITUTIONAL_READINESS.md](INSTITUTIONAL_READINESS.md) | 采用准备清单 |
| [PERFORMANCE_BASELINE.md](PERFORMANCE_BASELINE.md) | 已记录的基准测试 |

---

## 安全与数据范围

- **访问的数据：** 读取和写入金融账本条目、认证记录和密码学证明。当验证模块处于活动状态时，连接到区块链节点（XRPL）。
- **未访问的数据：** 无遥测数据。无用户凭证存储。无第三方分析。
- **所需权限：** 访问本地数据目录的读/写权限。仅用于区块链认证的网络访问。请参阅[THREAT_MODEL.md](THREAT_MODEL.md)以获取完整的STRIDE分析。

## 评分卡

| 门禁 | 状态 |
|------|--------|
| A. 安全基线 | 通过 |
| B. 错误处理 | 通过 |
| C. 运维文档 | 通过 |
| D. 发布质量 | 通过 |
| E. 身份验证 | 通过 |

## 许可证

[MIT](LICENSE)

---

由<a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>构建。
