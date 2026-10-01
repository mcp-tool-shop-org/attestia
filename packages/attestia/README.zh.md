<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.md">English</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/Attestia/readme.png" alt="Attestia" width="400">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mcptoolshop/attestia"><img src="https://img.shields.io/npm/v/@mcptoolshop/attestia" alt="npm version"></a>
  <a href="https://github.com/mcp-tool-shop-org/attestia/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/attestia/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://opensource.org/license/mit/"><img src="https://img.shields.io/badge/License-MIT-yellow" alt="MIT License"></a>
</p>

<p align="center"><strong>证明某个事件、交易或状态转换已经发生，并将其绑定到链上。整个库都包含在一个包中。</strong></p>

此软件包的应用领域是金融真理：个人账户、组织财务和登记簿。结构化治理、确定性会计以及跨链、组织和个人之间的经过人工审核的意图。Attestia 不会转移您的资金。它证明了发生了什么，限制了可以发生什么，并使金融记录变得不可篡改。

Cognate 使用此软件包中的事件存储和默克尔证明来进行 AI 治理。RepoMesh 是一个独立的发布账本，不使用此默克尔树。

此软件包将完整的 Attestia 库表面捆绑到一个安装包中（ESM）。内部 `@attestia/*` 工作区软件包已内联——无需管理软件包的扩散；第三方运行时依赖项（xrpl、viem、@solana/web3.js、json-canonicalize、ripple-keypairs）正常解析。

## 安装

```bash
npm install @mcptoolshop/attestia
```

> **仅限 ESM**（Node ≥ 22）。通过 GitHub Actions OIDC 可信发布，使用 [npm provenance](https://docs.npmjs.com/generating-provenance-statements) 发布。

## 用法

从根目录导入一个域作为**命名空间**：

```ts
import { ledger, proof, registrum } from "@mcptoolshop/attestia";

const total = ledger.addMoney(
  { amount: "100.00", currency: "USD", decimals: 2 },
  { amount: "50.00", currency: "USD", decimals: 2 },
);

const tree = proof.MerkleTree.build([/* sha-256 leaf hashes */]);
```

…或者从**子路径**导入扁平符号：

```ts
import { MerkleTree, verifyAttestationProof } from "@mcptoolshop/attestia/proof";
import { StructuralRegistrar } from "@mcptoolshop/attestia/registrum";
import { JsonlEventStore } from "@mcptoolshop/attestia/event-store";
import { AttestiaClient } from "@mcptoolshop/attestia/sdk";
```

## 子路径

| 子路径 | 它是什么 |
|---------|-----------|
| `@mcptoolshop/attestia` | 根目录——每个域都是一个命名空间 |
| `…/types` | 共享域类型（货币、ID、标记的基本类型） |
| `…/ledger` | 仅追加的复式记账引擎 + 确定性货币计算 |
| `…/registrum` | 宪法登记员——11 条不变性规则，双重见证 |
| `…/event-store` | 仅追加的事件持久性——JSONL，哈希链 |
| `…/proof` | 默克尔树（RFC 6962），包含 + 证明 |
| `…/vault` | 个人账户——投资组合、预算、意图 |
| `…/treasury` | 组织财务——工资、分配、资金闸 |
| `…/reconciler` | 跨系统匹配 + 登记簿证明 |
| `…/chain-observer` | 多链只读观察（EVM、XRPL、Solana、L2） |
| `…/witness` | XRPL 链上证明，多重签名治理 |
| `…/verify` | 重放验证、合规证据、SLA |
| `…/sdk` | 用于 Attestia REST API 的类型化 HTTP 客户端 |

## 核心模式

每个交互都遵循一个流程，并且没有可选步骤：

```
Intent → Approve → Execute → Verify
```

## 文档

完整手册、架构、威胁模型和验证指南：**<https://mcp-tool-shop-org.github.io/attestia/>** · 源代码：**<https://github.com/mcp-tool-shop-org/attestia>**

## 许可证

[MIT](LICENSE) — 由 [MCP Tool Shop](https://mcp-tool-shop.github.io/) 构建。
