# my-flow

同時支援 **Claude Code** 與 **Codex CLI** 的輕量工作流層。不帶任何 runtime、不依賴任何外部工具，只有：

- 一套四階段流程 `interview → blueprint → execute → audit`（skill 名刻意避開內建的 `/plan`、`run`、`verify`）
- 七個 skills、四個唯讀為主的 subagent 角色
- 兩個 hooks（開場注入 change 狀態、結束前擋假完成）
- 一支跨模型顧問腳本（Claude 問 Codex、Codex 問 Claude，皆唯讀）
- 一個「意圖的持久層」：`specs/` 是現況真相、`changes/<name>/{proposal,design,tasks}.md` 是一次變更的意圖。結構借自 OpenSpec，但 my-flow 自己提供 `new / status / validate / archive`，不需要安裝 OpenSpec

它取代的是 oh-my-claudecode / oh-my-codex 裡「包原生功能」的那部分；agent teams、`/goal`、worktree、hooks、skills、plugins 全部直接用兩個 CLI 的原生能力。

## 定位

| 工具 / 專案 | 角色 |
|---|---|
| Claude Code | 日常互動式開發的主 executor（原生 agent teams + `/goal`） |
| Codex | 顧問與交叉驗證：審 design、審 diff、當裁判；只有明確呼叫 `$my-flow-execute` 才實作 |
| OpenSpec | 只借用思想與目錄結構（specs / changes / delta spec / tasks.md 勾選框）；不裝 CLI、不裝 `/opsx` |
| oh-my-claudecode | 選配。my-flow 已補上跨模型顧問與 skill 萃取；HUD 請用 claude-hud |
| oh-my-codex | 不需要。流程精華已抽進 `src/core/core.md` 與 skills |

## 目錄

```
src/            單一真相來源（英文）：core/core.md、skills/*.md、agents/*.md、rules/*.md
scripts/        build / install / init / spec / ask / cli
hooks/          兩個 Node hook + Windows 用的 Codex shim
templates/      專案模板（CLAUDE.md / AGENTS.md 區塊、change 三檔、specs/README.md、簡化版單檔）
skills/ agents/ .claude-plugin/plugin.json   ← 產生：Claude plugin 表面
codex/          ← 產生：Codex skills、agent TOML、AGENTS.md 區塊、hooks 模板
claude/         ← 產生：~/.claude/CLAUDE.md 用的核心區塊
```

`src/` 改完後執行 `node scripts/build.mjs`；`--check` 可在 CI 驗證產物是否同步。
產物一併 commit，`claude --plugin-dir` 不需要 build。

### 單一來源的寫法

- `{{ARGS}}` → Claude `$ARGUMENTS` / Codex `{{ARGUMENTS}}`
- `{{CALL:blueprint}}` → Claude `/my-flow:blueprint` / Codex `$my-flow-blueprint`
- `<!-- MY-FLOW:CLAUDE --> … <!-- /MY-FLOW:CLAUDE -->` 只在 Claude 版保留；`CODEX` 同理
- skill 的工具白名單、agent 的模型層級在 `manifest.json`

## 安裝

### Claude Code

```
node scripts/install.mjs claude        # 備份 settings.json、開 agent teams、寫 ~/.claude/CLAUDE.md 區塊
claude --plugin-dir H:\CommonProject\workflow\VibeCoding\my-flow      # 開發期
claude plugin marketplace add H:\CommonProject\workflow\VibeCoding\my-flow   # 穩定後
claude plugin install my-flow@my-flow
```

### Codex

```
node scripts/install.mjs codex --dry-run   # 先看會動哪些檔
node scripts/install.mjs codex             # 備份後：skills、agents、shim、hooks.json、config.toml 信任雜湊、AGENTS.md 區塊
node scripts/install.mjs --uninstall codex # 反向還原
```

若 Codex 仍要求信任 hooks，進 `/hooks` 核准一次即可（上游雜湊演算法變動時會發生）。

#### 若要移除 oh-my-codex（建議順序）

1. 備份 `~/.codex/{config.toml,hooks.json,AGENTS.md,hooks,skills,agents,prompts}`。
2. `omx uninstall --dry-run`，看清單；再 `omx uninstall`。
3. 手動檢查 `config.toml` 殘留：`notify` 的 `--previous-notify …notify-hook.js`、`developer_instructions` 提到 oh-my-codex、`[shell_environment_policy.set] USE_OMX_EXPLORE_CMD`。保留 `[features] hooks/goals/multi_agent = true`。
4. `npm uninstall -g oh-my-codex`。
5. `node scripts/install.mjs codex`。

