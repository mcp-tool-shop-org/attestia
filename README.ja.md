<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
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

<p align="center"><strong>分散型世界の金融真実インフラストラクチャ。</strong></p>

---

## ミッション

私たちは、お金がどこに存在し、どのように動くかに関わらず、その創造システムと同様の厳格さを持つべきだと考えています。スマートコントラクトは実行されます。ブロックチェーンは記録します。しかし、誰も「証明」しません。

Attestia は、欠けていたレイヤーです。構造的なガバナンス、決定論的な会計処理、そして人間による承認された意図を、複数のチェーン、組織、個人にわたって統合します。

私たちはあなたのお金を動かすわけではありません。何が起こったかを証明し、何が起こり得るかを制限し、金融記録を改ざん不可能にします。

### 私たちが重視すること

- **速度よりも真実**。すべての金融イベントは、追記専用で、再現可能であり、照合可能です。証明できない場合、それは起こらなかったことになります。
- **人間が承認し、機械が検証する**。AI は助言し、スマートコントラクトは実行されますが、明示的な人間の許可なしには何も動きません。常に。
- **政治的なガバナンスではなく、構造的なガバナンス**。何が有効であるかを投票で決めることはしません。無条件に成立する不変性を定義します。アイデンティティは明確であり、系統は途切れず、順序は決定論的です。
- **意図と実行は別物**。あなたが望むことを宣言し、それを実行することは、それぞれ異なるゲートを持つ別の行為です。その間のギャップこそが信頼の源泉です。
- **チェーンは証人であり、権威ではありません**。XRPL は証明します。Ethereum は決済します。しかし、権限は構造的なルールから生じ、特定のチェーンのコンセンサスからは生じません。
- **退屈なインフラストラクチャが勝利する**。世界には、もう 1 つの DeFi プロトコルは必要ありません。必要なのは、その基盤となる会計レイヤーです。つまり、他のすべての信頼性を支える金融インフラです。

---

## アーキテクチャ

Attestia は、3つのシステムと 1 つの真実で構成されます。

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

| システム | 役割 | 起源 |
|--------|------|--------|
| **Personal Vault** | マルチチェーンポートフォリオの監視、エンベロープ予算、意図の宣言 | NextLedger から進化 |
| **Org Treasury** | 決定論的な給与計算、DAO による分配、デュアルゲートによる資金調達、複式簿記 | Payroll Engine から進化 |
| **Registrum** | 構造的な登録者 — 11 の不変性、デュアルウィットネス検証、XRPL 証明 | 変更なし — 憲法上のレイヤー |

---

## 2 分で試してみる

Attestia を理解するための最も簡単な方法は、1 つの支払いが最初から最後までどのように流れるかを観察することです。インタラクティブなデモでは、**完全な意図 → 承認 → 実行 → 検証 → 証明 → 証拠** パイプラインを最初から最後まで実行します。各段階は、実際のドメインパッケージ（照合、ハッシュ化、XRPL スタイルの証明、Merkle 証明）に対してリアルタイムで計算されます。これはモックではありません。

```bash
pnpm install   # Install all dependencies
pnpm build     # Build all packages
pnpm demo      # Walk the full pipeline (~10s, paced for readability)
```

単一の給与支払いが、ステップごとに独立して検証可能な暗号学的証拠になる様子を確認できます。`--fast` を追加すると、ペースをスキップして即座に実行できます: `pnpm demo --fast` (`pnpm demo --help` にはすべてのフラグがリストされています)。

---

## コアパターン

すべてのインタラクションは、次のフローに従います。

```
Intent → Approve → Execute → Verify
```

1. **意図** — ユーザーまたはシステムが望ましい結果を宣言します。
2. **承認** — Registrum が構造的に検証し、人間が明示的に署名します。
3. **実行** — オンチェーン取引が送信されます。
4. **検証** — 照合により確認され、XRPL が記録を証明します。

どのステップもオプションではありません。どのステップも自動化されることはありません。

---

## 原則

| 原則 | 実装 |
|-----------|---------------|
| 追記専用の記録 | UPDATE や DELETE はなく、新しいエントリのみを追加します。 |
| フェイルクローズド | 意見の相違が発生すると、システムは停止し、サイレントに修復されることはありません。 |
| 決定論的な再現 | 同じイベントは常に同じ状態を生み出します。 |
| アドバイザリー AI のみ | AI は分析、警告、提案できますが、承認、署名、または実行することはできません。 |
| マルチチェーンの監視 | Ethereum、XRPL、Solana、L2 — チェーンに依存しない読み取りレイヤー |
| 構造的なアイデンティティ | 明確で、不変で、一意です。生体認証ではなく、憲法上のものです。 |

---

## ステータス

14 のパッケージ、2,564 件のテスト、95% 以上のカバレッジ、すべて正常に完了。オープンな形で構築を進めています。

