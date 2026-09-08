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

**Claude Code**와 **Codex CLI**에서 동일한 방식으로 동작하는 경량 워크플로 레이어입니다. 런타임을 추가하지 않으며 외부 도구에 의존하지 않습니다. 제공하는 것은 다음과 같습니다.

- 하나의 4단계 플로: `interview → mf-plan → execute → mf-verify`
- 7개의 스킬과 4개의 서브에이전트 역할(그중 3개는 읽기 전용)
- 2개의 훅: 세션 시작 시 활성 변경 사항을 주입하고, 중지 시 거짓 "완료" 주장을 차단합니다
- 크로스 모델 어드바이저: Claude가 Codex에게 묻고, Codex가 Claude에게 묻습니다. 항상 읽기 전용입니다
- **인텐트 레이어**: `specs/`는 현재의 진실을, `changes/<name>/`은 하나의 변경 사항에 대한 의도를 담습니다. 구조는 OpenSpec에서 빌려왔지만, my-flow는 자체 `new / status / validate / archive`를 제공하므로 OpenSpec 자체는 필요하지 않습니다

oh-my-claudecode와 oh-my-codex가 감싸던 모든 것(에이전트 팀, `/goal`, worktree, 훅, 스킬, 플러그인)은 두 CLI의 네이티브 기능을 통해 직접 사용합니다.

## 목차

