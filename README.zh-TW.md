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

一個輕量級的工作流程層，在 **Claude Code** 與 **Codex CLI** 中以相同的方式運作。它不引入任何執行階段，也不相依任何外部工具。它為你提供：

- 一條四階段流程：`interview → mf-plan → execute → mf-verify`
- 七個技能與四個子代理角色（其中三個為唯讀）
- 兩個掛鉤：工作階段啟動時注入目前進行中的變更，停止時攔截虛假的「已完成」宣告
- 一個跨模型顧問：Claude 諮詢 Codex，Codex 諮詢 Claude，永遠唯讀
- 一個**意圖層**：`specs/` 保存目前的事實，`changes/<name>/` 保存單一變更的意圖。目錄結構借鑑自 OpenSpec，但 my-flow 自帶 `new / status / validate / archive`，因此不需要安裝 OpenSpec 本身

oh-my-claudecode 與 oh-my-codex 過去所封裝的一切（agent teams、`/goal`、worktree、掛鉤、技能、外掛），現在都直接透過兩個 CLI 的原生功能來使用。

## 目錄

1. [定位](#定位)
2. [環境需求](#環境需求)
3. [快速開始](#快速開始)
4. [核心概念](#核心概念)
5. [CLI 指令](#cli-指令)
6. [技能](#技能)
7. [子代理角色](#子代理角色)
8. [掛鉤](#掛鉤)
9. [跨模型顧問](#跨模型顧問)
10. [意圖層](#意圖層)
11. [儲存庫結構與單一來源撰寫](#儲存庫結構與單一來源撰寫)
12. [安裝到 Codex](#安裝到-codex)
13. [疑難排解](#疑難排解)
14. [授權條款](#授權條款)

## 定位

| 工具 / 專案 | 角色 |
|---|---|
| Claude Code | 日常互動式開發的主要執行者（原生 agent teams + `/goal`） |
| Codex | 顧問與交叉驗證者：審查設計與 diff，在爭議時裁決。僅當你明確呼叫 `$my-flow-execute` 時才負責實作 |
| OpenSpec | 僅借鑑其理念與目錄結構（specs / changes / delta specs / tasks.md 核取方塊）。不使用其 CLI，也沒有 `/opsx` 指令 |
| oh-my-claudecode | 選用。my-flow 已經涵蓋跨模型顧問與技能萃取；HUD 請使用 claude-hud |
| oh-my-codex | 不需要。其流程慣例已萃取到 `src/core/core.md` 與各技能中 |

## 環境需求

- Node.js 20 或更新版本（腳本與掛鉤都是純 Node，沒有任何相依套件）
- Claude 端需要 Claude Code 2.1.x
- Codex 端需要 Codex CLI 0.135 或更新版本（啟用 `hooks`、`goals`、`multi_agent` 功能）
- Windows 11 是主要目標平台；一切都不需要 tmux 或 WSL。macOS 與 Linux 使用相同的腳本即可運作

## 快速開始

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

接著，在 Claude Code 中依序執行：`/my-flow:interview my-first-change` → `/my-flow:mf-plan my-first-change` → `/my-flow:execute my-first-change` → `/my-flow:mf-verify my-first-change`。

Codex 端是選用的；請參閱[安裝到 Codex](#安裝到-codex)。

## 核心概念

### 四個階段

| 你的需求看起來像 | 應使用的階段 |
|---|---|
| 具體、單一檔案、驗收標準明確 | 僅 `execute`（或直接動手做） |
| 具體但涉及多個檔案或多個模組 | `mf-plan → execute → mf-verify` |
| 模糊、沒有驗收標準、「我們是否應該……」 | `interview → mf-plan → execute → mf-verify` |
| 涉及建置設定、著色器、引擎模組、資料遷移、身分驗證 | 絕不跳過 `mf-plan` 與 `mf-verify` |

貫穿各階段的規則：

- `interview` 每回合只問一個問題，只有當非目標（Non-Goals）與決策邊界（Decision Boundaries）都明確後才會停止。
- `mf-plan` 從不實作。`execute` 從不重新設計；如果設計有誤，就停下來回頭修正。
- `mf-verify` 永遠在與撰寫程式碼不同的獨立情境中執行。
- `tasks.md` 的核取方塊是唯一的進度帳本。只有在該任務自身的驗證通過後，才能勾選對應的核取方塊。

### 為什麼使用 `mf-` 前綴

Claude Code 內建了 `/plan`（計畫模式）以及名為 `run` 與 `verify` 的隨附技能。外掛技能永遠帶有命名空間（`/my-flow:...`），因此不會覆寫任何東西，但模型是依據名稱與描述來挑選技能的。使用不同的名稱可以消除歧義：

| 階段 | 技能 | 為什麼不用顯而易見的名稱 |
|---|---|---|
| 訪談 | `interview` | 無衝突 |
| 計畫 | `mf-plan` | 內建的 `/plan` 是計畫模式 |
| 執行 | `execute` | 內建技能 `run` 用於啟動專案的應用程式 |
| 驗證 | `mf-verify` | 內建技能 `verify` |

### 每個工作階段只有一個迴圈主導權

在 Claude Code 中，每個工作階段最多只有一個 `/goal` 與最多一個 agent team。`execute` 會印出 `/goal` 敘述供你貼上（技能本身無法設定它）。在 Codex 中，每個執行緒一個 goal；`execute` 僅在沒有進行中的 goal 時才呼叫 `create_goal`。

### Claude 與 Codex 各自負責什麼

Claude Code 負責互動式工作並執行迴圈。Codex 負責審查、規劃、驗證，並回應 `ask` 請求。只有當你明確呼叫 `$my-flow-execute` 時它才負責實作。兩端都不涉及 tmux、團隊執行階段或狀態常駐程式。

## CLI 指令

所有指令都是純 Node 腳本。`node scripts/cli.mjs <command>`（或在 `npm link` 之後使用 `my-flow <command>`）會分派到對應的腳本。

| 指令 | 作用 | 備註 |
|---|---|---|
| `build [--check]` | 將 `src/` 渲染為 Claude 外掛與 Codex 介面 | 編輯 `src/` 後執行。`--check` 只做比對，輸出過期時以結束代碼 1 結束 |
| `install claude [--dry-run]` | 備份 `~/.claude/settings.json`，設定 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`，將工作約定寫入（upsert）`~/.claude/CLAUDE.md` | 印出外掛安裝指令，但不執行它們 |
| `install codex [--link] [--dry-run]` | 先備份，然後複製技能與代理 TOML，寫入 PowerShell shim，合併 `hooks.json`，將信任雜湊寫入 `config.toml`，寫入（upsert）`~/.codex/AGENTS.md` | `--link` 使用 junction 而非複製 |
| `uninstall codex [--dry-run]` | 還原 `install codex`，保留 `~/.codex` 中的其他一切 | |
| `init [--simple] [--tools claude,codex] [dir]` | 建立 `specs/`、`changes/`（含 `.templates/` 與 `archive/`）、`specs/README.md`、`.claude/rules/specs.md`、`.my-flow/`，並在專案的 `CLAUDE.md` / `AGENTS.md` 末尾附加一段內容 | `--simple` 切換為每個變更一個 `docs/changes/<name>.md` |
| `spec new <name>` | 從範本建立 `changes/<name>/{proposal,design,tasks}.md` 並將其標記為目前變更 | 名稱使用 kebab-case |
| `spec status [name] [--json]` | 已勾選 / 總任務數、產出物狀態（missing / empty / done）、delta spec 數量 | 未修改過的範本計為 empty |
| `spec validate [name] [--json]` | 結構檢查：必要章節、任務行格式、情境格式、delta 章節 | 有錯誤時以結束代碼 1 結束 |
| `spec archive <name> [--force]` | 要求所有核取方塊已勾選且 `.my-flow/verify/` 下存在 PASS 報告；將 delta spec 合併到 `specs/` 並把變更移到 `changes/archive/` | `--force` 跳過該關卡 |
| `ask <codex\|claude> [--diff] [--files a,b] [--model m] [--timeout ms] <question>` | 以唯讀方式執行另一個 CLI 作為顧問；將產出物寫入 `.my-flow/ask/` | 提示詞透過 stdin 傳入；輸出為空視為失敗 |

## 技能

Claude 以 `/my-flow:<name>` 呼叫它們，Codex 以 `$my-flow-<name>` 呼叫。

| 技能 | 何時使用 | 作用 | 輸出 |
|---|---|---|---|
| `interview <idea> [--quick] [--change <name>]` | 需求模糊、沒有驗收標準 | 每回合一個問題，先意圖後細節；對模糊程度評分；當 Non-Goals 與 Decision Boundaries 明確後結束 | `changes/<name>/proposal.md`，逐字記錄保存在 `.my-flow/interviews/` |
| `mf-plan <name \| text> [--deliberate]` | 多檔案變更；任何涉及建置設定、著色器、引擎模組、資料遷移、身分驗證的改動 | planner 起草 → architect 審查（`CLEAR / WATCH / BLOCK`）→ critic 審查（`OKAY / REJECT`），最多三回合 | `design.md`（必須包含 Do-Not-Touch 與 Rebuild / Re-run）、`tasks.md` |
| `execute <name> [--team] [--worktree]` | `tasks.md` 中還有未勾選的核取方塊 | 組織 goal 敘述；逐一任務實作、驗證、勾選；執行固定的最終關卡 | Claude：印出 `/goal …` 供你貼上。Codex：`create_goal` |
| `mf-verify <name \| criteria>` | 在任何「已完成」宣告之前 | 委派給唯讀的 verifier，由它自行執行檢查並逐條標準回報 | `.my-flow/verify/<name>-<time>.md`，包含 PASS / FAIL / INCOMPLETE |
| `ask <codex\|claude> [--diff] [--files] <question>` | 對設計尋求第二意見、最終關卡前的 diff 審查、規劃停滯時的裁決 | 封裝 `ask` 腳本，做摘要並說明是否同意 | `.my-flow/ask/` |
| `learn [name] [--dry-run]` | 本次工作階段解決了某個專案特有且困難的問題 | 三問式品質關卡，然後萃取出一個 SKILL.md | 同時寫入 `.claude/skills/` 與 `.agents/skills/` |
| `spec new\|status\|validate\|archive` | 管理意圖層 | 封裝 `spec` 腳本並解讀其輸出 | 與腳本相同 |

`learn` 設定了 `disable-model-invocation`；只有你才能呼叫它。

### 三個流程技能與內建功能的差異

- **`/plan` 與 `mf-plan`**：計畫模式是一種唯讀權限模式，它在專案之外寫一份計畫檔案並請求核准。`mf-plan` 產生提交到儲存庫的產出物（`design.md`、`tasks.md`），由三個角色依序審查，帶有必要章節與一種任務格式，後續由 `execute` 與 `mf-verify` 據此驅動。你仍然可以先進入 `/plan` 進行探索。
- **`run` 與 `execute`**：內建的 `run` 用於啟動專案的應用程式。`execute` 是在 Do-Not-Touch 與 Rebuild 規則約束下對 `tasks.md` 的任務迴圈，包裹在原生 goal 之中，以固定的最終關卡收尾（驗證 → 清理 → 再次驗證 → 獨立審查 → 完成）。
- **`verify` 與 `mf-verify`**：`mf-verify` 永遠切換情境（唯讀的 verifier 子代理），從 `tasks.md`、spec 情境與 `design.md` 推導驗收標準，對照 Do-Not-Touch 檢查 diff，檢查 Rebuild 步驟是否已執行，掃描虛假完成模式，並寫出 `spec archive` 所要求的報告。

## 子代理角色

| 角色 | 職責 | Claude 模型 | Codex 推理強度 | 禁用的工具 |
|---|---|---|---|---|
| `planner` | 將提案轉化為有證據支撐的設計與任務清單；親自閱讀程式碼；每個任務都註明其驗證方式 | opus | high | 無（僅在 `changes/<name>/` 下寫入） |
| `architect` | 唯讀的設計審查者：反題、張力、綜合；`CLEAR / WATCH / BLOCK` | opus | high | Write、Edit |
| `critic` | 判斷計畫是否無需猜測即可執行；模擬兩到三個任務；`OKAY / REJECT`，最多給出五項修正 | sonnet | medium | Write、Edit |
| `verifier` | 只採信新鮮證據；親自執行檢查；逐條標準給出狀態；從不核准來自自身情境的工作 | sonnet | medium | Write、Edit |

Claude 以 `my-flow:planner` 等名稱呼叫它們。Codex 從 `~/.codex/agents/<name>.toml` 載入它們；TOML 沒有工具允許清單，因此唯讀是透過提示文字來約束的（無頭模式下則透過 `-s read-only`）。

## 掛鉤

| 事件 | 腳本 | 行為 |
|---|---|---|
| SessionStart | `hooks/session-context.mjs` | 如果專案中存在 `changes/`，列出進行中的變更及其已勾選 / 總任務數與產出物狀態。永遠以結束代碼 0 結束 |
| Stop | `hooks/completion-guard.mjs` | 如果最後一則訊息宣稱已完成，但 diff 中仍包含 `test.skip`、`.only`、佔位 TODO 或存根回傳值，則攔截並說明原因 |

這兩個腳本由 Claude（透過外掛中的 `hooks/hooks.json`）與 Codex（透過 PowerShell shim）共用。可用 `MY_FLOW_SKIP_HOOKS=completion-guard`（或 `all`）停用。

## 跨模型顧問

```bash
node scripts/ask.mjs codex --diff "Review this diff for correctness"
node scripts/ask.mjs claude --files src/a.ts,src/b.ts "Is this abstraction justified?"
```

- 提示詞永遠透過 stdin 傳入（絕不透過 argv），另一個 CLI 以唯讀方式執行（`codex exec -s read-only`、`claude -p --permission-mode plan`），並帶有逾時；結束代碼為 0 但輸出為空視為失敗。
- 產出物保存在 `.my-flow/ask/<time>-<provider>-<slug>.md`，包含 Original task / Final prompt / Raw output / Summary / Action items 幾個章節。
- 透過 `--model` 或環境變數 `MY_FLOW_CODEX_MODEL` / `MY_FLOW_CLAUDE_MODEL` 選擇模型（當 Codex 設定中的模型比已安裝 CLI 所支援的更新時很有用，例如 `--model gpt-5.5`）。
- 分歧由證據或由你來裁決，絕不靠多數決。

## 意圖層

```
specs/<capability>/spec.md                 current truth: Requirement + Scenario (WHEN / THEN)
changes/<name>/proposal.md                 why, what, Non-Goals, Decision Boundaries
changes/<name>/design.md                   how; MUST contain ## Do-Not-Touch and ## Rebuild / Re-run After Change
changes/<name>/tasks.md                    ordered checklist; checkboxes are the only progress ledger
changes/<name>/specs/<capability>/spec.md  delta: ## ADDED | MODIFIED | REMOVED Requirements
changes/archive/<date>-<name>/             archived changes (deltas merged into specs/)
changes/.templates/                        templates used by `spec new`
```

Spec 格式：

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

規則：每個需求至少有一個情境；情境恰好使用四個井字號；delta 檔案將完整的需求區塊放在 `## ADDED Requirements`、`## MODIFIED Requirements`（完整取代）或 `## REMOVED Requirements` 之下。只為變更新增或修改的行為撰寫 spec；`specs/` 會隨著變更的封存而逐漸填滿。

`design.md` 中這兩個必要章節之所以存在，是因為在自主迴圈中走錯方向的代價很高：`Do-Not-Touch` 列出該變更不得修改的模組，`Rebuild / Re-run After Change` 列出每次編輯後必須重新產生、重新建置、重新烘焙（cook）或重新執行的內容（專案檔案、建置目標、快取、測試套件）。`mf-verify` 會檢查這兩者。

`--simple` 專案改用一個包含相同章節的 `docs/changes/<name>.md`。

## 儲存庫結構與單一來源撰寫

```
src/            single source of truth (English): core/core.md, skills/*.md, agents/*.md, rules/*.md
scripts/        build / install / init / spec / ask / cli
hooks/          the two Node hooks + the Codex PowerShell shim
templates/      project blocks (CLAUDE.md / AGENTS.md), change templates, specs README, simple-mode file
skills/ agents/ .claude-plugin/plugin.json   generated: Claude plugin surface
codex/          generated: Codex skills, agent TOMLs, AGENTS.md block, hooks template
claude/         generated: the block installed into ~/.claude/CLAUDE.md
```

編輯 `src/`，然後執行 `node scripts/build.mjs`。產生的檔案已提交到儲存庫，因此 `claude --plugin-dir` 不需要建置步驟；當它們與來源不一致時，`node scripts/build.mjs --check` 會失敗。

來源慣例：

- `{{ARGS}}` → Claude `$ARGUMENTS` / Codex `{{ARGUMENTS}}`
- `{{CALL:mf-plan}}` → Claude `/my-flow:mf-plan` / Codex `$my-flow-mf-plan`
- `<!-- MY-FLOW:CLAUDE --> … <!-- /MY-FLOW:CLAUDE -->` 只保留在 Claude 的渲染結果中；`CODEX` 同理
- 每個技能的工具允許清單與每個代理的模型層級定義在 `manifest.json` 中
- `src/rules/*.md` 是規則片段（程式碼風格、測試、git），可貼到專案的 `CLAUDE.md` / `AGENTS.md` 中；它們不會被自動安裝

## 安裝到 Codex

```bash
node scripts/install.mjs codex --dry-run   # see what would change
node scripts/install.mjs codex             # backup, then skills, agents, shim, hooks.json, trusted hashes, AGENTS.md block
node scripts/install.mjs --uninstall codex # reverse
```

如果 Codex 仍然要求你信任這些掛鉤，在 `/hooks` 中核准一次即可（這會在上游雜湊演算法變更時發生）。

如果已安裝 oh-my-codex，請先依下列順序移除它：

1. 備份 `~/.codex/{config.toml,hooks.json,AGENTS.md,hooks,skills,agents,prompts}`。
2. 執行 `omx uninstall --dry-run`，檢視後再執行 `omx uninstall`。
3. 檢查 `config.toml` 中的殘留：`notify` 裡的 `--previous-notify …notify-hook.js` 配對、提及 oh-my-codex 的 `developer_instructions`、`[shell_environment_policy.set]` 下的 `USE_OMX_EXPLORE_CMD`。保留 `[features] hooks / goals / multi_agent = true`。
4. `npm uninstall -g oh-my-codex`。
5. `node scripts/install.mjs codex`。

安裝程式會跳過任何不是由它建立的 `~/.codex/agents/<name>.toml`，因此其他工具遺留的代理絕不會被覆寫。

## 疑難排解

| 症狀 | 原因與解決方法 |
|---|---|
| `ask codex` 失敗並提示 "model requires a newer version of Codex" | `~/.codex/config.toml` 中的模型比 CLI 更新。執行 `codex update`，或傳入 `--model gpt-5.5`（或設定 `MY_FLOW_CODEX_MODEL`） |
| `ask codex` 失敗並回報 `EINVAL` | 已在 `scripts/lib/spawn.mjs` 中修正：Windows 上的 `.cmd` shim 必須透過 shell 執行。請確認你使用的是目前版本 |
| 模型沒有列出 `/my-flow:learn` | 這是預期行為。它設定了 `disable-model-invocation`；請自行輸入 |
| Stop 掛鉤一直攔截 | 它只在最後一則訊息宣稱已完成**且** diff 中存在虛假完成標記時才攔截。修正這些標記，或將其作為阻礙項回報。可用 `MY_FLOW_SKIP_HOOKS=completion-guard` 繞過 |
| `spec archive` 拒絕執行 | 所有核取方塊必須已勾選，且 `.my-flow/verify/` 下必須存在包含 `Verdict: PASS` 的報告。請先執行 `mf-verify`，或使用 `--force` 並明確說明 |
| Codex 要求信任掛鉤 | 在 `/hooks` 中核准一次；上游的信任雜湊格式可能已變更 |
| Windows 上的分割窗格團隊 | Claude Code 不支援；團隊在處理程序內執行。不要要求 tmux 窗格 |

## 授權條款

MIT
