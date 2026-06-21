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

<p align="center"><strong>分散型世界の金融に関する信頼性の高い基盤—包括的なAttestiaライブラリを1つのパッケージにまとめました。</strong></p>

構造的なガバナンス、決定論的会計、そして人間による承認を得た意図——これらをチェーン、組織、個人間で統一的に運用します。Attestiaはあなたの資金を移動させるのではなく、何が起こったかを証明し、何が起こり得るかを制限し、財務記録を改ざん不可能なものにします。

このパッケージは、Attestiaライブラリのすべての機能を1つのインストールファイル（ESM）にまとめて提供します。内部の`@attestia/*`ワークスペースパッケージはインライン化されているため、管理する必要のあるパッケージが分散することはありません。また、サードパーティのランタイム依存関係（xrpl、viem、@solana/web3.js、json-canonicalize、ripple-keypairs）も通常どおり解決されます。

## インストールする

```bash
npm install @mcptoolshop/attestia
```

> **ESMのみ対応**（Nodeバージョン22以上）。GitHub ActionsのOIDCを利用した信頼できる公開方式で、[npm provenance](https://docs.npmjs.com/generating-provenance-statements)とともに公開されます。

## 使用方法

ルートからドメインをインポートし、それを**ネームスペース**として使用します。

```ts
import { ledger, proof, registrum } from "@mcptoolshop/attestia";

const total = ledger.addMoney(
  { amount: "100.00", currency: "USD", decimals: 2 },
  { amount: "50.00", currency: "USD", decimals: 2 },
);

const tree = proof.MerkleTree.build([/* sha-256 leaf hashes */]);
```

または、**サブパス**からフラットなシンボルをインポートします。

```ts
import { MerkleTree, verifyAttestationProof } from "@mcptoolshop/attestia/proof";
import { StructuralRegistrar } from "@mcptoolshop/attestia/registrum";
import { JsonlEventStore } from "@mcptoolshop/attestia/event-store";
import { AttestiaClient } from "@mcptoolshop/attestia/sdk";
```

## サブパス

| サブパス | それは何ですか。 |
|---------|-----------|
| `@mcptoolshop/attestia` | ルートディレクトリ——すべてのドメインを名前空間として扱う。 |
| `…/types` | 共有ドメインの種類（通貨、ID、ブランド化された基本的なデータ型） |
| `…/ledger` | 追記専用の二重帳簿システムと、決定的な金融計算手法 |
| `…/registrum` | 憲法上の登録官——11個の不変要素、二重検証 |
| `…/event-store` | 追記のみを許可するイベント永続化方式——JSONL、ハッシュチェーン。 |
| `…/proof` | マークルツリー（RFC 6962）、包含証明と検証証明。 |
| `…/vault` | 個人用保管庫——ポートフォリオ、予算、計画など。 |
| `…/treasury` | 組織の財務部門：給与、配当金の支払い、資金調達プロセス |
| `…/reconciler` | クロスシステム照合＋レジストラムによる認証 |
| `…/chain-observer` | 複数のチェーンにおける読み取り専用の監視機能（EVM、XRPL、Solana、L2） |
| `…/witness` | XRPLのオンチェーン認証、マルチシグによるガバナンス。 |
| `…/verify` | リプレイ検証、コンプライアンス証拠、SLA（サービス品質保証） |
| `…/sdk` | Attestia REST API用の型付きHTTPクライアント |

## 基本的なパターン、主要なパターン

すべての操作は、定められた手順に従って行われ、どのステップも省略することはできません。

```
Intent → Approve → Execute → Verify
```

## ドキュメント、文書

完全なハンドブック、アーキテクチャ、脅威モデル、および検証ガイド：**<https://mcp-tool-shop-org.github.io/attestia/>**。ソースコード：**<https://github.com/mcp-tool-shop-org/attestia>**

## ライセンス

[MITライセンス] – [MCPツールショップ](https://mcp-tool-shop.github.io/)によって作成されました。
