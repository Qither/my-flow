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

一个轻量级的工作流层，在 **Claude Code** 和 **Codex CLI** 中以相同的方式工作。它不引入任何运行时，也不依赖任何外部工具。它为你提供：

- 一条四阶段流程：`interview → mf-plan → execute → mf-verify`
- 七个技能和四个子代理角色（其中三个为只读）
- 两个钩子：会话启动时注入当前活跃的变更，停止时拦截虚假的“已完成”声明
- 一个跨模型顾问：Claude 咨询 Codex，Codex 咨询 Claude，始终只读
- 一个**意图层**：`specs/` 保存当前的事实，`changes/<name>/` 保存单个变更的意图。目录结构借鉴自 OpenSpec，但 my-flow 自带 `new / status / validate / archive`，因此并不需要安装 OpenSpec 本身

oh-my-claudecode 和 oh-my-codex 过去所封装的一切（agent teams、`/goal`、worktree、钩子、技能、插件），现在都直接通过两个 CLI 的原生功能来使用。

## 目录

1. [定位](#定位)
2. [环境要求](#环境要求)
3. [快速开始](#快速开始)
4. [核心概念](#核心概念)
5. [CLI 命令](#cli-命令)
6. [技能](#技能)
7. [子代理角色](#子代理角色)
8. [钩子](#钩子)
9. [跨模型顾问](#跨模型顾问)
10. [意图层](#意图层)
11. [仓库结构与单一来源编写](#仓库结构与单一来源编写)
12. [安装到 Codex](#安装到-codex)
13. [故障排查](#故障排查)
14. [许可证](#许可证)

## 定位

| 工具 / 项目 | 角色 |
|---|---|
| Claude Code | 日常交互式开发的主要执行者（原生 agent teams + `/goal`） |
| Codex | 顾问与交叉验证者：审查设计和 diff，在争议时裁决。仅当你显式调用 `$my-flow-execute` 时才负责实现 |
| OpenSpec | 仅借鉴其理念和目录结构（specs / changes / delta specs / tasks.md 复选框）。不使用其 CLI，也没有 `/opsx` 命令 |
| oh-my-claudecode | 可选。my-flow 已经覆盖了跨模型顾问和技能提炼；HUD 请使用 claude-hud |
| oh-my-codex | 不需要。其流程约定已提炼到 `src/core/core.md` 和各技能中 |

## 环境要求

- Node.js 20 或更高版本（脚本和钩子都是纯 Node，无任何依赖）
- Claude 端需要 Claude Code 2.1.x
- Codex 端需要 Codex CLI 0.135 或更高版本（启用 `hooks`、`goals`、`multi_agent` 功能）
- Windows 11 是主要目标平台；一切都无需 tmux 或 WSL。macOS 和 Linux 使用相同的脚本即可运行

## 快速开始

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

然后，在 Claude Code 中依次执行：`/my-flow:interview my-first-change` → `/my-flow:mf-plan my-first-change` → `/my-flow:execute my-first-change` → `/my-flow:mf-verify my-first-change`。

Codex 端是可选的；参见[安装到 Codex](#安装到-codex)。

## 核心概念

### 四个阶段

| 你的需求看起来像 | 应使用的阶段 |
|---|---|
| 具体、单文件、验收标准明确 | 仅 `execute`（或者直接动手做） |
| 具体但涉及多文件或多模块 | `mf-plan → execute → mf-verify` |
| 模糊、没有验收标准、“我们是否应该……” | `interview → mf-plan → execute → mf-verify` |
| 涉及构建配置、着色器、引擎模块、数据迁移、鉴权 | 绝不跳过 `mf-plan` 和 `mf-verify` |

贯穿各阶段的规则：

- `interview` 每轮只问一个问题，只有当非目标（Non-Goals）和决策边界（Decision Boundaries）都明确后才会停止。
- `mf-plan` 从不实现。`execute` 从不重新设计；如果设计有误，就停下来回退。
- `mf-verify` 始终在与编写代码不同的独立上下文中运行。
- `tasks.md` 的复选框是唯一的进度账本。只有在该任务自身的验证通过后，才能勾选对应的复选框。

### 为什么使用 `mf-` 前缀

Claude Code 内置了 `/plan`（计划模式）以及名为 `run` 和 `verify` 的自带技能。插件技能始终带有命名空间（`/my-flow:...`），因此不会覆盖任何东西，但模型是根据名称和描述来挑选技能的。使用不同的名称可以消除歧义：

| 阶段 | 技能 | 为什么不用显而易见的名称 |
|---|---|---|
| 访谈 | `interview` | 无冲突 |
| 计划 | `mf-plan` | 内置的 `/plan` 是计划模式 |
| 执行 | `execute` | 内置技能 `run` 用于启动项目的应用 |
| 验证 | `mf-verify` | 内置技能 `verify` |

### 每个会话只有一个循环主控

在 Claude Code 中，每个会话最多只有一个 `/goal` 和最多一个 agent team。`execute` 会打印出 `/goal` 语句供你粘贴（技能自身无法设置它）。在 Codex 中，每个线程一个 goal；`execute` 仅在没有活跃 goal 时才调用 `create_goal`。

### Claude 与 Codex 各自负责什么

Claude Code 负责交互式工作并运行循环。Codex 负责审查、规划、验证，并回应 `ask` 请求。只有当你显式调用 `$my-flow-execute` 时它才负责实现。两端都不涉及 tmux、团队运行时或状态守护进程。

## CLI 命令

所有命令都是纯 Node 脚本。`node scripts/cli.mjs <command>`（或在 `npm link` 之后使用 `my-flow <command>`）会分发到对应的脚本。

| 命令 | 作用 | 备注 |
|---|---|---|
| `build [--check]` | 将 `src/` 渲染为 Claude 插件和 Codex 界面 | 编辑 `src/` 后运行。`--check` 只做比较，输出过期时以退出码 1 退出 |
| `install claude [--dry-run]` | 备份 `~/.claude/settings.json`，设置 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`，将工作约定写入（upsert）`~/.claude/CLAUDE.md` | 打印插件安装命令，但不执行它们 |
| `install codex [--link] [--dry-run]` | 先备份，然后复制技能和代理 TOML，写入 PowerShell shim，合并 `hooks.json`，将可信哈希写入 `config.toml`，写入（upsert）`~/.codex/AGENTS.md` | `--link` 使用 junction 而非复制 |
| `uninstall codex [--dry-run]` | 撤销 `install codex`，保留 `~/.codex` 中的其他一切 | |
| `init [--simple] [--tools claude,codex] [dir]` | 创建 `specs/`、`changes/`（含 `.templates/` 和 `archive/`）、`specs/README.md`、`.claude/rules/specs.md`、`.my-flow/`，并向项目的 `CLAUDE.md` / `AGENTS.md` 追加一段内容 | `--simple` 切换为每个变更一个 `docs/changes/<name>.md` |
| `spec new <name>` | 从模板创建 `changes/<name>/{proposal,design,tasks}.md` 并将其标记为当前变更 | 名称使用 kebab-case |
| `spec status [name] [--json]` | 已勾选 / 总任务数、工件状态（missing / empty / done）、delta spec 数量 | 未修改过的模板计为 empty |
| `spec validate [name] [--json]` | 结构检查：必需章节、任务行格式、场景格式、delta 章节；MODIFIED / REMOVED 的需求会对照主 spec 检查 | 有错误时以退出码 1 退出 |
| `spec archive <name> [--force]` | 要求所有复选框已勾选且 `.my-flow/verify/` 下存在 PASS 报告；将 delta spec 合并到 `specs/` 并把变更移到 `changes/archive/` | `--force` 跳过该门禁 |
| `ask <codex\|claude> [--diff] [--files a,b] [--model m] [--timeout ms] <question>` | 以只读方式运行另一个 CLI 作为顾问；将工件写入 `.my-flow/ask/` | 提示词通过 stdin 传入；输出为空视为失败 |

## 技能

Claude 以 `/my-flow:<name>` 调用它们，Codex 以 `$my-flow-<name>` 调用。

| 技能 | 何时使用 | 作用 | 输出 |
|---|---|---|---|
| `interview <idea> [--quick] [--change <name>]` | 需求模糊、没有验收标准 | 每轮一个问题，先意图后细节；对模糊度打分；当 Non-Goals 和 Decision Boundaries 明确后退出 | `changes/<name>/proposal.md`，记录保存在 `.my-flow/interviews/` |
| `mf-plan <name \| text> [--deliberate]` | 多文件变更；任何涉及构建配置、着色器、引擎模块、数据迁移、鉴权的改动 | planner 起草 → architect 审查（`CLEAR / WATCH / BLOCK`）→ critic 审查（`OKAY / REJECT`），最多三轮 | `design.md`（必须包含 Do-Not-Touch 和 Rebuild / Re-run）、`tasks.md` |
| `execute <name> [--team] [--worktree]` | `tasks.md` 中还有未勾选的复选框 | 组织 goal 语句；逐个任务实现、验证、勾选；运行固定的最终门禁 | Claude：打印 `/goal …` 供你粘贴。Codex：`create_goal` |
| `mf-verify <name \| criteria>` | 在任何“已完成”声明之前 | 委托给只读的 verifier，由它自行运行检查并逐条标准报告 | `.my-flow/verify/<name>-<time>.md`，包含 PASS / FAIL / INCOMPLETE |
| `ask <codex\|claude> [--diff] [--files] <question>` | 对设计寻求第二意见、最终门禁前的 diff 审查、规划停滞时的裁决 | 封装 `ask` 脚本，做摘要并说明是否同意 | `.my-flow/ask/` |
| `learn [name] [--dry-run]` | 本次会话解决了某个项目特有且困难的问题 | 三问式质量门禁，然后提炼出一个 SKILL.md | 同时写入 `.claude/skills/` 和 `.agents/skills/` |
| `spec new\|status\|validate\|archive` | 管理意图层 | 封装 `spec` 脚本并解读其输出 | 与脚本相同 |

`learn` 设置了 `disable-model-invocation`；只有你才能调用它。

### 三个流程技能与内置功能的区别

- **`/plan` 与 `mf-plan`**：计划模式是一种只读权限模式，它在项目之外写一份计划文件并请求批准。`mf-plan` 生成提交到仓库的工件（`design.md`、`tasks.md`），由三个角色依次审查，带有必需章节和一种任务格式，后续由 `execute` 和 `mf-verify` 据此驱动。你仍然可以先进入 `/plan` 进行探索。
- **`run` 与 `execute`**：内置的 `run` 用于启动项目的应用。`execute` 是在 Do-Not-Touch 和 Rebuild 规则约束下对 `tasks.md` 的任务循环，包裹在原生 goal 之中，以固定的最终门禁收尾（验证 → 清理 → 再次验证 → 独立审查 → 完成）。
- **`verify` 与 `mf-verify`**：`mf-verify` 始终切换上下文（只读的 verifier 子代理），从 `tasks.md`、spec 场景和 `design.md` 推导验收标准，对照 Do-Not-Touch 检查 diff，检查 Rebuild 步骤是否已执行，扫描虚假完成模式，并写出 `spec archive` 所要求的报告。

## 子代理角色

| 角色 | 职责 | Claude 模型 | Codex 推理强度 | 禁用的工具 |
|---|---|---|---|---|
| `planner` | 将提案转化为有证据支撑的设计和任务列表；亲自阅读代码；每个任务都注明其验证方式 | opus | high | 无（仅在 `changes/<name>/` 下写入） |
| `architect` | 只读的设计审查者：反题、张力、综合；`CLEAR / WATCH / BLOCK` | opus | high | Write、Edit |
| `critic` | 判断计划是否无需猜测即可执行；模拟两到三个任务；`OKAY / REJECT`，最多给出五条修正 | sonnet | medium | Write、Edit |
| `verifier` | 只采信新鲜证据；亲自运行检查；逐条标准给出状态；从不批准来自自身上下文的工作 | sonnet | medium | Write、Edit |

Claude 以 `my-flow:planner` 等名称调用它们。Codex 从 `~/.codex/agents/<name>.toml` 加载它们；TOML 没有工具白名单，因此只读是通过提示文字来约束的（无头模式下则通过 `-s read-only`）。

## 钩子

| 事件 | 脚本 | 行为 |
|---|---|---|
| SessionStart | `hooks/session-context.mjs` | 如果项目中存在 `changes/`，列出活跃变更及其已勾选 / 总任务数和工件状态。始终以退出码 0 退出 |
| Stop | `hooks/completion-guard.mjs` | 如果最后一条消息声称已完成，但 diff 中仍包含 `test.skip`、`.only`、占位 TODO 或桩返回值，则拦截并说明原因 |

这两个脚本由 Claude（通过插件中的 `hooks/hooks.json`）和 Codex（通过 PowerShell shim）共用。可用 `MY_FLOW_SKIP_HOOKS=completion-guard`（或 `all`）禁用。

## 跨模型顾问

```bash
node scripts/ask.mjs codex --diff "Review this diff for correctness"
node scripts/ask.mjs claude --files src/a.ts,src/b.ts "Is this abstraction justified?"
```

- 提示词始终通过 stdin 传入（绝不通过 argv），另一个 CLI 以只读方式运行（`codex exec -s read-only`、`claude -p --permission-mode plan`），并带有超时；退出码为 0 但输出为空视为失败。
- 工件保存在 `.my-flow/ask/<time>-<provider>-<slug>.md`，包含 Original task / Final prompt / Raw output / Summary / Action items 几个章节。
- 通过 `--model` 或环境变量 `MY_FLOW_CODEX_MODEL` / `MY_FLOW_CLAUDE_MODEL` 选择模型（当 Codex 配置中的模型比已安装 CLI 所支持的更新时很有用，例如 `--model gpt-5.5`）。
- 分歧由证据或由你来裁决，绝不靠多数表决。

## 意图层

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

规则：每个需求至少有一个场景；场景恰好使用四个井号；delta 文件将完整的需求块放在 `## ADDED Requirements`、`## MODIFIED Requirements`（完整替换）或 `## REMOVED Requirements` 之下。只为变更新增或修改的行为编写 spec；`specs/` 会随着变更的归档而逐渐填充。

`design.md` 中这两个必需章节之所以存在，是因为在自主循环中走错方向的代价很高：`Do-Not-Touch` 列出该变更不得修改的模块，`Rebuild / Re-run After Change` 列出每次编辑后必须重新生成、重新构建、重新烘焙（cook）或重新运行的内容（项目文件、构建目标、缓存、测试套件）。`mf-verify` 会检查这两者。

`--simple` 项目改用一个包含相同章节的 `docs/changes/<name>.md`。

## 仓库结构与单一来源编写

```
src/            single source of truth (English): core/core.md, skills/*.md, agents/*.md, rules/*.md
scripts/        build / install / init / spec / ask / cli
hooks/          the two Node hooks + the Codex PowerShell shim
templates/      project blocks (CLAUDE.md / AGENTS.md), change templates, specs README, simple-mode file
skills/ agents/ .claude-plugin/plugin.json   generated: Claude plugin surface
codex/          generated: Codex skills, agent TOMLs, AGENTS.md block, hooks template
claude/         generated: the block installed into ~/.claude/CLAUDE.md
```

编辑 `src/`，然后运行 `node scripts/build.mjs`。生成的文件已提交到仓库，因此 `claude --plugin-dir` 无需构建步骤；当它们与源码不一致时，`node scripts/build.mjs --check` 会失败。

源码约定：

- `{{ARGS}}` → Claude `$ARGUMENTS` / Codex `{{ARGUMENTS}}`
- `{{CALL:mf-plan}}` → Claude `/my-flow:mf-plan` / Codex `$my-flow-mf-plan`
- `<!-- MY-FLOW:CLAUDE --> … <!-- /MY-FLOW:CLAUDE -->` 只保留在 Claude 的渲染结果中；`CODEX` 同理
- 每个技能的工具白名单和每个代理的模型层级定义在 `manifest.json` 中
- `src/rules/*.md` 是规则片段（编码风格、测试、git），可粘贴到项目的 `CLAUDE.md` / `AGENTS.md` 中；它们不会被自动安装

## 安装到 Codex

```bash
node scripts/install.mjs codex --dry-run   # see what would change
node scripts/install.mjs codex             # backup, then skills, agents, shim, hooks.json, trusted hashes, AGENTS.md block
node scripts/install.mjs --uninstall codex # reverse
```

如果 Codex 仍然要求你信任这些钩子，在 `/hooks` 中批准一次即可（这发生在上游哈希算法变更时）。

如果已安装 oh-my-codex，请先按以下顺序移除它：

1. 备份 `~/.codex/{config.toml,hooks.json,AGENTS.md,hooks,skills,agents,prompts}`。
2. 运行 `omx uninstall --dry-run`，检查后再运行 `omx uninstall`。
3. 检查 `config.toml` 中的残留：`notify` 里的 `--previous-notify …notify-hook.js` 配对、提及 oh-my-codex 的 `developer_instructions`、`[shell_environment_policy.set]` 下的 `USE_OMX_EXPLORE_CMD`。保留 `[features] hooks / goals / multi_agent = true`。
4. `npm uninstall -g oh-my-codex`。
5. `node scripts/install.mjs codex`。

安装程序会跳过任何不是由它创建的 `~/.codex/agents/<name>.toml`，因此其他工具遗留的代理绝不会被覆盖。

## 故障排查

| 症状 | 原因与解决方法 |
|---|---|
| `ask codex` 失败并提示 "model requires a newer version of Codex" | `~/.codex/config.toml` 中的模型比 CLI 更新。运行 `codex update`，或传入 `--model gpt-5.5`（或设置 `MY_FLOW_CODEX_MODEL`） |
| `ask codex` 失败并报 `EINVAL` | 已在 `scripts/lib/spawn.mjs` 中修复：Windows 上的 `.cmd` shim 必须通过 shell 运行。请确保使用的是当前版本 |
| 模型没有列出 `/my-flow:learn` | 这是预期行为。它设置了 `disable-model-invocation`；请自行输入 |
| Stop 钩子一直拦截 | 它只在最后一条消息声称已完成**且** diff 中存在虚假完成标记时才拦截。修复这些标记，或将其作为阻塞项报告。可用 `MY_FLOW_SKIP_HOOKS=completion-guard` 绕过 |
| `spec archive` 拒绝执行 | 所有复选框必须已勾选，且 `.my-flow/verify/` 下必须存在包含 `Verdict: PASS` 的报告。请先运行 `mf-verify`，或使用 `--force` 并明确说明 |
| Codex 要求信任钩子 | 在 `/hooks` 中批准一次；上游的可信哈希格式可能已变更 |
| Windows 上的分屏团队 | Claude Code 不支持；团队在进程内运行。不要请求 tmux 窗格 |

## 许可证

MIT
