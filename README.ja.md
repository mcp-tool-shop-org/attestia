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

<p align="center"><strong>分散型世界のための、金融の信頼性インフラ。</strong></p>

---

## ミッション

私たちは、お金がどこに存在し、どのように移動しようと、それを生み出したシステムと同じレベルの厳格さを持つべきだと考えています。スマートコントラクトは実行され、ブロックチェーンは記録します。しかし、誰もが「証明」するわけではありません。

Attestiaは、構造的なガバナンス、決定論的な会計、そして人間が承認した意図を、チェーン、組織、個人を越えて統合する、欠けていた要素です。

私たちは、お客様のお金を移動させるわけではありません。何が起こったのかを証明し、何が起こりうるかを制限し、金融記録を改ざんできないようにします。

### 私たちの信念

- **スピードよりも信頼性。** すべての金融取引は、追記のみ、再現可能、そして整合性が取れた状態です。証明できないものは、存在しません。
- **人間が承認し、機械が検証する。** AIはアドバイスを提供し、スマートコントラクトは実行されますが、明示的な人間の承認なしに何も動きません。常に。
- **構造的なガバナンス、政治的なガバナンスではない。** 妥当なものを投票で決定するのではなく、無条件に有効な不変のルールを定義します。アイデンティティは明確であり、系統は途切れておらず、順序は決定論的です。
- **意図は実行ではない。** 望むことを宣言することと、それを実行することは、別の行為であり、それぞれ別の段階があります。その間のギャップこそが、信頼が存在する場所です。
- **チェーンは権威ではなく、証人である。** XRPLは証明し、Ethereumは決済します。しかし、権威は構造的なルールから生まれるものであり、どのチェーンのコンセンサスから生まれるわけではありません。
- **堅牢なインフラが勝利する。** 世界が必要としているのは、別のDeFiプロトコルではありません。それは、基盤となる会計レイヤー、つまり、他のすべてを信頼できるものにするための金融インフラです。

---

## アーキテクチャ

Attestiaは、3つのシステムで構成され、1つの真実を提供します。

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
| **Personal Vault** | マルチチェーンポートフォリオ監視、予算管理、意図宣言 | NextLedgerから派生 |
| **Org Treasury** | 決定論的な給与計算、DAOへの分配、二重認証による資金調達、複式簿記 | Payroll Engineから派生 |
| **Registrum** | 構造的なレジストリ — 11の不変条件、二重認証による検証、XRPLによる証明 | 変更なし — 憲法レイヤー |

---

## 2分で試してみる

Attestiaを理解する最速の方法は、1つの支払いフロー全体を追跡することです。インタラクティブなデモでは、**意図 → 承認 → 実行 → 検証 → 証明**という一連の処理を、実際のドメインパッケージ（マッチング、ハッシュ化、XRPLスタイルの証明、Merkle証明など）に対してリアルタイムで実行します。これは、シミュレーションではありません。

```bash
pnpm install   # Install all dependencies
pnpm build     # Build all packages
pnpm demo      # Walk the full pipeline (~10s, paced for readability)
```

単一の給与支払いが、段階的に検証可能な暗号化された証明に変換される様子を、ご覧いただけます。処理速度を上げるには、`--fast`オプションを追加します。`pnpm demo --fast`（`pnpm demo --help`で、すべてのオプションを表示します）。

---

## コアパターン

すべてのインタラクションは、次のフローに従います。

```
Intent → Approve → Execute → Verify
```

1. **意図** — ユーザーまたはシステムが、望ましい結果を宣言します。
2. **承認** — レジストラムが構造的に検証し、人間が明示的に承認します。
3. **実行** — オンチェーンのトランザクションが送信されます。
4. **検証** — 整合性が確認され、XRPLが記録を証明します。

どのステップも省略できません。どのステップも自動化されません。

---

## 原則

| 原則 | 実装 |
|-----------|---------------|
| 追記のみの記録 | UPDATEもDELETEもありません — 新しいエントリのみ |
| フェイルセーフ | 意見の相違が発生するとシステムは停止し、静かに修復されることはありません。 |
| 決定論的な再現 | 同じイベントは常に同じ状態をもたらします。 |
| アドバイスのみのAI | AIは分析、警告、提案を行うことができますが、承認、署名、実行は行いません。 |
| マルチチェーン監視 | Ethereum、XRPL、Solana、L2など — チェーンに依存しない読み取りレイヤー |
| 構造的なアイデンティティ | 明示的、不変、一意 — 生体認証ではなく、憲法に基づく |

---

## ステータス

14のパッケージ、2,220のテスト、96.80%のテストカバレッジ、すべて正常。パブリックでビルドを実行中。

