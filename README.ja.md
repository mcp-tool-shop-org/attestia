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

<p align="center"><strong>あるイベント、トランザクション、または状態遷移が発生したことの証明であり、チェーンに紐付けられています。</strong></p>

---

## ミッション

私たちは、お金がどこに存在し、どのように動くかに関わらず、そのお金を生み出したシステムと同様の厳格さで扱われるべきだと考えています。スマートコントラクトは実行されます。ブロックチェーンは記録します。しかし、誰も「証明」しません。

Attestiaは、お金のためのレイヤーを提供します。それは、構造的なガバナンス、決定論的な会計、そして人間による承認された意図であり、それらはチェーン、組織、そして個人にまたがって適用されます。

私たちはあなたのお金を動かすわけではありません。私たちは何が起こったかを証明し、何が起こり得るかを制限し、財務記録を改ざん不可能にします。

### 私たちが重視すること

- **速度よりも真実を。** すべての金融イベントは、追記専用であり、再現可能であり、照合可能です。証明できない場合、それは起こらなかったことになります。
- **人間が承認し、機械が検証します。** AIは助言し、スマートコントラクトは実行されますが、明示的な人間の承認なしには何も動きません。常に。
- **構造的なガバナンス、政治的なガバナンスではありません。** 私たちは、何が有効であるかを投票で決定しません。私たちは、無条件に成立する不変性を定義します。つまり、アイデンティティは明示的であり、系統は途切れておらず、順序は決定論的です。
- **意図は実行ではありません。** 望むことを宣言し、それを実行することは、それぞれ異なるゲートを持つ別々の行為です。それらの間のギャップこそが、信頼の基盤です。
- **チェーンは証人であり、権威ではありません。** XRPLは証明します。Ethereumは決済します。しかし、権限は構造的なルールから生じ、特定のチェーンのコンセンサスからではありません。
- **退屈なインフラが勝利する。** 世界は、もう一つのDeFiプロトコルを必要としていません。必要なのは、その下にある会計レイヤーです。それは、他のすべてのものを信頼できるようにする、金融の配管のようなものです。

## システムにおける位置

Attestia、Cognate、およびRepoMeshは、3つの製品です。

**Attestia**は、あるイベント、トランザクション、または状態遷移が発生したことを証明し、その証明をチェーンに紐付けます。そのドメインは、金融の真実です。それは、個人の保管庫、組織の財務、そして登録簿です。その証明の基本要素は、追記専用のイベントストアとMerkle証明です。

**Cognate**は、それらの基本要素におけるAIガバナンスドメインです。それは、モデルの系統、ポリシーの決定、エージェントの機能、そしてプロンプトと出力の整合性を扱います。それは、2番目のイベントストアを保持しません。

**RepoMesh**は、リリースネットワークです。それは、署名されたイベント、ノードのマニフェスト、そしてXRPLにアンカーされた信頼クロックです。それは、独自のRFC 6962台帳を保持します。それは、AttestiaのMerkleツリーを使用しません。

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
| **Org Treasury** | 決定論的な給与計算、DAOによる分配、デュアルゲートによる資金調達、複式簿記 | Payroll Engineから進化 |
| **Registrum** | 構造的な登録者 - 11の不変性、デュアルウィットネスによる検証、XRPLによる証明 | 変更なし - 憲法的なレイヤー |

---

## 2分で試してみましょう

Attestiaを理解するための最も簡単な方法は、1つの支払いが最初から最後までどのように流れるかを観察することです。インタラクティブなデモは、**完全な意図→承認→実行→検証→アテステーション→証明**のパイプラインを最初から最後まで実行します。すべての段階は、実際のドメインパッケージ（マッチング、ハッシュ化、XRPLスタイルの証明、Merkle証明）に対してリアルタイムで計算されます。これはモックではありません。

```bash
pnpm install   # Install all dependencies
pnpm build     # Build all packages
pnpm demo      # Walk the full pipeline (~10s, paced for readability)
```

単一の給与支払いが、段階的に、独立して検証可能な暗号化された証明になるのを目にすることができます。ペースをスキップして、すぐに実行するには、`--fast`を追加してください。`pnpm demo --fast`（`pnpm demo --help`にはすべてのフラグがリストされています）。

