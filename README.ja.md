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

<p align="center"><strong>あるイベント、トランザクション、または状態遷移が発生したことの証明であり、チェーンに紐付けられる。</strong></p>

---

## ミッション

私たちは、お金がどこに存在し、どのように動くかに関わらず、そのお金を生み出したシステムと同様の厳格さで扱われるべきだと考えています。スマートコントラクトは実行されます。ブロックチェーンは記録します。しかし、誰も「証明」しません。

Attestiaは、お金のためのレイヤーを提供します。それは、構造的なガバナンス、決定論的な会計、そして人間による承認された意図であり、それらはチェーン、組織、そして個人を横断して適用されます。

私たちは、あなたのお金を動かすわけではありません。私たちは、何が起こったかを証明し、何が起こり得るかを制限し、財務記録を改ざん不可能にします。

### 私たちが重視すること

- **速度よりも真実を。** すべての財務イベントは、追記専用であり、再現可能であり、照合可能です。証明できない場合、それは起こらなかったことになります。
- **人間が承認し、機械が検証します。** AIは助言し、スマートコントラクトは実行されますが、明示的な人間の承認なしには何も動きません。常に。
- **構造的なガバナンス、政治的なガバナンスではありません。** 私たちは、何が有効であるかを投票で決定しません。私たちは、無条件に成立する不変性を定義します。つまり、アイデンティティは明示的であり、系統は途切れなく、順序は決定論的です。
- **意図は実行ではありません。** 望むことを宣言することと、それを実行することは、それぞれ異なるゲートを持つ別々の行為です。それらの間のギャップこそが、信頼の源です。
- **チェーンは証人であり、権威ではありません。** XRPLは証明します。Ethereumは決済します。しかし、権限は構造的なルールから生じ、特定のチェーンのコンセンサスから生じるものではありません。
- **退屈なインフラが勝利する。** 世界は、もう一つのDeFiプロトコルを必要としていません。それは、その下にある会計レイヤーを必要としています。つまり、他のすべてのものを信頼できるようにする、財務の基盤です。

## システムにおける位置

Attestia、Cognate、RepoMeshは、3つの製品です。

**Attestia**は、あるイベント、トランザクション、または状態遷移が発生したことを証明し、その証明をチェーンに紐付けます。そのドメインは、財務の真実です。それは、個人の金庫、組織の財務、そして登録簿です。その証明の基本要素は、追記専用のイベントストアとMerkle証明です。

**Cognate**は、それらの基本要素におけるAIガバナンスドメインです。それは、モデルの系統、ポリシーの決定、エージェントの機能、そしてプロンプトと出力の整合性を扱います。それは、2番目のイベントストアを保持しません。

**RepoMesh**は、リリースネットワークです。それは、署名されたイベント、ノードのマニフェスト、そしてXRPLにアンカーされた信頼クロックです。それは、独自のRFC 6962レジャーを保持します。それは、AttestiaのMerkleツリーを使用しません。

Cognateは、証明が必要なときにAttestiaを呼び出し、リリースチェックが必要なときにRepoMeshを呼び出します。

---

## アーキテクチャ

Attestiaは、3つのシステム、1つの真実です。

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
| **Personal Vault** | マルチチェーンポートフォリオの監視、エンベロープ予算、意図の宣言 | NextLedgerから進化 |
| **Org Treasury** | 決定論的な給与計算、DAOの分配、デュアルゲートによる資金調達、複式簿記 | Payroll Engineから進化 |
| **Registrum** | 構造的な登録者 — 11個の不変性、デュアルウィットネスによる検証、XRPLによる証明 | 変更なし — 憲法的なレイヤー |

---

## 2分で試してみる

Attestiaを理解するための最も簡単な方法は、1つの支払いが最初から最後までどのように流れるかを観察することです。インタラクティブなデモは、**完全な意図→承認→実行→検証→証明→証明**のパイプラインを最初から最後まで実行します。すべての段階は、実際のドメインパッケージ（マッチング、ハッシュ化、XRPLスタイルの証明、Merkle証明）に対してリアルタイムで計算されます。これは、モックではありません。

```bash
pnpm install   # Install all dependencies
pnpm build     # Build all packages
pnpm demo      # Walk the full pipeline (~10s, paced for readability)
```

1つの給与支払いが、段階的に、独立して検証可能な暗号化された証明になるのを目にすることができます。ペースをスキップして、すぐに実行するには、`--fast`を追加してください：`pnpm demo --fast`（`pnpm demo --help`はすべてのフラグをリストします）。

---

## コアパターン

すべてのインタラクションは、1つのフローに従います。

```
Intent → Approve → Execute → Verify
```

1. **意図** — ユーザーまたはシステムが、望ましい結果を宣言します。
2. **承認** — 登録簿が構造的に検証し、人間が明示的に署名します。
3. **実行** — オンチェーンのトランザクションが送信されます。
4. **検証** — 照合により確認され、XRPLが記録を証明します。

どのステップもオプションではありません。どのステップも自動化されません。

---

## 原則