| パッケージ | テスト | 目的 |
|---------|-------|---------|
| `@attestia/types` | 72 | 共有ドメイン型（依存関係なし） |
| `@attestia/registrum` | 341 | 憲法に基づくガバナンス — 11の不変条件、デュアルウィットネス |
| `@attestia/ledger` | 154 | 追記専用の二重簿記エンジン |
| `@attestia/chain-observer` | 278 | マルチチェーンの読み取り専用監視（EVM + XRPL + Solana + L2） |
| `@attestia/vault` | 75 | 個人用ウォレット — ポートフォリオ、予算、意図 |
| `@attestia/treasury` | 92 | 組織の財務 — 給与、分配、資金調達ゲート |
| `@attestia/reconciler` | 81 | 3Dクロスシステムマッチング + Registrumアテステーション |
| `@attestia/witness` | 278 | XRPLのオンチェーンアテステーション、マルチシグガバナンス、リトライ |
| `@attestia/verify` | 242 | リプレイ検証、コンプライアンス証拠、SLAの適用 |
| `@attestia/event-store` | 226 | 追記専用のイベント永続化、JSONL、ハッシュチェーン、34種類のイベント |
| `@attestia/proof` | 75 | マークルトリー、包含証明、アテステーション証明のパッケージング |
| `@attestia/sdk` | 79 | 外部クライアント向けの型付きHTTPクライアントSDK |
| `@attestia/node` | 227 | Hono REST API — 34のエンドポイント、認証、マルチテナント、パブリックAPI、コンプライアンス |
| `@attestia/demo` | — | インタラクティブなCLIデモ — Attestiaのパイプライン全体を体験できます（プライベート、テストなし） |

### 開発

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm test             # Run all tests (2,220)
pnpm test:coverage    # Run with coverage reporting
pnpm typecheck        # Type-check all packages
pnpm bench            # Run benchmarks
```

### XRPL統合テスト

スタンドアロンの`rippled`ノードがDockerで実行され、決定論的なオンチェーン統合テストを行います。テストネットへの依存がなく、テスト用の仮想通貨も不要で、サブ秒のレジャークローズを実現します。

```bash
docker compose up -d              # Start standalone rippled
pnpm --filter @attestia/witness run test:integration  # Run on-chain round-trip tests
docker compose down               # Stop rippled
```

### ドキュメント

| ドキュメント | 目的 |
|----------|---------|
| [HANDBOOK.md](HANDBOOK.md) | 概要とパッケージの詳細な参照 |
| [ROADMAP.md](ROADMAP.md) | 段階ごとのプロジェクトロードマップ |
| [DESIGN.md](DESIGN.md) | アーキテクチャの決定事項 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | パッケージグラフ、データフロー、セキュリティモデル |
| [REFERENCE_ARCHITECTURE.md](REFERENCE_ARCHITECTURE.md) | 5層のスタック、デプロイメントパターン、信頼境界 |
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | curlの例を使用したAPI統合、およびSDKの使用方法 |
| [VERIFICATION_GUIDE.md](VERIFICATION_GUIDE.md) | 監査担当者向けの手順ガイド |
| [THREAT_MODEL.md](THREAT_MODEL.md) | コンポーネントごとのSTRIDE分析 |
| [CONTROL_MATRIX.md](CONTROL_MATRIX.md) | 脅威 → 制御 → ファイル → テストのマッピング |
| [SECURITY.md](SECURITY.md) | 責任ある情報開示ポリシー |
| [INSTITUTIONAL_READINESS.md](INSTITUTIONAL_READINESS.md) | 導入準備チェックリスト |
| [PERFORMANCE_BASELINE.md](PERFORMANCE_BASELINE.md) | 記録されたベンチマーク |

---

## セキュリティとデータ範囲

- **アクセスされるデータ:** 金融の台帳エントリ、アテステーションレコード、および暗号化された証明書の読み書き。ウィットネスモジュールが有効な場合、ブロックチェーンノード（XRPL）に接続します。
- **アクセスされないデータ:** テレメトリーは収集しません。ユーザーの認証情報は保存しません。サードパーティの分析ツールは使用しません。
- **必要な権限:** ローカルのデータディレクトリへの読み書きアクセス。ブロックチェーンのアテステーションに必要なネットワークアクセス。詳細については、[THREAT_MODEL.md](THREAT_MODEL.md) を参照してください。

## スコアカード

| ゲート | ステータス |
|------|--------|
| A. セキュリティ基準 | 合格 |
| B. エラー処理 | 合格 |
| C. 運用担当者向けドキュメント | 合格 |
| D. ソフトウェアの品質 | 合格 |
| E. 認証 | 合格 |

## ライセンス

[MIT](LICENSE)

---

<a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a> が作成しました。
