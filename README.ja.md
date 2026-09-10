<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.zh-TW.md">繁體中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.es.md">Español</a>
</p>

# my-flow

**Claude Code** と **Codex CLI** の両方で同じように動作する軽量なワークフローレイヤーです。ランタイムを追加せず、外部ツールにも依存しません。提供するものは次のとおりです。

- 4 段階のフローひとつ: `interview → mf-plan → execute → mf-verify`
- 7 つのスキルと 4 つのサブエージェントロール(うち 3 つは読み取り専用)
- 2 つのフック: セッション開始時にアクティブな変更を注入し、停止時に偽の「完了」宣言をブロックします
- クロスモデルアドバイザー: Claude が Codex に、Codex が Claude に尋ねます。常に読み取り専用です
- **インテントレイヤー**: `specs/` が現在の正しい状態を、`changes/<name>/` がひとつの変更の意図を保持します。この構造は OpenSpec から借用していますが、my-flow は独自の `new / status / validate / archive` を同梱しているため、OpenSpec 自体は不要です

oh-my-claudecode と oh-my-codex がラップしていたもの(エージェントチーム、`/goal`、worktree、フック、スキル、プラグイン)はすべて、両 CLI のネイティブ機能を通じて直接使用します。

## 目次

1. [位置づけ](#位置づけ)
2. [要件](#要件)
3. [クイックスタート](#クイックスタート)
4. [概念](#概念)
5. [CLI コマンド](#cli-コマンド)
6. [スキル](#スキル)
7. [サブエージェントの役割](#サブエージェントの役割)
8. [フック](#フック)
9. [クロスモデルアドバイザー](#クロスモデルアドバイザー)
10. [ダッシュボード](#ダッシュボード)
11. [インテントレイヤー](#インテントレイヤー)
12. [リポジトリ構成と単一ソースでの執筆](#リポジトリ構成と単一ソースでの執筆)
13. [Codex へのインストール](#codex-へのインストール)
14. [トラブルシューティング](#トラブルシューティング)
15. [ライセンス](#ライセンス)

## 位置づけ

| ツール / プロジェクト | 役割 |
|---|---|
| Claude Code | 日常的な対話型開発の主な実行者(ネイティブのエージェントチーム + `/goal`) |
| Codex | アドバイザー兼クロス検証者: 設計と diff をレビューし、意見が割れたときに判断を下します。実装するのは `$my-flow-execute` を明示的に呼び出したときのみです |
| OpenSpec | その考え方とディレクトリ構造(specs / changes / delta specs / tasks.md のチェックボックス)のみを借用しています。CLI も `/opsx` コマンドも使いません |
| oh-my-claudecode | 任意です。クロスモデルアドバイザーとスキル抽出は my-flow がすでにカバーしています。HUD には claude-hud を使ってください |
| oh-my-codex | 不要です。そのフロー規約は `src/core/core.md` とスキルに蒸留されています |

## 要件

- Node.js 20 以降(スクリプトとフックは依存関係のないプレーンな Node です)
- Claude 側には Claude Code 2.1.x
- Codex 側には Codex CLI 0.135 以降(features の `hooks`、`goals`、`multi_agent` を有効化)
- 主なターゲットは Windows 11 で、tmux や WSL なしですべて動作します。macOS と Linux でも同じスクリプトが動作します

## クイックスタート

```bash
git clone https://github.com/Qither/my-flow.git
cd my-flow

# 1. Claude Code: enable agent teams and install the working agreement into ~/.claude/CLAUDE.md
node scripts/install.mjs claude

# 2. Load the plugin (development) ...
claude --plugin-dir /path/to/my-flow
# ... or install it from the local marketplace (stable)
claude plugin marketplace add /path/to/my-flow
claude plugin install my-flow@my-flow

# 3. Set up a project
cd /path/to/your/project
node /path/to/my-flow/scripts/init.mjs

# 4. Start a change
node /path/to/my-flow/scripts/spec.mjs new my-first-change
```

その後、Claude Code 内で `/my-flow:interview my-first-change` → `/my-flow:mf-plan my-first-change` → `/my-flow:execute my-first-change` → `/my-flow:mf-verify my-first-change` の順に実行します。

Codex 側は任意です。[Codex へのインストール](#codex-へのインストール)を参照してください。

## 概念

### 4 つの段階

| リクエストの種類 | 使用する段階 |
|---|---|
| 具体的で、単一ファイル、受け入れ基準が明確 | `execute` のみ(またはそのまま実施) |
| 具体的だが複数ファイルまたは複数モジュールにまたがる | `mf-plan → execute → mf-verify` |
| 具体的、複数ファイル、設計はすでに明確 | `mf-plan --fast [--go] → execute → mf-verify` |
| 曖昧で、受け入れ基準がなく、「〜すべきか」という相談 | `interview → mf-plan → execute → mf-verify` |
| ビルド設定、シェーダー、エンジンモジュール、マイグレーション、認証に触れる | `mf-plan` と `mf-verify` を決して省略しない |

段階をまたいで適用されるルール:

- `interview` は 1 ラウンドにつき 1 つの質問をし、非目標と決定境界が明示されたときにのみ終了します。
- `mf-plan` は決して実装しません。`execute` は決して再設計しません。設計が間違っている場合は、停止して前の段階に戻ります。
- `mf-verify` は常に、コードを書いたコンテキストとは別のコンテキストで実行されます。
- `tasks.md` のチェックボックスが唯一の進捗台帳です。チェックを付けるのは、そのタスク自身の検証が通った後だけです。

### `mf-` プレフィックスの理由

Claude Code には組み込みの `/plan`(プランモード)と、`run` および `verify` という名前の同梱スキルがあります。プラグインのスキルは常に名前空間付き(`/my-flow:...`)なので何も上書きされませんが、モデルは名前と説明でスキルを選びます。異なる名前にすることで曖昧さがなくなります。

| 段階 | スキル | 素直な名前を使わない理由 |
|---|---|---|
| Interview | `interview` | 競合なし |
| Plan | `mf-plan` | 組み込みの `/plan` はプランモード |
| Execute | `execute` | 組み込みスキル `run` はプロジェクトのアプリを起動する |
| Verify | `mf-verify` | 組み込みスキル `verify` |

### セッションごとにループの権限はひとつ

Claude Code では、セッションごとに `/goal` は最大 1 つ、エージェントチームも最大 1 つです。`execute` は貼り付け用の `/goal` 文を出力します(スキル自身は設定できません)。Stop フックはあくまでバックストップで、`execute` 中に未チェックのタスクを残したまま完了を宣言した場合のみ、しかも `spec stage` が書いた状態が新しい間だけブロックします。Codex ではスレッドごとに goal は 1 つで、`execute` はアクティブな goal がない場合にのみ `create_goal` を呼び出します。 例外: `mf-plan --fast --go` から入った実行は `/goal` の停止をスキップし、Stop フックの保険だけに頼ります。

### Claude と Codex のそれぞれの役割

Claude Code が対話的な作業を行い、ループを実行します。Codex はレビュー、計画、検証を行い、`ask` リクエストに回答します。実装するのは `$my-flow-execute` を明示的に呼び出したときのみです。どちらの側でも tmux、チームランタイム、状態デーモンは関与しません。

## CLI コマンド

すべてのコマンドはプレーンな Node スクリプトです。`node scripts/cli.mjs <command>`(または `npm link` 後の `my-flow <command>`)がそれらにディスパッチします。

| コマンド | 動作 | 補足 |
|---|---|---|
| `build [--check]` | `src/` を Claude プラグインと Codex サーフェスにレンダリングします | `src/` を編集した後に実行します。`--check` は比較のみを行い、出力が古い場合は終了コード 1 で終了します |
| `install claude [--dry-run]` | `~/.claude/settings.json` をバックアップし、`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` を設定し、作業合意を `~/.claude/CLAUDE.md` に upsert します. Windows ではさらにスケジュールタスク `my-flow-models-check`（`conhost.exe --headless node scripts/models.mjs check --quiet --home <MY_FLOW_HOME>`）を登録し、ツールのホームを `~/.my-flow/config.json` に記録します | プラグインのインストールコマンドを表示しますが、実行はしません |
| `install codex [--link] [--dry-run]` | バックアップ後、スキルとエージェントの TOML をコピーし、PowerShell シムを書き込み、`hooks.json` をマージし、信頼済みハッシュを `config.toml` に書き込み、`~/.codex/AGENTS.md` を upsert します. Windows ではさらにスケジュールタスク `my-flow-models-check` を登録し、ツールのホームとエージェントディレクトリを `~/.my-flow/config.json` に記録します | `--link` はコピーの代わりにジャンクションを使用します |
| `uninstall codex [--dry-run]` | `install codex` を元に戻します。`~/.codex` 内のそれ以外はすべて保持します. `~/.my-flow/config.json` から Codex のホームを削除します。他のサーフェスが残っていない場合のみスケジュールタスク `my-flow-models-check` を削除します |  |
| `init [--simple] [--tools claude,codex] [dir]` | `specs/`、`changes/`(`.templates/` と `archive/` を含む)、`specs/README.md`、`.claude/rules/specs.md`、`.my-flow/` を作成し、プロジェクトの `CLAUDE.md` / `AGENTS.md` にブロックを追記します | `--simple` は変更ごとにひとつの `docs/changes/<name>.md` を使う方式に切り替えます |
| `spec new <name>` | テンプレートから `changes/<name>/{proposal,design,tasks}.md` を作成し、それを現在の変更としてマークします | kebab-case の名前 |
| `spec status [name] [--json]` | チェック済み / 全タスク数、成果物の状態(missing / empty / done)、delta spec の数。14 日間手つかずの未完了 change に `[stale Nd]` を付け(`--stale-days`、`MY_FLOW_STALE_DAYS`)、2 つの change が同じ要件を主張すると `overlap:`、capability に 5 回マージされると `audit suggested:` を表示(`MY_FLOW_AUDIT_EVERY`) | 未編集のテンプレートは empty として数えられます |
| `spec validate [name] [--json]` | 構造チェック: 必須セクション、タスク行の形式、シナリオの形式、delta セクション。MODIFIED / REMOVED の要件はメイン spec と照合します | エラー時は終了コード 1 |
| `spec archive <name> [--force]` | すべてのチェックボックスがチェック済みで、`.my-flow/verify/` 配下に PASS レポートがあることを要求します。delta spec を `specs/` にマージし、変更を `changes/archive/` に移動します | `--force` はゲートをスキップします |
| `spec abandon <name> --reason "..." [--force]` | 完了させない change の第 3 の出口。`proposal.md` に `**Reason**:` 行を持つ `## Abandoned` 節が必要(`--reason` で追記)。change を `changes/archive/<date>-<name>-abandoned/` へ移動し、何もマージしない | すべてチェック済みの change は拒否(`archive` を使う)。クリーンな監査の記録にも使う: `spec new audit-<cap>` の後に `spec abandon audit-<cap> --reason "..."` |
| `spec stage <name> <stage>` | 新しい `updated` タイムスタンプ付きで `.my-flow/state/current-change.json` を書き込みます(`new`、`interview`、`mf-plan`、`execute`、`done`、`archived`) | execute-guard はこのファイルが 12 時間以内の場合にのみ作動します |
| `ask <codex\|claude> [--diff] [--files a,b] [--model m] [--timeout ms] <question>` | もう一方の CLI をアドバイザーとして読み取り専用で実行し、成果物を `.my-flow/ask/` に書き込みます | プロンプトは stdin 経由で渡されます。出力が空の場合は失敗として扱われます |
| `dashboard [start\|stop\|status] [--port N] [--root dir] [--json]` | `specs/`、`changes/`、`.my-flow/` を見るローカル Web ダッシュボード。即時更新と保護付き編集。`stop` は記録されたプロセスを確認してから終了させます | ループバックのみ、既定ポート 4321、依存なし |
| `models [status\|analyze\|apply\|reset] [--json] [--provider claude\|codex] [--dry-run]` | サブエージェントのモデルルーティング: `status` は記録済みの CLI バージョン、ローカルの上書き（またはなし）、インストール済みエージェントファイルから読み戻した値を表示します。`analyze` は利用可能な最も強い CLI にロール -> モデル / effort の割り当てを求め、検証して適用します。`apply` は `~/.my-flow/models.json` からインストール済みファイルを再生成し、`reset` は上書きを削除して `inherit` のベースラインに戻します | 書き込み先は `~/.my-flow/`（`MY_FLOW_HOME`）、`~/.codex/agents/`、インストール済み Claude プラグインの `agents/` のみ。リポジトリには書きません |

## スキル

Claude では `/my-flow:<name>`、Codex では `$my-flow-<name>` として呼び出します。

| スキル | 使うタイミング | 動作 | 出力 |
|---|---|---|---|
| `interview <idea> [--quick] [--change <name>]` | 曖昧なリクエストで、受け入れ基準がない | 1 ラウンドにつき 1 つの質問、詳細より意図を優先。曖昧さをスコアリングし、Non-Goals と Decision Boundaries が明示されたら終了します | `changes/<name>/proposal.md`、トランスクリプトは `.my-flow/interviews/` |
| `mf-plan <name \ | text> [--deliberate] [--fast [--go]]` | 複数ファイルの変更。ビルド設定、シェーダー、エンジンモジュール、マイグレーション、認証に触れるもの. `--fast` では成果物を自分で書き、critic のレビューを 1 回だけ行い、planner も architect も使いません。高リスクのカテゴリ（および `--deliberate` との併用）では拒否され、`--go` はそのまま execute に進みます | planner が下書き → architect がレビュー(`CLEAR / WATCH / BLOCK`)→ critic がレビュー(`OKAY / REJECT`)、最大 3 ラウンド | `design.md`(Do-Not-Touch と Rebuild / Re-run を含む必要があります)、`tasks.md` |
| `execute <name> [--team] [--worktree]` | `tasks.md` に未チェックの項目がある | goal 文を組み立て、タスクごとに実装・検証・チェックを行い、固定の最終ゲートを実行します. `mf-plan --fast --go` から入ることもでき、その場合は `/goal` の停止をスキップします | Claude: 貼り付け用の `/goal …` を表示。Codex: `create_goal` |
| `mf-verify <name \| criteria>` | 「完了」を宣言する前に必ず | 読み取り専用の verifier に委譲し、verifier 自身がチェックを実行して基準ごとに報告します | PASS / FAIL / INCOMPLETE を含む `.my-flow/verify/<name>-<time>.md` |
| `mf-audit <capability \| all>` | `spec status` が `audit suggested` を表示したとき、またはユーザーが「audit the spec」と言ったとき | 読み取り専用の architect が `specs/<cap>/spec.md` をコードとテストと照合: 未実装の要件、文書化されていない挙動、矛盾、置き場所の違う要件を報告。`specs/` は決して編集しない | `Status: CLEAN / DRIFT / BROKEN` と `audit-<cap>` で終わる提案 change 名を含む `.my-flow/verify/audit-<cap>-<time>.md` |
| `ask <codex\|claude> [--diff] [--files] <question>` | 設計へのセカンドオピニオン、最終ゲート前の diff レビュー、計画が行き詰まったときの裁定 | `ask` スクリプトをラップし、要約し、同意するかどうかを述べます | `.my-flow/ask/` |
| `learn [name] [--dry-run]` | セッションでプロジェクト固有の難しい問題を解決した | 3 つの質問による品質ゲートの後、SKILL.md を抽出します | `.claude/skills/` と `.agents/skills/` の両方に書き込まれます |
| `spec new\|status\|validate\|abandon\|archive\|stage` | インテントレイヤーの管理 | `spec` スクリプトをラップし、その出力を解釈します | スクリプトと同じ |
| `dashboard start\|stop\|status` | change をブラウザで追う、提案や spec をターミナル外で編集する | `dashboard` スクリプトを包みます。切り離して起動し URL を表示するか、停止します | `.my-flow/state/dashboard.json` |

`learn` には `disable-model-invocation` が設定されています。呼び出せるのはあなただけです。

### 3 つのフロースキルと組み込み機能の違い

- **`/plan` と `mf-plan`**: プランモードは読み取り専用の権限モードで、プロジェクト外にプランファイルをひとつ書き出して承認を求めます。`mf-plan` は 3 つのロールが順にレビューしたコミット対象の成果物(`design.md`、`tasks.md`)を生成し、必須セクションと、後で `execute` と `mf-verify` を駆動するタスク形式を備えています。探索のために先に `/plan` に入ることは引き続き可能です。 高速レーン `mf-plan --fast` はその中間です。コミットされる成果物と後続フローは同じですが、三役の合意ではなく critic の 1 回のレビューだけです。
- **`run` と `execute`**: 組み込みの `run` はプロジェクトのアプリを起動します。`execute` は Do-Not-Touch と Rebuild のルールのもとで `tasks.md` を回すタスクループで、ネイティブの goal に包まれ、固定の最終ゲート(verify → cleanup → re-verify → independent review → done)で終わります。
- **`verify` と `mf-verify`**: `mf-verify` は常にコンテキストを切り替え(読み取り専用の verifier サブエージェント)、`tasks.md`、spec のシナリオ、`design.md` から基準を導き出し、diff を Do-Not-Touch と照合し、Rebuild の手順が実行されたことを確認し、偽の完了パターンをスキャンし、`spec archive` が要求するレポートを書き出します。

## サブエージェントの役割

| ロール | 本質 | モデル | Codex effort | Codex サンドボックス | 拒否されるツール |
|---|---|---|---|---|---|
| `planner` | 提案を、根拠に基づいた設計とタスクリストに変えます。コードを自分で読み、すべてのタスクにその検証方法を明記します | inherit | high | なし | なし(書き込みは `changes/<name>/` 配下のみ) |
| `architect` | 読み取り専用の設計レビュアー: 反論、緊張、統合。`CLEAR / WATCH / BLOCK` | inherit | high | read-only | Write, Edit |
| `critic` | 推測なしで計画を実行できるかを判断します。2〜3 つのタスクをシミュレーションし、最大 5 つの修正とともに `OKAY / REJECT` を出します | inherit | medium | read-only | Write, Edit |
| `verifier` | 新しい証拠のみ。チェックを自分で実行し、基準ごとにステータスを出します。自分のコンテキストの作業を承認することはありません | inherit | medium | なし（テストを実行できるよう、プロンプトによる読み取り専用のまま） | Write, Edit |

両 CLI ともロールはメインセッションのモデルを継承します（Claude は `model: inherit`、Codex は `model` を省略するので親セッションのモデルが適用されます）。`models` コマンド（CLI コマンドの節）でロールごとにローカルに上書きでき、`models status` が実効値を表示します。

Claude では `my-flow:planner` などとして指定します。Codex は `~/.codex/agents/<name>.toml` からロードします。TOML にはツールの許可リストがないため、読み取り専用は文章(およびヘッドレス時の `-s read-only`)によって強制されます。

## フック

| イベント | スクリプト | 動作 |
|---|---|---|
| SessionStart | `hooks/session-context.mjs` | プロジェクトに `changes/` がある場合、アクティブな変更をチェック済み / 全タスク数と成果物の状態とともに一覧表示します。常に終了コード 0 で終了します. さらに、保留中のモデルルーティングの要約を 1 行だけ 1 回出力し、`MY_FLOW_MODELS_CHECK_HOURS`（既定 1、`0` = 毎回）ごとに最大 1 回、切り離した `models check` を起動します。これは CLI のバージョンを調べ、変わった場合にのみバックグラウンドで分析を実行します。フック自体はモデルを呼びません。ルーティング部分は `MY_FLOW_SKIP_HOOKS=model-routing` で無効化できます. Windows では、`install claude` / `install codex` が登録するスケジュールタスク `my-flow-models-check` 経由でチェックを起動します（タスク スケジューラはフックのジョブオブジェクトの外で実行するため、Codex がジョブを破棄しても生き残ります）。タスクがない、または `schtasks /run` が失敗した場合は切り離した子プロセスにフォールバックします |
| Stop | `hooks/completion-guard.mjs` | 最後のメッセージが完了を宣言しているのに diff に `test.skip`、`.only`、プレースホルダーの TODO、スタブの return がまだ含まれている場合、ブロックして理由を説明します。`execute` 中は、tasks.md に未チェックかつ blocked 未指定のタスクが残っている場合も完了宣言をブロックしますが、状態ファイルが 12 時間以内(`MY_FLOW_EXECUTE_GUARD_TTL_HOURS`)の場合に限ります。完了宣言を含まないメッセージは決してブロックされません |

どちらのスクリプトも Claude(プラグイン内の `hooks/hooks.json` 経由)と Codex(PowerShell シム経由)で共有されます。`MY_FLOW_SKIP_HOOKS=completion-guard`、または `execute-guard`(または `all`)で無効化できます。execute-guard の TTL はデフォルトで 12 時間で、`MY_FLOW_EXECUTE_GUARD_TTL_HOURS` で上書きできます。

## クロスモデルアドバイザー

```bash
node scripts/ask.mjs codex --diff "Review this diff for correctness"
node scripts/ask.mjs claude --files src/a.ts,src/b.ts "Is this abstraction justified?"
```

- プロンプトは常に stdin 経由で渡され(argv は使いません)、もう一方の CLI は読み取り専用(`codex exec -s read-only`、`claude -p --permission-mode plan`)でタイムアウト付きで実行されます。出力が空のまま終了コード 0 で終わった場合は失敗として扱われます。
- 成果物は `.my-flow/ask/<time>-<provider>-<slug>.md` に置かれ、Original task / Final prompt / Raw output / Summary / Action items のセクションを持ちます。
- モデルは `--model` または環境変数 `MY_FLOW_CODEX_MODEL` / `MY_FLOW_CLAUDE_MODEL` で選択します(Codex 設定のモデルが、インストール済み CLI が対応するものより新しい場合に便利です。例: `--model gpt-5.5`)。
- 意見の不一致は証拠またはあなたの判断で解決します。多数決では決して解決しません。

## ダッシュボード

```bash
node scripts/cli.mjs dashboard start                     # http://127.0.0.1:4321/
node scripts/cli.mjs dashboard start --port 4400 --root /path/to/project
node scripts/cli.mjs dashboard status
node scripts/cli.mjs dashboard stop
```

インテントレイヤーをブラウザで見るためのローカル Web ビューです。依存パッケージはゼロで、サーバーは Node の組み込みモジュールのみ、ブラウザ側は手書きの HTML / CSS / JavaScript で、ネットワークからは何も取得しません。`127.0.0.1` にのみバインドし、`Host` や `Origin` が自分自身でないリクエストを拒否するため、他のマシンからも他の Web ページからも到達できません。

- **Changes**: アクティブな change ごとのステージ、タスク進捗、成果物の状態、stale / overlap の警告。各 change は `proposal.md`、`design.md`、`tasks.md` と delta spec を一覧します。
- **Specs**: `specs/<capability>/spec.md` とその要件。`<!-- via: ... -->` マーカーは、その要件を生んだアーカイブ済み change へのリンクになります。
- **Archive**: アーカイブ済み / 放棄済みの change(読み取り専用)。
- **Scratch**: `.my-flow/ask/`、`.my-flow/verify/`、`.my-flow/interviews/`(読み取り専用)。

`specs/`、`changes/`、`.my-flow/` 配下のファイルが変わると、ページは Server-Sent Events で即時に更新されます。ターミナルでタスクをチェックすると、再読み込みなしでブラウザに反映されます。`specs/` 配下とアクティブな `changes/<name>/` 配下の markdown はページ内で編集できます。読み込み後にディスク上のファイルが変わっていた場合、保存は拒否され、ページは新しい内容を表示して「再読み込み」か「上書き」を選ばせます。ファイルの改行コードは保持されます。編集はエージェントが書き込んでいないステージ間の合間を想定しています。

- **テーマ**: サイドバーのテーマドロップダウンはシステムの配色設定を上書きします。選択はブラウザに保存されます。
- **execute 中のロック**: 現在の change がステージ `execute` にある間は、すべての保存が拒否され(HTTP 423)、エディタは Save の代わりに理由を表示します。エージェントが書き込み中だからです。`spec stage` で change が先に進めばロックは自動的に外れます。
- **Diff**: プロジェクトルートが git の作業ツリーであれば、`Diff` 項目が作業ツリーと `HEAD` の差分(ステージ済み、未ステージ、未追跡)をツリーまたはフラットな一覧で示し、選んだファイルのパッチを読み取り専用で表示します。自動更新されるのは `specs/`、`changes/`、`.my-flow/` 配下の編集だけなので、それ以外を編集した後は Refresh ボタンを使ってください。git がなければこの項目は表示されません。最後に変更されたファイルには印が付き、`j` / `k` でファイル間を移動し、`.` でそのファイルへ移動します。

`start` はサーバーを切り離して起動し、`.my-flow/state/dashboard.json` に記録します。`stop` は記録されたプロセスがダッシュボード本体であること(生存しており、`/api/health` が同じ pid と root を返すこと)を確認してから終了させ、古くなった記録は何もシグナルを送らずに片付けます。スキル `/my-flow:dashboard start | stop | status`(Codex: `$my-flow-dashboard`)は同じコマンドを包んでいます。

## インテントレイヤー

```
specs/<capability>/spec.md                 current truth: Requirement + Scenario (WHEN / THEN)
changes/<name>/proposal.md                 why, what, Non-Goals, Decision Boundaries
changes/<name>/design.md                   how; MUST contain ## Do-Not-Touch and ## Rebuild / Re-run After Change
changes/<name>/tasks.md                    ordered checklist; checkboxes are the only progress ledger
changes/<name>/specs/<capability>/spec.md  delta: ## ADDED | MODIFIED | REMOVED Requirements
changes/archive/<date>-<name>/             archived changes (deltas merged into specs/)
changes/.templates/                        templates used by `spec new`
```

Spec 形式:

```markdown
# <capability> Specification

## Purpose
One paragraph.

## Requirements

### Requirement: <name>
The system SHALL ...

#### Scenario: <name>
- **WHEN** <condition>
- **THEN** <expected outcome>
```

ルール: すべての要件には少なくともひとつのシナリオがあること。シナリオにはちょうど 4 つのハッシュ記号を使うこと。delta ファイルでは完全な要件ブロックを `## ADDED Requirements`、`## MODIFIED Requirements`(完全置換)、または `## REMOVED Requirements` の下に置くこと。spec は変更が追加または修正する振る舞いについてのみ書きます。`specs/` は変更がアーカイブされるにつれて埋まっていきます。

`design.md` に 2 つの必須セクションがあるのは、自律ループでは方向の誤りが高くつくからです。`Do-Not-Touch` は変更が修正してはならないモジュールを列挙し、`Rebuild / Re-run After Change` は各編集の後に再生成、再ビルド、クック、再実行が必要なもの(プロジェクトファイル、ビルドターゲット、キャッシュ、テストスイート)を列挙します。`mf-verify` は両方をチェックします。

`--simple` プロジェクトでは、代わりに同じセクションを持つひとつの `docs/changes/<name>.md` を使用します。

## リポジトリ構成と単一ソースでの執筆

```
src/            single source of truth (English): core/core.md, skills/*.md, agents/*.md, rules/*.md
scripts/        build / install / init / spec / ask / cli
hooks/          the two Node hooks + the Codex PowerShell shim
templates/      project blocks (CLAUDE.md / AGENTS.md), change templates, specs README, simple-mode file
skills/ agents/ .claude-plugin/plugin.json   generated: Claude plugin surface
codex/          generated: Codex skills, agent TOMLs, AGENTS.md block, hooks template
claude/         generated: the block installed into ~/.claude/CLAUDE.md
```

`src/` を編集してから `node scripts/build.mjs` を実行します。生成ファイルはコミットされているため、`claude --plugin-dir` にビルド手順は不要です。`node scripts/build.mjs --check` は生成ファイルがソースからずれていると失敗します。`npm test` は `spec.mjs` と Stop フックの組み込み `node --test` スイートを実行します。依存関係は不要です。

ソースの規約:

- `{{ARGS}}` → Claude では `$ARGUMENTS` / Codex では `{{ARGUMENTS}}`
- `{{CALL:mf-plan}}` → Claude では `/my-flow:mf-plan` / Codex では `$my-flow-mf-plan`
- `<!-- MY-FLOW:CLAUDE --> … <!-- /MY-FLOW:CLAUDE -->` は Claude 向けのレンダリングにのみ残されます。`CODEX` も同様です
- スキルごとのツール許可リストとエージェントごとのモデル階層は `manifest.json` にあります
- `src/rules/*.md` はプロジェクトの `CLAUDE.md` / `AGENTS.md` に貼り付けられるルールの断片(コーディングスタイル、テスト、git)です。自動ではインストールされません

## Codex へのインストール

```bash
node scripts/install.mjs codex --dry-run   # see what would change
node scripts/install.mjs codex             # backup, then skills, agents, shim, hooks.json, trusted hashes, AGENTS.md block
node scripts/install.mjs --uninstall codex # reverse
```

Codex がまだフックの信頼を求めてくる場合は、`/hooks` で一度承認してください(上流のハッシュアルゴリズムが変わったときに起こります)。

oh-my-codex がインストールされている場合は、先に次の順序で削除してください。

1. `~/.codex/{config.toml,hooks.json,AGENTS.md,hooks,skills,agents,prompts}` をバックアップします。
2. `omx uninstall --dry-run` を実行して内容を確認し、その後 `omx uninstall` を実行します。
3. `config.toml` に残留物がないか確認します: `notify` 内の `--previous-notify …notify-hook.js` のペア、oh-my-codex に言及する `developer_instructions`、`[shell_environment_policy.set]` 配下の `USE_OMX_EXPLORE_CMD`。`[features] hooks / goals / multi_agent = true` は残します。
4. `npm uninstall -g oh-my-codex` を実行します。
5. `node scripts/install.mjs codex` を実行します。

インストーラーは自分が作成していない `~/.codex/agents/<name>.toml` をスキップするため、他のツールが残したエージェントが上書きされることはありません。

## トラブルシューティング

| 症状 | 原因と対処 |
|---|---|
| `ask codex` が "model requires a newer version of Codex" で失敗する | `~/.codex/config.toml` のモデルが CLI より新しいためです。`codex update` を実行するか、`--model gpt-5.5` を渡す(または `MY_FLOW_CODEX_MODEL` を設定する)ことで対処できます |
| `ask codex` が `EINVAL` で失敗する | `scripts/lib/spawn.mjs` で修正済みです: Windows の `.cmd` シムはシェル経由で実行する必要があります。最新バージョンを実行していることを確認してください |
| `/my-flow:learn` がモデルの一覧に表示されない | 意図した動作です。`disable-model-invocation` が設定されているため、自分で入力してください |
| Stop フックがブロックし続ける | ブロックするのは、最後のメッセージが完了を宣言していて、**かつ** diff に偽の完了マーカーがあるか、現在の変更が `execute` ステージで未チェックのタスクが残っている場合のみです。マーカーを修正するか、タスクを完了または blocked にするか、`spec stage <name> done` を実行してください。`MY_FLOW_SKIP_HOOKS=completion-guard` または `execute-guard` で回避できます |
| execute-guard が作動しない、または古い変更で作動する | `.my-flow/state/current-change.json` を読み、`updated` が 12 時間より古いと無視します。`spec stage <name> execute` で更新するか、`spec stage <name> done` で解除してください |
| `spec archive` が拒否する | すべてのチェックボックスがチェック済みで、`Verdict: PASS` を含むレポートが `.my-flow/verify/` 配下に存在する必要があります。先に `mf-verify` を実行するか、`--force` を使ってその旨を明記してください |
| Codex がフックの信頼を求めてくる | `/hooks` で一度承認してください。信頼済みハッシュの形式が上流で変わった可能性があります |
| Windows での分割ペインのチーム | Claude Code ではサポートされていません。チームはプロセス内で実行されます。tmux ペインを要求しないでください |
| Codex 配下でチェックが完了しない、または `check start` が現れない | `schtasks /query /tn my-flow-models-check` を実行してください。タスクがない場合、または `node scripts/cli.mjs models status` がランチャーのルートや Node が存在しないと示す場合（チェックアウトの移動や Node の更新）、`node scripts/install.mjs claude` または `codex` を再実行して再登録します。Codex では my-flow のフックを `/hooks` で一度信頼してください |
| サブエージェントが想定外のモデルで動く | `node scripts/cli.mjs models status` を実行してください。上書き（あれば）と、インストール済みエージェントファイルから読み戻した `model:` / effort の値を表示します。`models reset` で `inherit` のベースラインに戻り、`~/.my-flow/` の `models.log` にすべてのチェックと分析が記録されます。開発用チェックアウト（`claude --plugin-dir`）は書き換えられず、インストール済みプラグインキャッシュのみが対象です |

## ライセンス

MIT