| パッケージ | テスト | 目的 |
|---------|-------|---------|
| `@attestia/types` | 75 | 共有ドメインタイプ（依存関係なし） |
| `@attestia/registrum` | 368 | 憲法上のガバナンス — 11 の不変性、デュアルウィットネス |
| `@attestia/ledger` | 156 | 追記専用の複式簿記エンジン |
| `@attestia/chain-observer` | 295 | マルチチェーン読み取り専用監視（EVM + XRPL + Solana + L2） |
| `@attestia/vault` | 91 | 個人用金庫 — ポートフォリオ、予算、意図 |
| `@attestia/treasury` | 109 | 組織の財務 — 給与計算、分配、資金調達ゲート |
| `@attestia/reconciler` | 98 | 3D クロスシステム照合 + Registrum 証明 |
| `@attestia/witness` | 295 | XRPL オンチェーン証明、マルチシグガバナンス、再試行 |
| `@attestia/verify` | 273 | 再現検証、コンプライアンス証拠、SLA 施行 |
| `@attestia/event-store` | 253 | 追記専用のイベント永続化、JSONL、ハッシュチェーン、34 のイベントタイプ |
| `@attestia/proof` | 94 | Merkle ツリー（RFC 6962）、包含証明、証明パッケージング |
| `@attestia/sdk` | 115 | 外部コンシューマー向けの型付き HTTP クライアント SDK |
| `@attestia/node` | 342 | Hono REST API — 耐久性のある永続化、認証、マルチテナンシー、財務/金庫/ガバナンス、OpenAPI |
| `@attestia/demo` | — | インタラクティブな CLI デモ — Attestia の完全なパイプラインをウォークスルーします（プライベートで、テストはありません）。 |

### 開発

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm test             # Run all tests (2,564)
pnpm test:coverage    # Run with coverage reporting
pnpm typecheck        # Type-check all packages
pnpm bench            # Run benchmarks
```

### XRPL 統合テスト

スタンドアロンの `rippled` ノードが Docker で実行され、決定論的なオンチェーン統合テストを行います。テストネットへの依存関係はなく、Faucet も必要なく、1 秒未満で帳簿が閉じます。

```bash
docker compose up -d              # Start standalone rippled
pnpm --filter @attestia/witness run test:integration  # Run on-chain round-trip tests
docker compose down               # Stop rippled
```

### ドキュメント

| ドキュメント | 目的 |
|----------|---------|
| [HANDBOOK.md](HANDBOOK.md) | エグゼクティブ概要と完全なパッケージリファレンス |
| [ROADMAP.md](ROADMAP.md) | 段階的なプロジェクトロードマップ |
| [DESIGN.md](DESIGN.md) | アーキテクチャの決定 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | パッケージグラフ、データフロー、セキュリティモデル |
| [REFERENCE_ARCHITECTURE.md](REFERENCE_ARCHITECTURE.md) | 5 層スタック、デプロイメントパターン、信頼境界 |
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | API 統合と curl の例 + SDK の使用方法 |
| [VERIFICATION_GUIDE.md](VERIFICATION_GUIDE.md) | 監査担当者向けステップバイステップの再現ガイド |
| [THREAT_MODEL.md](THREAT_MODEL.md) | コンポーネントごとのSTRIDE分析 |
| [CONTROL_MATRIX.md](CONTROL_MATRIX.md) | 脅威 → 対策 → ファイル → テストのマッピング |
| [SECURITY.md](SECURITY.md) | 責任ある情報開示ポリシー |
| [INSTITUTIONAL_READINESS.md](INSTITUTIONAL_READINESS.md) | 導入準備チェックリスト |
| [PERFORMANCE_BASELINE.md](PERFORMANCE_BASELINE.md) | 記録されたベンチマーク |

---

## セキュリティとデータ範囲

- **アクセスされるデータ:** 財務台帳のエントリ、認証レコード、暗号化証明を読み書きします。ウィットネスモジュールが有効な場合、ブロックチェーンノード（XRPL）に接続します。
- **アクセスされないデータ:** テレメトリーは行いません。ユーザーの資格情報は保存しません。サードパーティによる分析も行いません。
- **必要な権限:** ローカルデータディレクトリへの読み取り/書き込みアクセスが必要です。ブロックチェーン認証のためにネットワークアクセスが必要です。完全なSTRIDE分析については、[THREAT_MODEL.md](THREAT_MODEL.md)を参照してください。

## スコアカード

| ゲート | ステータス |
|------|--------|
| A. セキュリティの基本設定 | 合格 |
| B. エラー処理 | 合格 |
| C. オペレーター向けドキュメント | 合格 |
| D. 納品時の衛生管理 | 合格 |
| E. ID | 合格 |

## ライセンス

[MIT](LICENSE)

---

<a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>によって作成されました