1. [포지셔닝](#포지셔닝)
2. [요구 사항](#요구-사항)
3. [빠른 시작](#빠른-시작)
4. [개념](#개념)
5. [CLI 명령](#cli-명령)
6. [스킬](#스킬)
7. [서브에이전트 역할](#서브에이전트-역할)
8. [훅](#훅)
9. [크로스 모델 어드바이저](#크로스-모델-어드바이저)
10. [인텐트 레이어](#인텐트-레이어)
11. [저장소 구조와 단일 소스 작성](#저장소-구조와-단일-소스-작성)
12. [Codex에 설치하기](#codex에-설치하기)
13. [문제 해결](#문제-해결)
14. [라이선스](#라이선스)

## 포지셔닝

| 도구 / 프로젝트 | 역할 |
|---|---|
| Claude Code | 일상적인 대화형 개발의 주 실행자(네이티브 에이전트 팀 + `/goal`) |
| Codex | 어드바이저이자 교차 검증자: 설계와 diff를 검토하고, 의견이 갈릴 때 결정을 내립니다. `$my-flow-execute`를 명시적으로 호출할 때만 구현합니다 |
| OpenSpec | 아이디어와 디렉터리 구조(specs / changes / delta specs / tasks.md 체크박스)만 빌려왔습니다. CLI도, `/opsx` 명령도 사용하지 않습니다 |
| oh-my-claudecode | 선택 사항입니다. 크로스 모델 어드바이저와 스킬 추출은 my-flow가 이미 담당합니다. HUD에는 claude-hud를 사용하세요 |
| oh-my-codex | 필요하지 않습니다. 그 플로 규약은 `src/core/core.md`와 스킬에 정제되어 있습니다 |

## 요구 사항

- Node.js 20 이상(스크립트와 훅은 의존성 없는 순수 Node입니다)
- Claude 측에는 Claude Code 2.1.x
- Codex 측에는 Codex CLI 0.135 이상(features의 `hooks`, `goals`, `multi_agent` 활성화)
- 주 대상은 Windows 11이며, tmux나 WSL 없이 모든 것이 동작합니다. macOS와 Linux에서도 같은 스크립트로 동작합니다

## 빠른 시작

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

그런 다음 Claude Code 안에서 `/my-flow:interview my-first-change` → `/my-flow:mf-plan my-first-change` → `/my-flow:execute my-first-change` → `/my-flow:mf-verify my-first-change` 순으로 실행합니다.

Codex 측은 선택 사항입니다. [Codex에 설치하기](#codex에-설치하기)를 참고하세요.

## 개념

### 네 단계

| 요청의 형태 | 사용할 단계 |
|---|---|
| 구체적이고, 단일 파일이며, 인수 기준이 명확함 | `execute`만(또는 바로 수행) |
| 구체적이지만 여러 파일 또는 여러 모듈에 걸침 | `mf-plan → execute → mf-verify` |
| 모호하고, 인수 기준이 없으며, "~해야 할까요" 같은 질문 | `interview → mf-plan → execute → mf-verify` |
| 빌드 설정, 셰이더, 엔진 모듈, 마이그레이션, 인증을 건드림 | `mf-plan`과 `mf-verify`를 절대 건너뛰지 않음 |

모든 단계에 적용되는 규칙:

- `interview`는 한 라운드에 하나의 질문만 하며, 비목표와 결정 경계가 명시되었을 때만 종료합니다.
- `mf-plan`은 절대 구현하지 않습니다. `execute`는 절대 재설계하지 않습니다. 설계가 잘못되었다면 멈추고 이전 단계로 돌아갑니다.
- `mf-verify`는 항상 코드를 작성한 컨텍스트와 분리된 컨텍스트에서 실행됩니다.
- `tasks.md`의 체크박스가 유일한 진행 상황 장부입니다. 체크는 해당 태스크 자체의 검증이 통과한 후에만 합니다.

### `mf-` 접두사를 쓰는 이유

Claude Code에는 내장 `/plan`(플랜 모드)과 `run`, `verify`라는 이름의 번들 스킬이 있습니다. 플러그인 스킬은 항상 네임스페이스가 붙으므로(`/my-flow:...`) 아무것도 덮어쓰이지 않지만, 모델은 이름과 설명으로 스킬을 고릅니다. 서로 다른 이름을 쓰면 모호함이 사라집니다.

| 단계 | 스킬 | 당연해 보이는 이름을 쓰지 않는 이유 |
|---|---|---|
| Interview | `interview` | 충돌 없음 |
| Plan | `mf-plan` | 내장 `/plan`은 플랜 모드 |
| Execute | `execute` | 내장 스킬 `run`은 프로젝트의 앱을 실행함 |
| Verify | `mf-verify` | 내장 스킬 `verify` |

### 세션당 하나의 루프 권한

Claude Code에서는 세션당 `/goal`은 최대 하나, 에이전트 팀도 최대 하나입니다. `execute`는 붙여넣을 수 있도록 `/goal` 문을 출력합니다(스킬은 스스로 설정할 수 없습니다). Codex에서는 스레드당 goal이 하나이며, `execute`는 활성 goal이 없을 때만 `create_goal`을 호출합니다.

### Claude와 Codex가 각각 하는 일

Claude Code는 대화형 작업을 수행하고 루프를 실행합니다. Codex는 검토, 계획, 검증을 수행하고 `ask` 요청에 답합니다. `$my-flow-execute`를 명시적으로 호출할 때만 구현합니다. 어느 쪽에서도 tmux, 팀 런타임, 상태 데몬은 관여하지 않습니다.

## CLI 명령

모든 명령은 순수 Node 스크립트입니다. `node scripts/cli.mjs <command>`(또는 `npm link` 후 `my-flow <command>`)가 각 스크립트로 디스패치합니다.

| 명령 | 하는 일 | 비고 |
|---|---|---|
| `build [--check]` | `src/`를 Claude 플러그인과 Codex 서피스로 렌더링합니다 | `src/`를 편집한 후 실행합니다. `--check`는 비교만 수행하며 출력이 오래되었으면 종료 코드 1로 종료합니다 |
| `install claude [--dry-run]` | `~/.claude/settings.json`을 백업하고, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`을 설정하며, 작업 협약을 `~/.claude/CLAUDE.md`에 upsert합니다 | 플러그인 설치 명령을 출력하지만 실행하지는 않습니다 |
| `install codex [--link] [--dry-run]` | 백업 후 스킬과 에이전트 TOML을 복사하고, PowerShell 심을 작성하고, `hooks.json`을 병합하고, 신뢰 해시를 `config.toml`에 기록하고, `~/.codex/AGENTS.md`를 upsert합니다 | `--link`는 복사 대신 정션을 사용합니다 |
| `uninstall codex [--dry-run]` | `install codex`를 되돌리며, `~/.codex`의 나머지는 모두 보존합니다 | |
| `init [--simple] [--tools claude,codex] [dir]` | `specs/`, `changes/`(`.templates/`와 `archive/` 포함), `specs/README.md`, `.claude/rules/specs.md`, `.my-flow/`를 생성하고 프로젝트의 `CLAUDE.md` / `AGENTS.md`에 블록을 덧붙입니다 | `--simple`은 변경 사항마다 하나의 `docs/changes/<name>.md`를 쓰는 방식으로 전환합니다 |
| `spec new <name>` | 템플릿으로부터 `changes/<name>/{proposal,design,tasks}.md`를 생성하고 현재 변경 사항으로 표시합니다 | kebab-case 이름 |
| `spec status [name] [--json]` | 체크됨 / 전체 태스크 수, 산출물 상태(missing / empty / done), delta spec 개수 | 손대지 않은 템플릿은 empty로 계산됩니다 |
| `spec validate [name] [--json]` | 구조 검사: 필수 섹션, 태스크 줄 형식, 시나리오 형식, delta 섹션 | 오류 시 종료 코드 1 |
| `spec archive <name> [--force]` | 모든 체크박스가 체크되어 있고 `.my-flow/verify/` 아래에 PASS 보고서가 있어야 합니다. delta spec을 `specs/`에 병합하고 변경 사항을 `changes/archive/`로 옮깁니다 | `--force`는 게이트를 건너뜁니다 |
| `ask <codex\|claude> [--diff] [--files a,b] [--model m] [--timeout ms] <question>` | 다른 CLI를 어드바이저로 읽기 전용 실행하고, 산출물을 `.my-flow/ask/`에 기록합니다 | 프롬프트는 stdin으로 전달됩니다. 출력이 비어 있으면 실패로 간주합니다 |

## 스킬

Claude에서는 `/my-flow:<name>`으로, Codex에서는 `$my-flow-<name>`으로 호출합니다.

| 스킬 | 언제 | 하는 일 | 출력 |
|---|---|---|---|
| `interview <idea> [--quick] [--change <name>]` | 모호한 요청, 인수 기준 없음 | 한 라운드에 하나의 질문, 세부 사항보다 의도 우선. 모호성을 점수화하고 Non-Goals와 Decision Boundaries가 명시되면 종료합니다 | `changes/<name>/proposal.md`, 대화 기록은 `.my-flow/interviews/` |
| `mf-plan <name \| text> [--deliberate]` | 여러 파일에 걸친 변경. 빌드 설정, 셰이더, 엔진 모듈, 마이그레이션, 인증을 건드리는 모든 것 | planner가 초안 작성 → architect가 검토(`CLEAR / WATCH / BLOCK`) → critic이 검토(`OKAY / REJECT`), 최대 3라운드 | `design.md`(Do-Not-Touch와 Rebuild / Re-run을 반드시 포함), `tasks.md` |
| `execute <name> [--team] [--worktree]` | `tasks.md`에 체크되지 않은 항목이 있음 | goal 문을 구성하고, 태스크 하나씩 구현·검증·체크하며, 고정된 최종 게이트를 실행합니다 | Claude: 붙여넣을 `/goal …`을 출력. Codex: `create_goal` |
| `mf-verify <name \| criteria>` | "완료"를 주장하기 전에 항상 | 읽기 전용 verifier에 위임하며, verifier가 직접 검사를 실행하고 기준별로 보고합니다 | PASS / FAIL / INCOMPLETE가 담긴 `.my-flow/verify/<name>-<time>.md` |
| `ask <codex\|claude> [--diff] [--files] <question>` | 설계에 대한 2차 의견, 최종 게이트 전 diff 검토, 계획이 막혔을 때의 결정 | `ask` 스크립트를 감싸고, 요약하며, 동의 여부를 밝힙니다 | `.my-flow/ask/` |
| `learn [name] [--dry-run]` | 세션에서 프로젝트 고유의 어려운 문제를 해결했음 | 세 가지 질문의 품질 게이트를 거친 뒤 SKILL.md를 추출합니다 | `.claude/skills/`와 `.agents/skills/` 모두에 기록됩니다 |
| `spec new\|status\|validate\|archive` | 인텐트 레이어 관리 | `spec` 스크립트를 감싸고 그 출력을 해석합니다 | 스크립트와 동일 |

`learn`에는 `disable-model-invocation`이 설정되어 있습니다. 오직 사용자만 호출할 수 있습니다.

### 세 플로 스킬이 내장 기능과 다른 점

- **`/plan` vs `mf-plan`**: 플랜 모드는 읽기 전용 권한 모드로, 프로젝트 밖에 플랜 파일 하나를 작성하고 승인을 요청합니다. `mf-plan`은 세 역할이 순서대로 검토한, 커밋되는 산출물(`design.md`, `tasks.md`)을 만들어내며, 필수 섹션과 이후 `execute` 및 `mf-verify`를 구동하는 태스크 형식을 갖춥니다. 탐색을 위해 먼저 `/plan`에 들어가는 것은 여전히 가능합니다.
- **`run` vs `execute`**: 내장 `run`은 프로젝트의 앱을 실행합니다. `execute`는 Do-Not-Touch와 Rebuild 규칙 아래에서 `tasks.md`를 순회하는 태스크 루프로, 네이티브 goal로 감싸지며 고정된 최종 게이트(verify → cleanup → re-verify → independent review → done)로 끝납니다.
- **`verify` vs `mf-verify`**: `mf-verify`는 항상 컨텍스트를 전환하고(읽기 전용 verifier 서브에이전트), `tasks.md`, spec 시나리오, `design.md`에서 기준을 도출하며, diff를 Do-Not-Touch와 대조하고, Rebuild 단계가 실행되었는지 확인하고, 거짓 완료 패턴을 스캔하며, `spec archive`가 요구하는 보고서를 작성합니다.

## 서브에이전트 역할

| 역할 | 핵심 | Claude 모델 | Codex effort | 거부되는 도구 |
|---|---|---|---|---|
| `planner` | 제안을 근거에 기반한 설계와 태스크 목록으로 바꿉니다. 코드를 직접 읽으며, 모든 태스크에 검증 방법을 명시합니다 | opus | high | 없음(`changes/<name>/` 아래에만 씁니다) |
| `architect` | 읽기 전용 설계 검토자: 반론, 긴장, 종합. `CLEAR / WATCH / BLOCK` | opus | high | Write, Edit |
| `critic` | 추측 없이 계획을 실행할 수 있는지 판단합니다. 두세 개의 태스크를 시뮬레이션하고, 최대 다섯 개의 수정 사항과 함께 `OKAY / REJECT`를 냅니다 | sonnet | medium | Write, Edit |
| `verifier` | 새로운 증거만 사용합니다. 검사를 직접 실행하고, 기준별 상태를 냅니다. 자기 컨텍스트의 작업은 절대 승인하지 않습니다 | sonnet | medium | Write, Edit |

Claude에서는 `my-flow:planner` 등으로 지정합니다. Codex는 `~/.codex/agents/<name>.toml`에서 로드합니다. TOML에는 도구 허용 목록이 없으므로 읽기 전용은 문장(그리고 헤드리스일 때는 `-s read-only`)으로 강제됩니다.

## 훅

| 이벤트 | 스크립트 | 동작 |
|---|---|---|
| SessionStart | `hooks/session-context.mjs` | 프로젝트에 `changes/`가 있으면 활성 변경 사항을 체크됨 / 전체 태스크 수와 산출물 상태와 함께 나열합니다. 항상 종료 코드 0으로 종료합니다 |
| Stop | `hooks/completion-guard.mjs` | 마지막 메시지가 완료를 주장하지만 diff에 여전히 `test.skip`, `.only`, 자리표시자 TODO, 스텁 return이 들어 있으면 차단하고 이유를 설명합니다 |

두 스크립트 모두 Claude(플러그인의 `hooks/hooks.json` 경유)와 Codex(PowerShell 심 경유)가 공유합니다. `MY_FLOW_SKIP_HOOKS=completion-guard`(또는 `all`)로 비활성화할 수 있습니다.

## 크로스 모델 어드바이저

```bash
node scripts/ask.mjs codex --diff "Review this diff for correctness"
node scripts/ask.mjs claude --files src/a.ts,src/b.ts "Is this abstraction justified?"
```

- 프롬프트는 항상 stdin으로 전달되며(argv는 절대 사용하지 않음), 다른 CLI는 읽기 전용(`codex exec -s read-only`, `claude -p --permission-mode plan`)으로 타임아웃과 함께 실행됩니다. 출력이 비어 있는 채로 종료 코드 0이면 실패로 간주합니다.
- 산출물은 `.my-flow/ask/<time>-<provider>-<slug>.md`에 저장되며 Original task / Final prompt / Raw output / Summary / Action items 섹션을 갖습니다.
- 모델은 `--model` 또는 환경 변수 `MY_FLOW_CODEX_MODEL` / `MY_FLOW_CLAUDE_MODEL`로 선택합니다(Codex 설정의 모델이 설치된 CLI가 지원하는 것보다 새로울 때 유용합니다. 예: `--model gpt-5.5`).
- 의견 불일치는 증거 또는 사용자의 판단으로 해결하며, 다수결로는 절대 해결하지 않습니다.

## 인텐트 레이어

```
specs/<capability>/spec.md                 current truth: Requirement + Scenario (WHEN / THEN)
changes/<name>/proposal.md                 why, what, Non-Goals, Decision Boundaries
changes/<name>/design.md                   how; MUST contain ## Do-Not-Touch and ## Rebuild / Re-run After Change
changes/<name>/tasks.md                    ordered checklist; checkboxes are the only progress ledger
changes/<name>/specs/<capability>/spec.md  delta: ## ADDED | MODIFIED | REMOVED Requirements
changes/archive/<date>-<name>/             archived changes (deltas merged into specs/)
changes/.templates/                        templates used by `spec new`
```

Spec 형식:

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

규칙: 모든 요구 사항에는 최소 하나의 시나리오가 있어야 합니다. 시나리오는 정확히 네 개의 해시 기호를 사용합니다. delta 파일은 전체 요구 사항 블록을 `## ADDED Requirements`, `## MODIFIED Requirements`(전체 교체), 또는 `## REMOVED Requirements` 아래에 둡니다. spec은 변경 사항이 추가하거나 수정하는 동작에 대해서만 작성합니다. `specs/`는 변경 사항이 아카이브됨에 따라 채워집니다.

`design.md`에 두 개의 필수 섹션이 있는 이유는 자율 루프에서는 잘못된 방향이 큰 비용을 치르기 때문입니다. `Do-Not-Touch`는 변경 사항이 수정해서는 안 되는 모듈을 명시하고, `Rebuild / Re-run After Change`는 각 편집 후 재생성, 재빌드, 쿡, 재실행이 필요한 것(프로젝트 파일, 빌드 타깃, 캐시, 테스트 스위트)을 명시합니다. `mf-verify`는 둘 다 검사합니다.

`--simple` 프로젝트는 대신 같은 섹션을 가진 하나의 `docs/changes/<name>.md`를 사용합니다.

## 저장소 구조와 단일 소스 작성

```
src/            single source of truth (English): core/core.md, skills/*.md, agents/*.md, rules/*.md
scripts/        build / install / init / spec / ask / cli
hooks/          the two Node hooks + the Codex PowerShell shim
templates/      project blocks (CLAUDE.md / AGENTS.md), change templates, specs README, simple-mode file
skills/ agents/ .claude-plugin/plugin.json   generated: Claude plugin surface
codex/          generated: Codex skills, agent TOMLs, AGENTS.md block, hooks template
claude/         generated: the block installed into ~/.claude/CLAUDE.md
```

`src/`를 편집한 뒤 `node scripts/build.mjs`를 실행합니다. 생성된 파일은 커밋되어 있으므로 `claude --plugin-dir`에는 빌드 단계가 필요 없습니다. `node scripts/build.mjs --check`는 생성 파일이 소스와 어긋나면 실패합니다.

소스 규약:

- `{{ARGS}}` → Claude `$ARGUMENTS` / Codex `{{ARGUMENTS}}`
- `{{CALL:mf-plan}}` → Claude `/my-flow:mf-plan` / Codex `$my-flow-mf-plan`
- `<!-- MY-FLOW:CLAUDE --> … <!-- /MY-FLOW:CLAUDE -->`는 Claude 렌더링에만 남습니다. `CODEX`도 마찬가지입니다
- 스킬별 도구 허용 목록과 에이전트별 모델 티어는 `manifest.json`에 있습니다
- `src/rules/*.md`는 프로젝트의 `CLAUDE.md` / `AGENTS.md`에 붙여넣을 수 있는 규칙 조각(코딩 스타일, 테스트, git)입니다. 자동으로 설치되지는 않습니다

## Codex에 설치하기

```bash
node scripts/install.mjs codex --dry-run   # see what would change
node scripts/install.mjs codex             # backup, then skills, agents, shim, hooks.json, trusted hashes, AGENTS.md block
node scripts/install.mjs --uninstall codex # reverse
```

Codex가 여전히 훅을 신뢰할지 묻는다면 `/hooks`에서 한 번 승인하세요(업스트림 해시 알고리즘이 바뀌면 발생합니다).

oh-my-codex가 설치되어 있다면 먼저 다음 순서로 제거하세요.

1. `~/.codex/{config.toml,hooks.json,AGENTS.md,hooks,skills,agents,prompts}`를 백업합니다.
2. `omx uninstall --dry-run`을 실행해 검토한 뒤 `omx uninstall`을 실행합니다.
3. `config.toml`에 남은 항목이 있는지 확인합니다: `notify`의 `--previous-notify …notify-hook.js` 쌍, oh-my-codex를 언급하는 `developer_instructions`, `[shell_environment_policy.set]` 아래의 `USE_OMX_EXPLORE_CMD`. `[features] hooks / goals / multi_agent = true`는 유지합니다.
4. `npm uninstall -g oh-my-codex`를 실행합니다.
5. `node scripts/install.mjs codex`를 실행합니다.

설치 프로그램은 자신이 만들지 않은 `~/.codex/agents/<name>.toml`을 건너뛰므로, 다른 도구가 남긴 에이전트는 절대 덮어쓰이지 않습니다.

## 문제 해결

| 증상 | 원인과 해결 |
|---|---|
| `ask codex`가 "model requires a newer version of Codex"로 실패함 | `~/.codex/config.toml`의 모델이 CLI보다 새롭습니다. `codex update`를 실행하거나 `--model gpt-5.5`를 전달하세요(또는 `MY_FLOW_CODEX_MODEL`을 설정하세요) |
| `ask codex`가 `EINVAL`로 실패함 | `scripts/lib/spawn.mjs`에서 수정되었습니다: Windows의 `.cmd` 심은 셸을 거쳐야 합니다. 최신 버전을 실행하고 있는지 확인하세요 |
| 모델이 `/my-flow:learn`을 나열하지 않음 | 의도된 동작입니다. `disable-model-invocation`이 설정되어 있으므로 직접 입력하세요 |
| Stop 훅이 계속 차단함 | 마지막 메시지가 완료를 주장하고 **동시에** diff에 거짓 완료 마커가 있을 때만 차단합니다. 이를 수정하거나 블로커로 보고하세요. `MY_FLOW_SKIP_HOOKS=completion-guard`로 우회할 수 있습니다 |
| `spec archive`가 거부함 | 모든 체크박스가 체크되어 있어야 하고 `Verdict: PASS`를 포함한 보고서가 `.my-flow/verify/` 아래에 있어야 합니다. 먼저 `mf-verify`를 실행하거나, `--force`를 사용하고 그 사실을 밝히세요 |
| Codex가 훅을 신뢰할지 물어봄 | `/hooks`에서 한 번 승인하세요. 신뢰 해시 형식이 업스트림에서 바뀌었을 수 있습니다 |
| Windows에서의 분할 창 팀 | Claude Code에서 지원하지 않습니다. 팀은 프로세스 내에서 실행됩니다. tmux 창을 요청하지 마세요 |

## 라이선스

MIT