---

## コアパターン

すべてのインタラクションは、1つのフローに従います。

```
Intent → Approve → Execute → Verify
```

1. **意図** - ユーザーまたはシステムが、望ましい結果を宣言します。
2. **承認** - 登録簿が構造的に検証し、人間が明示的に署名します。
3. **実行** - オンチェーンのトランザクションが送信されます。
4. **検証** - 照合により確認され、XRPLが記録を証明します。

どのステップもオプションではありません。どのステップも自動化されません。

---

## 原則

| 原則 | 実装 |
|-----------|---------------|
| 追記専用の記録 | UPDATEもDELETEもありません。新しいエントリのみです。 |
| フェイルクローズド | 意見の相違はシステムを停止させ、決して静かに修復することはありません。 |
| 決定論的な再現 | 同じイベントは、常に同じ状態を生み出します。 |
| アドバイザリーAIのみ | AIは分析し、警告し、提案することができますが、決して承認、署名、または実行することはありません。 |
| マルチチェーンの監視 | Ethereum、XRPL、Solana、L2s - チェーンに依存しない読み取りレイヤー |
| 構造的なアイデンティティ | 明示的、不変、一意 - 生体認証ではなく、憲法的なものです。 |

---

## ステータス

バージョン2.1.2。15のワークスペースパッケージ、CIにおける2,594のテスト、および3つのバンドルによるスモークテスト、パッケージあたり94.9〜100％のステートメントカバレッジ、すべて正常。公開中でビルドしています。

| パッケージ | テスト | 目的 |
|---------|-------|---------|
| `@attestia/types` | 75 | 共有ドメインタイプ（依存関係なし） |
| `@attestia/registrum` | 368 | 憲法的なガバナンス - 11の不変性、デュアルウィットネス |
| `@attestia/ledger` | 156 | 追記専用の複式簿記エンジン |
| `@attestia/chain-observer` | 295 | マルチチェーンの読み取り専用監視（EVM + XRPL + Solana + L2s） |
| `@attestia/vault` | 91 | 個人の保管庫 - ポートフォリオ、予算、意図 |
| `@attestia/treasury` | 109 | 組織の財務 - 給与、分配、資金調達ゲート |
| `@attestia/reconciler` | 98 | 3Dのクロスシステムマッチング + 登録簿による証明 |
| `@attestia/witness` | 295 | XRPLのオンチェーン証明、マルチシグガバナンス、再試行 |
| `@attestia/verify` | 273 | 再現検証、コンプライアンス証拠、SLAの強制 |
| `@attestia/event-store` | 263 | 追記専用のイベント永続化、JSONL、ハッシュチェーン、34のイベントタイプ |
| `@attestia/proof` | 94 | Merkleツリー（RFC 6962）、包含証明、証明パッケージ |
| `@attestia/sdk` | 115 | 外部の利用者を対象とした、型付きHTTPクライアントSDK |
| `@attestia/node` | 362 | Hono REST API — 永続的なデータ保持、認証、マルチテナンシー、資産/ウォールト/ガバナンス、OpenAPI |
| `@mcptoolshop/attestia` | 3 | 公開されたnpmパッケージ：上記のすべてのライブラリを1つのバンドルにまとめ、サブパスエクスポートを使用（スモークテスト、`pnpm test`によって実行。CIのカバー率テストには含まれない） |
| `@attestia/demo` | — | インタラクティブなCLIデモ — Attestiaパイプライン全体をステップごとに実行（プライベート、テストなし） |

### 2.1の新機能