### 每個專案

```
node scripts/init.mjs [--simple] [--tools claude,codex] [專案路徑]
```

- 預設建立 `specs/`（含 `README.md` 說明格式）、`changes/`（含 `.templates/` 與 `archive/`）、`.claude/rules/specs.md`，並在專案 `CLAUDE.md` / `AGENTS.md` 追加 `MY-FLOW:PROJECT` 區塊。
- 建 `.my-flow/`（草稿區，已 gitignore）。
- `--simple`：不用 specs/changes，改用 `docs/changes/<name>.md` 單檔。

## 意圖層（specs/ 與 changes/）

```
specs/<capability>/spec.md                 現況真相：Requirement + Scenario（WHEN / THEN）
changes/<name>/proposal.md                 為什麼、改什麼、Non-Goals、Decision Boundaries
changes/<name>/design.md                   怎麼改；必含 ## Do-Not-Touch 與 ## Rebuild / Re-run After Change
changes/<name>/tasks.md                    有序清單；勾選框是唯一進度帳本
changes/<name>/specs/<capability>/spec.md  delta：## ADDED | MODIFIED | REMOVED Requirements
changes/archive/<日期>-<name>/             歸檔（delta 已合併進 specs/）
```

```
node scripts/spec.mjs new <name>        # 從模板建三檔
node scripts/spec.mjs status [name]     # 勾選進度、artifact 狀態
node scripts/spec.mjs validate [name]   # 結構檢查（必要段落、task 格式、scenario 格式）
node scripts/spec.mjs archive <name>    # 全勾且有 PASS 報告才歸檔，並把 delta 合併進 specs/
```

## 使用

| 需求 | 階段 |
|---|---|
| 單檔、明確、有驗收 | 直接 `execute`（或直接做） |
| 多檔但明確 | `blueprint → execute → audit` |
| 模糊、沒驗收條件 | `interview → blueprint → execute → audit` |
| 動到 build 設定、shader、引擎模組、migration、auth | 不可跳過 `blueprint` 與 `audit` |

| 階段 | skill | 為什麼不叫原本的名字 |
|---|---|---|
| 訪談 | `interview` | 無衝突 |
| 規劃 | `blueprint` | Claude 內建 `/plan` 是 plan mode |
| 執行 | `execute` | Claude 內建 skill `run` 是「啟動專案的 app」 |
| 驗證 | `audit` | Claude 內建 skill `verify` |

Claude：`/my-flow:interview`、`/my-flow:blueprint <name>`、`/my-flow:execute <name>`、`/my-flow:audit <name>`、`/my-flow:ask codex --diff "…"`、`/my-flow:learn`、`/my-flow:spec status`。
Codex：同名但寫成 `$my-flow-<skill>`。

`execute` 在 Claude 會印出 `/goal …` 敘述請你貼上（skill 無法自己設 goal），在 Codex 則直接 `create_goal`。最終門檻順序固定：verify → cleanup → re-verify → 獨立 review（`audit`）→ done。

## Hooks

| 事件 | 腳本 | 行為 |
|---|---|---|
| SessionStart | `hooks/session-context.mjs` | 有 `changes/` 時列出進行中的 change、勾選進度與 artifact 狀態；永遠 exit 0 |
| Stop | `hooks/completion-guard.mjs` | 最後一則訊息宣稱完成、但 diff 仍有 `test.skip`/`.only`/佔位 TODO/stub 時阻擋 |

關閉：`MY_FLOW_SKIP_HOOKS=completion-guard`（或 `all`）。

## 跨模型顧問

```
node scripts/ask.mjs codex --diff "Review this diff for correctness"
node scripts/ask.mjs claude --files src/a.ts,src/b.ts "Is this abstraction justified?"
```

prompt 一律經 stdin 餵入、對方 CLI 以唯讀模式執行、有 timeout、空輸出視為失敗；產物在 `.my-flow/ask/`。
模型可用 `--model` 或環境變數 `MY_FLOW_CODEX_MODEL` / `MY_FLOW_CLAUDE_MODEL` 指定（例如 Codex 設定檔預設的模型比目前 CLI 版本新時，改指定 `--model gpt-5.5`）。

`src/rules/*.md` 是可貼進專案 `CLAUDE.md` / `AGENTS.md` 的規則片段（coding style、testing、git），不會自動安裝。

## 授權

MIT
