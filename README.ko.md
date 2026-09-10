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
10. [대시보드](#대시보드)
11. [인텐트 레이어](#인텐트-레이어)
12. [저장소 구조와 단일 소스 작성](#저장소-구조와-단일-소스-작성)
13. [Codex에 설치하기](#codex에-설치하기)
14. [문제 해결](#문제-해결)
15. [라이선스](#라이선스)

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
| 구체적, 여러 파일, 설계는 이미 명확 | `mf-plan --fast [--go] → execute → mf-verify` |
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

Claude Code에서는 세션당 `/goal`은 최대 하나, 에이전트 팀도 최대 하나입니다. `execute`는 붙여넣을 수 있도록 `/goal` 문을 출력합니다(스킬은 스스로 설정할 수 없습니다). Stop 훅은 백스톱일 뿐이며, `execute` 중에 체크되지 않은 작업을 남긴 완료 주장만, 그것도 `spec stage`가 쓴 상태가 신선한 동안에만 차단합니다. Codex에서는 스레드당 goal이 하나이며, `execute`는 활성 goal이 없을 때만 `create_goal`을 호출합니다. `mf-plan --fast --go`에서 진입한 실행도 `/goal` 붙여넣기를 위해 한 번 멈춥니다.

### Claude와 Codex가 각각 하는 일

Claude Code는 대화형 작업을 수행하고 루프를 실행합니다. Codex는 검토, 계획, 검증을 수행하고 `ask` 요청에 답합니다. `$my-flow-execute`를 명시적으로 호출할 때만 구현합니다. 어느 쪽에서도 tmux, 팀 런타임, 상태 데몬은 관여하지 않습니다.

## CLI 명령

모든 명령은 순수 Node 스크립트입니다. `node scripts/cli.mjs <command>`(또는 `npm link` 후 `my-flow <command>`)가 각 스크립트로 디스패치합니다.

| 명령 | 하는 일 | 비고 |
|---|---|---|
| `build [--check]` | `src/`를 Claude 플러그인과 Codex 서피스로 렌더링합니다 | `src/`를 편집한 후 실행합니다. `--check`는 비교만 수행하며 출력이 오래되었으면 종료 코드 1로 종료합니다 |
| `install claude [--dry-run]` | `~/.claude/settings.json`을 백업하고, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`을 설정하며, 작업 협약을 `~/.claude/CLAUDE.md`에 upsert합니다. Windows에서는 예약 작업 `my-flow-models-check`(`conhost.exe --headless node scripts/models.mjs check --quiet --home <MY_FLOW_HOME>`)도 등록하고 도구 홈을 `~/.my-flow/config.json`에 기록합니다 | 플러그인 설치 명령을 출력하지만 실행하지는 않습니다 |
| `install codex [--link] [--dry-run]` | 백업 후 스킬과 에이전트 TOML을 복사하고, PowerShell 심을 작성하고, `hooks.json`을 병합하고, 신뢰 해시를 `config.toml`에 기록하고, `~/.codex/AGENTS.md`를 upsert합니다. Windows에서는 예약 작업 `my-flow-models-check`도 등록하고 도구 홈과 에이전트 디렉터리를 `~/.my-flow/config.json`에 기록합니다 | `--link`는 복사 대신 정션을 사용합니다 |
| `uninstall codex [--dry-run]` | `install codex`를 되돌리며, `~/.codex`의 나머지는 모두 보존합니다. `~/.my-flow/config.json`에서 Codex 홈을 제거합니다. 다른 표면이 남아 있지 않을 때만 예약 작업 `my-flow-models-check`를 삭제합니다 |  |
| `init [--simple] [--tools claude,codex] [dir]` | `specs/`, `changes/`(`.templates/`와 `archive/` 포함), `specs/README.md`, `.claude/rules/specs.md`, `.my-flow/`를 생성하고 프로젝트의 `CLAUDE.md` / `AGENTS.md`에 블록을 덧붙입니다 | `--simple`은 변경 사항마다 하나의 `docs/changes/<name>.md`를 쓰는 방식으로 전환합니다 |
| `spec new <name>` | 템플릿으로부터 `changes/<name>/{proposal,design,tasks}.md`를 생성하고 현재 변경 사항으로 표시합니다 | kebab-case 이름 |
| `spec status [name] [--json]` | 체크됨 / 전체 태스크 수, 산출물 상태(missing / empty / done), delta spec 개수; 14일 동안 손대지 않은 미완료 change에 `[stale Nd]` 표시(`--stale-days`, `MY_FLOW_STALE_DAYS`), 두 change가 같은 요구사항을 주장하면 `overlap:`, capability에 5회 머지되면 `audit suggested:`(`MY_FLOW_AUDIT_EVERY`) | 손대지 않은 템플릿은 empty로 계산됩니다 |
| `spec validate [name] [--json]` | 구조 검사: 필수 섹션, 태스크 줄 형식, 시나리오 형식, delta 섹션. MODIFIED / REMOVED 요구사항은 메인 spec과 대조합니다 | 오류 시 종료 코드 1 |
| `spec archive <name> [--force]` | 모든 체크박스가 체크되어 있고 `.my-flow/verify/` 아래에 PASS 보고서가 있어야 합니다. delta spec을 `specs/`에 병합하고 변경 사항을 `changes/archive/`로 옮깁니다 | `--force`는 게이트를 건너뜁니다 |
| `spec abandon <name> --reason "..." [--force]` | 끝내지 않을 change의 세 번째 출구. `proposal.md`에 `**Reason**:` 줄이 있는 `## Abandoned` 섹션이 필요(`--reason`으로 추가). change를 `changes/archive/<date>-<name>-abandoned/`로 옮기고 아무것도 머지하지 않음 | 모든 체크박스가 체크된 change는 거부(`archive` 사용). 깨끗한 감사 기록에도 사용: `spec new audit-<cap>` 후 `spec abandon audit-<cap> --reason "..."` |
| `spec stage <name> <stage>` | 새 `updated` 타임스탬프와 함께 `.my-flow/state/current-change.json`을 씁니다(`new`, `interview`, `mf-plan`, `execute`, `done`, `archived`) | execute-guard는 이 파일이 12시간 이내일 때만 작동합니다 |
| `ask <codex\|claude> [--diff] [--files a,b] [--model m] [--timeout ms] <question>` | 다른 CLI를 어드바이저로 읽기 전용 실행하고, 산출물을 `.my-flow/ask/`에 기록합니다 | 프롬프트는 stdin으로 전달됩니다. 출력이 비어 있으면 실패로 간주합니다 |
| `dashboard [start\|stop\|status] [--port N] [--root dir] [--json]` | `specs/`, `changes/`, `.my-flow/`를 보는 로컬 웹 대시보드. 즉시 갱신과 보호된 편집. `stop`은 기록된 프로세스를 확인한 뒤 종료합니다 | 루프백 전용, 기본 포트 4321, 의존성 없음 |
| `models [status\|analyze\|apply\|reset] [--json] [--provider claude\|codex] [--dry-run]` | 서브에이전트 모델 라우팅: `status`는 기록된 CLI 버전, 로컬 덮어쓰기(또는 없음), 설치된 에이전트 파일에서 읽어 온 값을 보여줍니다. `analyze`는 사용 가능한 가장 강한 CLI에 역할 -> 모델 / effort 매핑을 요청해 검증하고 적용합니다. `apply`는 `~/.my-flow/models.json`으로 설치된 파일을 다시 렌더링하고, `reset`은 덮어쓰기를 삭제해 `inherit` 기준선으로 되돌립니다 | `~/.my-flow/`(`MY_FLOW_HOME`), `~/.codex/agents/`, 설치된 Claude 플러그인의 `agents/`에만 씁니다. 저장소에는 쓰지 않습니다 |

## 스킬

Claude에서는 `/my-flow:<name>`으로, Codex에서는 `$my-flow-<name>`으로 호출합니다.

| 스킬 | 언제 | 하는 일 | 출력 |
|---|---|---|---|
| `interview <idea> [--quick] [--change <name>]` | 모호한 요청, 인수 기준 없음 | 한 라운드에 하나의 질문, 세부 사항보다 의도 우선. 모호성을 점수화하고 Non-Goals와 Decision Boundaries가 명시되면 종료합니다 | `changes/<name>/proposal.md`, 대화 기록은 `.my-flow/interviews/` |
| `mf-plan <name \ | text> [--deliberate] [--fast [--go]]` | 여러 파일에 걸친 변경. 빌드 설정, 셰이더, 엔진 모듈, 마이그레이션, 인증을 건드리는 모든 것. `--fast`에서는 산출물을 직접 작성하고 critic 검토를 한 번만 거치며 planner와 architect는 쓰지 않습니다. 고위험 범주(및 `--deliberate`와의 병용)에서는 거부되고, `--go`는 바로 execute로 이어집니다 | planner가 초안 작성 → architect가 검토(`CLEAR / WATCH / BLOCK`) → critic이 검토(`OKAY / REJECT`), 최대 3라운드 | `design.md`(Do-Not-Touch와 Rebuild / Re-run을 반드시 포함), `tasks.md` |
| `execute <name> [--team] [--worktree]` | `tasks.md`에 체크되지 않은 항목이 있음 | goal 문을 구성하고, 태스크 하나씩 구현·검증·체크하며, 고정된 최종 게이트를 실행합니다. `mf-plan --fast --go`에서 진입할 수도 있으며, 이때도 `/goal` 붙여넣기를 위해 한 번 멈춥니다 | Claude: 붙여넣을 `/goal …`을 출력. Codex: `create_goal` |
| `mf-verify <name \| criteria>` | "완료"를 주장하기 전에 항상 | 읽기 전용 verifier에 위임하며, verifier가 직접 검사를 실행하고 기준별로 보고합니다 | PASS / FAIL / INCOMPLETE가 담긴 `.my-flow/verify/<name>-<time>.md` |
| `mf-audit <capability \| all>` | `spec status`가 `audit suggested`를 출력할 때, 또는 사용자가 "audit the spec"이라고 말할 때 | 읽기 전용 architect가 `specs/<cap>/spec.md`를 코드와 테스트에 대조: 미구현 요구사항, 문서화되지 않은 동작, 모순, 잘못 배치된 요구사항. `specs/`는 절대 편집하지 않음 | `Status: CLEAN / DRIFT / BROKEN`과 `audit-<cap>`으로 끝나는 제안 change 이름이 담긴 `.my-flow/verify/audit-<cap>-<time>.md` |
| `ask <codex\|claude> [--diff] [--files] <question>` | 설계에 대한 2차 의견, 최종 게이트 전 diff 검토, 계획이 막혔을 때의 결정 | `ask` 스크립트를 감싸고, 요약하며, 동의 여부를 밝힙니다 | `.my-flow/ask/` |
| `learn [name] [--dry-run]` | 세션에서 프로젝트 고유의 어려운 문제를 해결했음 | 세 가지 질문의 품질 게이트를 거친 뒤 SKILL.md를 추출합니다 | `.claude/skills/`와 `.agents/skills/` 모두에 기록됩니다 |
| `spec new\|status\|validate\|abandon\|archive\|stage` | 인텐트 레이어 관리 | `spec` 스크립트를 감싸고 그 출력을 해석합니다 | 스크립트와 동일 |
| `dashboard start\|stop\|status` | change를 브라우저에서 지켜보기, 제안이나 spec을 터미널 밖에서 편집하기 | `dashboard` 스크립트를 감쌉니다. 분리해서 띄우고 URL을 출력하거나, 멈춥니다 | `.my-flow/state/dashboard.json` |

`learn`에는 `disable-model-invocation`이 설정되어 있습니다. 오직 사용자만 호출할 수 있습니다.

### 세 플로 스킬이 내장 기능과 다른 점

- **`/plan` vs `mf-plan`**: 플랜 모드는 읽기 전용 권한 모드로, 프로젝트 밖에 플랜 파일 하나를 작성하고 승인을 요청합니다. `mf-plan`은 세 역할이 순서대로 검토한, 커밋되는 산출물(`design.md`, `tasks.md`)을 만들어내며, 필수 섹션과 이후 `execute` 및 `mf-verify`를 구동하는 태스크 형식을 갖춥니다. 탐색을 위해 먼저 `/plan`에 들어가는 것은 여전히 가능합니다. 빠른 경로 `mf-plan --fast`는 그 중간에 있습니다. 커밋되는 산출물과 후속 흐름은 같지만, 세 역할의 합의 대신 critic 검토 한 번만 거칩니다.
- **`run` vs `execute`**: 내장 `run`은 프로젝트의 앱을 실행합니다. `execute`는 Do-Not-Touch와 Rebuild 규칙 아래에서 `tasks.md`를 순회하는 태스크 루프로, 네이티브 goal로 감싸지며 고정된 최종 게이트(verify → cleanup → re-verify → independent review → done)로 끝납니다.
- **`verify` vs `mf-verify`**: `mf-verify`는 항상 컨텍스트를 전환하고(읽기 전용 verifier 서브에이전트), `tasks.md`, spec 시나리오, `design.md`에서 기준을 도출하며, diff를 Do-Not-Touch와 대조하고, Rebuild 단계가 실행되었는지 확인하고, 거짓 완료 패턴을 스캔하며, `spec archive`가 요구하는 보고서를 작성합니다.

## 서브에이전트 역할

| 역할 | 핵심 | 모델 | Codex effort | Codex 샌드박스 | 거부되는 도구 |
|---|---|---|---|---|---|
| `planner` | 제안을 근거에 기반한 설계와 태스크 목록으로 바꿉니다. 코드를 직접 읽으며, 모든 태스크에 검증 방법을 명시합니다 | inherit | high | 없음 | 없음(`changes/<name>/` 아래에만 씁니다) |
| `architect` | 읽기 전용 설계 검토자: 반론, 긴장, 종합. `CLEAR / WATCH / BLOCK` | inherit | high | read-only | Write, Edit |
| `critic` | 추측 없이 계획을 실행할 수 있는지 판단합니다. 두세 개의 태스크를 시뮬레이션하고, 최대 다섯 개의 수정 사항과 함께 `OKAY / REJECT`를 냅니다 | inherit | medium | read-only | Write, Edit |
| `verifier` | 새로운 증거만 사용합니다. 검사를 직접 실행하고, 기준별 상태를 냅니다. 자기 컨텍스트의 작업은 절대 승인하지 않습니다 | inherit | medium | 없음(테스트를 실행할 수 있도록 프롬프트로만 읽기 전용을 유지) | Write, Edit |

두 CLI 모두 역할은 메인 세션의 모델을 상속합니다(Claude는 `model: inherit`, Codex는 `model`을 생략하므로 부모 세션의 모델이 적용됩니다). `models` 명령(CLI 명령 절)으로 역할별로 로컬에서 덮어쓸 수 있으며, `models status`가 실제 적용된 값을 보여줍니다.

Claude에서는 `my-flow:planner` 등으로 지정합니다. Codex는 `~/.codex/agents/<name>.toml`에서 로드합니다. TOML에는 도구 허용 목록이 없으므로 읽기 전용은 문장(그리고 헤드리스일 때는 `-s read-only`)으로 강제됩니다.

## 훅

| 이벤트 | 스크립트 | 동작 |
|---|---|---|
| SessionStart | `hooks/session-context.mjs` | 프로젝트에 `changes/`가 있으면 활성 변경 사항을 체크됨 / 전체 태스크 수와 산출물 상태와 함께 나열합니다. 항상 종료 코드 0으로 종료합니다. 또한 보류 중인 모델 라우팅 요약을 한 줄, 한 번만 출력하고, `MY_FLOW_MODELS_CHECK_HOURS`(기본 1, `0` = 매 시작)마다 최대 한 번 분리된 `models check`를 띄웁니다. 이 검사는 CLI 버전을 조사하고 바뀐 경우에만 백그라운드에서 분석을 실행합니다. 훅 자체는 모델을 호출하지 않습니다. 라우팅 부분은 `MY_FLOW_SKIP_HOOKS=model-routing`으로 끌 수 있습니다. Windows에서는 `install claude` / `install codex`가 등록한 예약 작업 `my-flow-models-check`를 통해 검사를 시작합니다(작업 스케줄러가 훅의 잡 오브젝트 밖에서 실행하므로 Codex가 잡을 정리해도 살아남습니다). 작업이 없거나 `schtasks /run`이 실패하면 분리된 자식 프로세스로 대체합니다 |
| Stop | `hooks/completion-guard.mjs` | 마지막 메시지가 완료를 주장하지만 diff에 여전히 `test.skip`, `.only`, 자리표시자 TODO, 스텁 return이 들어 있으면 차단하고 이유를 설명합니다. `execute` 단계에서는 tasks.md에 체크되지 않았고 blocked 표시도 없는 작업이 남아 있으면 완료 주장도 차단하지만, 상태 파일이 12시간 이내(`MY_FLOW_EXECUTE_GUARD_TTL_HOURS`)일 때만 그렇습니다. 완료 주장이 없는 메시지는 절대 차단되지 않습니다 |

두 스크립트 모두 Claude(플러그인의 `hooks/hooks.json` 경유)와 Codex(PowerShell 심 경유)가 공유합니다. `MY_FLOW_SKIP_HOOKS=completion-guard` 또는 `execute-guard`(또는 `all`)로 비활성화할 수 있습니다. execute-guard의 TTL은 기본 12시간이며 `MY_FLOW_EXECUTE_GUARD_TTL_HOURS`로 재정의할 수 있습니다.

## 크로스 모델 어드바이저

```bash
node scripts/ask.mjs codex --diff "Review this diff for correctness"
node scripts/ask.mjs claude --files src/a.ts,src/b.ts "Is this abstraction justified?"
```

- 프롬프트는 항상 stdin으로 전달되며(argv는 절대 사용하지 않음), 다른 CLI는 읽기 전용(`codex exec -s read-only`, `claude -p --permission-mode plan`)으로 타임아웃과 함께 실행됩니다. 출력이 비어 있는 채로 종료 코드 0이면 실패로 간주합니다.
- 산출물은 `.my-flow/ask/<time>-<provider>-<slug>.md`에 저장되며 Original task / Final prompt / Raw output / Summary / Action items 섹션을 갖습니다.
- 모델은 `--model` 또는 환경 변수 `MY_FLOW_CODEX_MODEL` / `MY_FLOW_CLAUDE_MODEL`로 선택합니다(Codex 설정의 모델이 설치된 CLI가 지원하는 것보다 새로울 때 유용합니다. 예: `--model gpt-5.5`).
- 의견 불일치는 증거 또는 사용자의 판단으로 해결하며, 다수결로는 절대 해결하지 않습니다.

## 대시보드

```bash
node scripts/cli.mjs dashboard start                     # http://127.0.0.1:4321/
node scripts/cli.mjs dashboard start --port 4400 --root /path/to/project
node scripts/cli.mjs dashboard status
node scripts/cli.mjs dashboard stop
```

인텐트 레이어를 브라우저에서 보는 로컬 웹 뷰입니다. 의존성은 없습니다. 서버는 Node 내장 모듈만 쓰고, 브라우저 쪽은 손으로 작성한 HTML / CSS / JavaScript이며 네트워크에서 아무것도 받아오지 않습니다. `127.0.0.1`에만 바인딩하고 `Host`나 `Origin`이 자기 자신이 아닌 요청은 거부하므로, 다른 머신도 다른 웹 페이지도 접근할 수 없습니다.

- **Changes**: 활성 change마다 스테이지, 태스크 진행률, 산출물 상태, stale / overlap 경고. 각 change는 `proposal.md`, `design.md`, `tasks.md`와 delta spec을 나열합니다.
- **Specs**: `specs/<capability>/spec.md`와 그 요구사항. `<!-- via: ... -->` 마커는 그 요구사항을 만든 아카이브된 change로 연결됩니다.
- **Archive**: 아카이브된 change와 포기된 change(읽기 전용).
- **Scratch**: `.my-flow/ask/`, `.my-flow/verify/`, `.my-flow/interviews/`(읽기 전용).

`specs/`, `changes/`, `.my-flow/` 아래의 파일이 바뀌면 페이지는 Server-Sent Events로 즉시 갱신됩니다. 터미널에서 태스크를 체크하면 새로고침 없이 브라우저에 나타납니다. `specs/` 아래와 활성 `changes/<name>/` 아래의 markdown은 페이지에서 편집할 수 있습니다. 불러온 뒤 디스크의 파일이 바뀌었으면 저장이 거부되고, 페이지는 새 내용을 보여주며 다시 불러오기 또는 덮어쓰기를 제안합니다. 파일의 줄 끝 문자는 그대로 유지됩니다. 편집은 에이전트가 쓰지 않는 스테이지 사이의 틈을 위한 것입니다.

- **테마**: 사이드바의 테마 드롭다운이 시스템 색상 구성을 덮어씁니다. 선택은 브라우저에 저장됩니다.
- **execute 중 잠금**: 현재 change가 `execute` 스테이지에 있는 동안에는 모든 저장이 거부되고(HTTP 423) 에디터는 Save 대신 이유를 보여줍니다. 에이전트가 쓰고 있기 때문입니다. `spec stage`로 change가 다음 단계로 넘어가면 잠금은 바로 풀립니다.
- **Diff**: 프로젝트 루트가 git 작업 트리이면 `Diff` 항목이 작업 트리와 `HEAD`의 차이(스테이징됨, 스테이징 안 됨, 추적 안 됨)를 트리 또는 평면 목록으로 나열하고 선택한 파일의 패치를 읽기 전용으로 보여줍니다. `specs/`, `changes/`, `.my-flow/` 아래의 편집에만 자동으로 갱신되므로, 다른 곳을 편집한 뒤에는 Refresh 버튼을 누르세요. git이 없으면 이 항목은 나타나지 않습니다. 가장 최근에 수정된 파일에는 표시가 붙고, `j` / `k`로 파일 사이를 이동하며 `.`로 그 파일로 건너뜁니다.

`start`는 서버를 분리해 띄우고 `.my-flow/state/dashboard.json`에 기록합니다. `stop`은 기록된 프로세스가 정말 대시보드인지(살아 있고 `/api/health`가 같은 pid와 root로 응답하는지) 확인한 뒤 종료하며, 오래된 기록은 아무 시그널도 보내지 않고 정리합니다. 스킬 `/my-flow:dashboard start | stop | status`(Codex: `$my-flow-dashboard`)는 같은 명령을 감쌉니다.

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

`src/`를 편집한 뒤 `node scripts/build.mjs`를 실행합니다. 생성된 파일은 커밋되어 있으므로 `claude --plugin-dir`에는 빌드 단계가 필요 없습니다. `node scripts/build.mjs --check`는 생성 파일이 소스와 어긋나면 실패합니다. `npm test`는 `spec.mjs`와 Stop 훅에 대한 내장 `node --test` 스위트를 실행하며 의존성이 필요 없습니다.

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
| Stop 훅이 계속 차단함 | 마지막 메시지가 완료를 주장하고 **동시에** diff에 거짓 완료 마커가 있거나 현재 변경 사항이 `execute` 단계이면서 체크되지 않은 작업이 남아 있을 때만 차단합니다. 마커를 수정하거나, 작업을 끝내거나 blocked로 표시하거나, `spec stage <name> done`을 실행하세요. `MY_FLOW_SKIP_HOOKS=completion-guard` 또는 `execute-guard`로 우회할 수 있습니다 |
| execute-guard가 작동하지 않거나 오래된 변경 사항에 작동함 | `.my-flow/state/current-change.json`을 읽으며 `updated`가 12시간보다 오래되면 무시합니다. `spec stage <name> execute`로 갱신하거나 `spec stage <name> done`으로 해제하세요 |
| `spec archive`가 거부함 | 모든 체크박스가 체크되어 있어야 하고 `Verdict: PASS`를 포함한 보고서가 `.my-flow/verify/` 아래에 있어야 합니다. 먼저 `mf-verify`를 실행하거나, `--force`를 사용하고 그 사실을 밝히세요 |
| Codex가 훅을 신뢰할지 물어봄 | `/hooks`에서 한 번 승인하세요. 신뢰 해시 형식이 업스트림에서 바뀌었을 수 있습니다 |
| Windows에서의 분할 창 팀 | Claude Code에서 지원하지 않습니다. 팀은 프로세스 내에서 실행됩니다. tmux 창을 요청하지 마세요 |
| Codex에서 검사가 끝나지 않거나 `check start`가 나타나지 않음 | `schtasks /query /tn my-flow-models-check`를 실행하세요. 작업이 없거나 `node scripts/cli.mjs models status`에 런처 루트나 Node가 존재하지 않는다고 나오면(체크아웃 이동 또는 Node 업그레이드) `node scripts/install.mjs claude` 또는 `codex`를 다시 실행해 재등록합니다. Codex에서는 my-flow 훅을 `/hooks`에서 한 번 신뢰해야 합니다 |
| 서브에이전트가 예상과 다른 모델로 실행됨 | `node scripts/cli.mjs models status`를 실행하세요. 덮어쓰기(있다면)와 설치된 에이전트 파일에서 읽어 온 `model:` / effort 값을 보여줍니다. `models reset`은 `inherit` 기준선을 복원하고, `~/.my-flow/`의 `models.log`에 모든 검사와 분석이 기록됩니다. 개발용 체크아웃(`claude --plugin-dir`)은 절대 다시 쓰지 않으며 설치된 플러그인 캐시만 대상입니다 |

## 라이선스

MIT