- **2.1.2：イベントログのクラッシュからの復旧。** ライターが途中で終了した場合、再開時に`JsonlEventStore`は破損した最後の行をスキップし、最初の追加書き込みで改行を書き込むため、新しいイベントは新しい行から開始されます。破損したフラグメントはファイルに残され、ロード時にスキップされます。`append()`が返されたイベントはディスクに保存されます。ログの中間のイベントが破損している場合でも、ストアは開くことを拒否します（`INTEGRITY_VIOLATION`、デフォルトの`verifyOnLoad: true`）。イベントストアのREADMEには、[再開後の状態](packages/event-store/README.md)について記載されています。
- **2.1.1：Zod 4。** 検証はZod 4.6.7で実行されます。`details.issues[].message`および`ConfigError`の組み込みの検証メッセージの文言が変更されました（例：`"Required"`は現在`"Invalid input: expected <type>, received undefined"`）。エラーコード、問題のパス、HTTPエラーエンベロープ、およびAttestia独自の改良メッセージは変更されていないため、メッセージのテキストではなく、コードとパスで照合してください。
- **2.1.0：サービスの永続的なイベントログ。** `ATTESTIA_EVENTS_FILE`は、設定された所有者のイベントログとしてそのファイルを開きます。設定されていない場合、サービスはメモリ内に保持されます。不正な`API_KEYS`エントリは、起動時のエラーにキーを含めなくなりました。

完全なリストについては、[CHANGELOG.md](CHANGELOG.md)を参照してください。

### 開発

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm test             # Run all tests (2,597)
pnpm test:coverage    # Run with coverage reporting
pnpm typecheck        # Type-check all packages
pnpm bench            # Run benchmarks
```

### XRPL統合テスト

スタンドアロンの`rippled`ノードがDockerで実行され、決定的なオンチェーン統合テストを行います。テストネットへの依存関係はなく、Faucetも必要なく、1秒未満の帳簿のクローズが可能です。

```bash
docker compose up -d              # Start standalone rippled
pnpm --filter @attestia/witness run test:integration  # Run on-chain round-trip tests
docker compose down               # Stop rippled
```

### ドキュメント

| ドキュメント | 目的 |
|----------|---------|
| [HANDBOOK.md](HANDBOOK.md) | 概要と完全なパッケージリファレンス |
| [ROADMAP.md](ROADMAP.md) | 段階的なプロジェクトロードマップ |
| [DESIGN.md](DESIGN.md) | アーキテクチャの決定 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | パッケージグラフ、データフロー、セキュリティモデル |
| [REFERENCE_ARCHITECTURE.md](REFERENCE_ARCHITECTURE.md) | 5層スタック、デプロイメントパターン、信頼境界 |
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | curlの例とSDKの使用法によるAPI統合 |
| [VERIFICATION_GUIDE.md](VERIFICATION_GUIDE.md) | 監査者がステップごとに実行できるリプレイガイド |
| [THREAT_MODEL.md](THREAT_MODEL.md) | コンポーネントごとのSTRIDE分析 |
| [CONTROL_MATRIX.md](CONTROL_MATRIX.md) | 脅威→制御→ファイル→テストのマッピング |
| [SECURITY.md](SECURITY.md) | 責任ある情報開示ポリシー |
| [INSTITUTIONAL_READINESS.md](INSTITUTIONAL_READINESS.md) | 導入準備チェックリスト |
| [PERFORMANCE_BASELINE.md](PERFORMANCE_BASELINE.md) | 記録されたベンチマーク |

---

## セキュリティとデータ範囲

- **アクセスされるデータ：** 財務帳簿エントリ、アテステーションレコード、および暗号化された証明を読み書きします。サービスは、設定されている場合、そのイベントログを`ATTESTIA_EVENTS_FILE`という名前のファイルに書き込みます。ウィットネスモジュールがアクティブな場合に、ブロックチェーンノード（XRPL）に接続します。
- **アクセスされないデータ：** テレメトリは行いません。ユーザーの認証情報を保存しません。サードパーティの分析は行いません。
- **ディスク上の整合性：** イベントログは追加専用で、ハッシュチェーン化されています。クラッシュによる破損した最後の行はスキップされ、ログは再開されます。チェーンを壊すような損傷がある場合、デフォルトではストアは開くことを拒否します。
- **必要な権限：** ローカルデータディレクトリへの読み取り/書き込みアクセス。ブロックチェーンアテステーションのためのネットワークアクセス。完全なSTRIDE分析については、[THREAT_MODEL.md](THREAT_MODEL.md)を参照してください。

## スコアカード

| ゲート | ステータス |
|------|--------|
| A. セキュリティベースライン | PASS |
| B. エラー処理 | PASS |
| C. オペレーター向けドキュメント | PASS |
| D. リリース時の衛生管理 | PASS |
| E. ID | PASS |

## ライセンス

[MIT](LICENSE)

---

<a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>によって構築
