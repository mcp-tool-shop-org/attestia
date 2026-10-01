<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/Attestia/readme.png" alt="Attestia" width="400">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mcptoolshop/attestia"><img src="https://img.shields.io/npm/v/@mcptoolshop/attestia" alt="npm version"></a>
  <a href="https://github.com/mcp-tool-shop-org/attestia/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/attestia/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://opensource.org/license/mit/"><img src="https://img.shields.io/badge/License-MIT-yellow" alt="MIT License"></a>
</p>

<p align="center"><strong>あるイベント、トランザクション、または状態遷移が発生したことの証明であり、チェーンに紐付けられます。このライブラリ全体を1つのパッケージにまとめました。</strong></p>

このパッケージが提供するドメインは、金融の真実です。具体的には、個人のウォレット、組織の財務、およびレジストラムです。構造的なガバナンス、決定論的な会計、およびチェーン、組織、個人を横断した人間による承認された意図を実現します。Attestiaは、あなたの資金を移動させるものではありません。何が起こったかを証明し、何が起こり得るかを制限し、金融記録を改ざんできないものにします。

Cognateは、このパッケージ内のイベントストアとMerkle証明をAIガバナンスに使用します。RepoMeshは別のリリース台帳であり、このMerkleツリーは使用しません。

このパッケージは、完全なAttestiaライブラリを1つのインストール（ESM）にまとめます。内部の`@attestia/*`ワークスペースパッケージはインライン化されており、管理する必要があるパッケージの肥大化はありません。サードパーティのランタイム依存関係（xrpl、viem、@solana/web3.js、json-canonicalize、ripple-keypairs）は通常どおり解決されます。

## インストール

```bash
npm install @mcptoolshop/attestia
```

> **ESMのみ**（Node ≥ 22）。GitHub Actions OIDC Trusted Publishingを介して、[npm provenance](https://docs.npmjs.com/generating-provenance-statements)として公開されます。

## 使用方法

ドメインをルートから**名前空間**としてインポートします。

```ts
import { ledger, proof, registrum } from "@mcptoolshop/attestia";

const total = ledger.addMoney(
  { amount: "100.00", currency: "USD", decimals: 2 },
  { amount: "50.00", currency: "USD", decimals: 2 },
);

const tree = proof.MerkleTree.build([/* sha-256 leaf hashes */]);
```

…または、**サブパス**からフラットなシンボルをインポートします。

```ts
import { MerkleTree, verifyAttestationProof } from "@mcptoolshop/attestia/proof";
import { StructuralRegistrar } from "@mcptoolshop/attestia/registrum";
import { JsonlEventStore } from "@mcptoolshop/attestia/event-store";
import { AttestiaClient } from "@mcptoolshop/attestia/sdk";
```

## サブパス

| サブパス | 概要 |
|---------|-----------|
| `@mcptoolshop/attestia` | ルートバレル — すべてのドメインを名前空間として |
| `…/types` | 共有ドメイン型（Money、ID、ブランド化されたプリミティブ） |
| `…/ledger` | 追加専用の複式仕訳エンジン + 決定論的な金融計算 |
| `…/registrum` | 憲法上の登録者 — 11個の不変条件、デュアルウィットネス |
| `…/event-store` | 追加専用のイベント永続化 — JSONL、ハッシュチェーン |
| `…/proof` | Merkleツリー（RFC 6962）、包含 + 認証証明 |
| `…/vault` | 個人のウォレット — ポートフォリオ、予算、意図 |
| `…/treasury` | 組織の財務 — 給与、分配、資金調達ゲート |
| `…/reconciler` | クロスシステムのマッチング + レジストラム認証 |
| `…/chain-observer` | マルチチェーンの読み取り専用の監視（EVM、XRPL、Solana、L2） |
| `…/witness` | XRPLのオンチェーン認証、マルチシグガバナンス |
| `…/verify` | リプレイ検証、コンプライアンス証拠、SLA |
| `…/sdk` | Attestia REST API用の型付きHTTPクライアント |

## コアパターン

すべてのインタラクションは1つのフローに従い、どのステップもオプションではありません。

```
Intent → Approve → Execute → Verify
```

## ドキュメント

完全なハンドブック、アーキテクチャ、脅威モデル、および検証ガイド：**<https://mcp-tool-shop-org.github.io/attestia/>** · ソース：**<https://github.com/mcp-tool-shop-org/attestia>**

## ライセンス

[MIT](LICENSE) — [MCP Tool Shop](https://mcp-tool-shop.github.io/)によって作成されました。