| 原則 | 実装 |
|-----------|---------------|
| 追記専用の記録 | UPDATEもDELETEもありません。新しいエントリのみです。 |
| フェイルクローズ | 不一致はシステムを停止させ、決して静かに修復することはありません。 |
| 決定論的な再現 | 同じイベントは、常に同じ状態を生み出します。 |
| アドバイザリーAIのみ | AIは分析し、警告し、提案することができますが、決して承認、署名、または実行することはありません。 |
| マルチチェーンの監視 | Ethereum、XRPL、Solana、L2 — チェーンに依存しない読み取りレイヤー |
| 構造的なアイデンティティ | 明示的、不変、一意 — 生体認証ではなく、憲法的なものです。 |

---

## ステータス

14個のパッケージ、2,564個のテスト、95%以上のカバレッジ、すべて正常。公開して構築中です。

| パッケージ | テスト | 目的 |
|---------|-------|---------|
| `@attestia/types` | 75 | 共有ドメインタイプ（依存関係なし） |
| `@attestia/registrum` | 368 | 憲法的なガバナンス — 11個の不変性、デュアルウィットネス |
| `@attestia/ledger` | 156 | 追記専用の複式簿記エンジン |
| `@attestia/chain-observer` | 295 | マルチチェーンの読み取り専用監視（EVM + XRPL + Solana + L2） |
| `@attestia/vault` | 91 | 個人の金庫 — ポートフォリオ、予算、意図 |
| `@attestia/treasury` | 109 | 組織の財務 — 給与、分配、資金調達ゲート |
| `@attestia/reconciler` | 98 | 3Dクロスシステムマッチング + 登録簿による証明 |
| `@attestia/witness` | 295 | XRPLのオンチェーン証明、マルチシグガバナンス、再試行 |
| `@attestia/verify` | 273 | 再現検証、コンプライアンス証拠、SLAの強制 |
| `@attestia/event-store` | 253 | 追記専用のイベント永続化、JSONL、ハッシュチェーン、34個のイベントタイプ |
| `@attestia/proof` | 94 | Merkleツリー（RFC 6962）、包含証明、証明パッケージ |
| `@attestia/sdk` | 115 | 外部の利用者を対象とした、型付きHTTPクライアントSDK |
| `@attestia/node` | 342 | Hono REST API — 永続的なデータ保持、認証、マルチテナンシー、資産管理/金庫/ガバナンス、OpenAPI |
| `@attestia/demo` | — | インタラクティブなCLIデモ — Attestiaパイプライン全体をステップごとに実行（プライベート、テストなし） |

### 開発

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm test             # Run all tests (2,564)
pnpm test:coverage    # Run with coverage reporting
pnpm typecheck        # Type-check all packages
pnpm bench            # Run benchmarks
```

### XRPL統合テスト

スタンドアロンの`rippled`ノードをDockerで実行し、決定的なオンチェーン統合テストを実施 — テストネットへの依存関係なし、Faucetなし、1秒未満の台帳クローズ。

```bash
docker compose up -d              # Start standalone rippled
pnpm --filter @attestia/witness run test:integration  # Run on-chain round-trip tests
docker compose down               # Stop rippled
```

### ドキュメント

| ドキュメント | 目的 |
|----------|---------|
| [HANDBOOK.md](HANDBOOK.md) | 概要と完全なパッケージリファレンス |
| [ROADMAP.md](ROADMAP.md) | 段階ごとのプロジェクトロードマップ |
| [DESIGN.md](DESIGN.md) | アーキテクチャの決定 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | パッケージグラフ、データフロー、セキュリティモデル |
| [REFERENCE_ARCHITECTURE.md](REFERENCE_ARCHITECTURE.md) | 5層スタック、デプロイメントパターン、信頼境界 |
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | curlの例とSDKの使用法によるAPI統合 |
| [VERIFICATION_GUIDE.md](VERIFICATION_GUIDE.md) | 監査担当者向けのステップバイステップの再現ガイド |
| [THREAT_MODEL.md](THREAT_MODEL.md) | コンポーネントごとのSTRIDE分析 |
| [CONTROL_MATRIX.md](CONTROL_MATRIX.md) | 脅威→制御→ファイル→テストのマッピング |
| [SECURITY.md](SECURITY.md) | 責任ある情報開示ポリシー |
| [INSTITUTIONAL_READINESS.md](INSTITUTIONAL_READINESS.md) | 導入準備チェックリスト |
| [PERFORMANCE_BASELINE.md](PERFORMANCE_BASELINE.md) | 記録されたベンチマーク |

---

## セキュリティとデータ範囲

- **アクセスされるデータ:** 金融台帳のエントリ、アテステーションレコード、暗号学的証明の読み書き。ウィットネスモジュールがアクティブな場合に、ブロックチェーンノード（XRPL）に接続します。
- **アクセスされないデータ:** テレメトリは行いません。ユーザーの認証情報は保存しません。サードパーティの分析は行いません。
- **必要な権限:** ローカルデータディレクトリへの読み取り/書き込みアクセス。ブロックチェーンアテステーションのみのためのネットワークアクセス。完全なSTRIDE分析については、[THREAT_MODEL.md](THREAT_MODEL.md)を参照してください。

## スコアカード

| ゲート | ステータス |
|------|--------|
| A. セキュリティの基本 | 合格 |
| B. エラー処理 | 合格 |
| C. オペレーター向けドキュメント | 合格 |
| D. リリース時の衛生管理 | 合格 |
| E. 識別 | 合格 |

## ライセンス

[MIT](LICENSE)

---

<a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>によって作成されました。
