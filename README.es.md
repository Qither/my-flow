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

Una capa de flujo de trabajo ligera que funciona de la misma manera en **Claude Code** y en **Codex CLI**. No añade ningún runtime ni depende de ninguna herramienta externa. Le ofrece:

- un único flujo de cuatro etapas: `interview → mf-plan → execute → mf-verify`
- siete skills y cuatro roles de subagente (tres de ellos de solo lectura)
- dos hooks: inyectar el cambio activo al iniciar la sesión y bloquear las afirmaciones falsas de "terminado" al detenerse
- un asesor entre modelos: Claude consulta a Codex, Codex consulta a Claude, siempre en modo de solo lectura
- una **capa de intención**: `specs/` contiene la verdad actual y `changes/<name>/` contiene la intención de un cambio. La estructura está tomada de OpenSpec, pero my-flow incluye sus propios `new / status / validate / archive`, de modo que OpenSpec en sí no es necesario

Todo lo que oh-my-claudecode y oh-my-codex solían envolver (equipos de agentes, `/goal`, worktrees, hooks, skills, plugins) se utiliza directamente a través de las funciones nativas de ambas CLI.

## Índice

1. [Posicionamiento](#posicionamiento)
2. [Requisitos](#requisitos)
3. [Inicio rápido](#inicio-rápido)
4. [Conceptos](#conceptos)
5. [Comandos de la CLI](#comandos-de-la-cli)
6. [Skills](#skills)
7. [Roles de subagente](#roles-de-subagente)
8. [Hooks](#hooks)
9. [Asesor entre modelos](#asesor-entre-modelos)
10. [La capa de intención](#la-capa-de-intención)
11. [Estructura del repositorio y autoría desde una fuente única](#estructura-del-repositorio-y-autoría-desde-una-fuente-única)
12. [Instalación en Codex](#instalación-en-codex)
13. [Solución de problemas](#solución-de-problemas)
14. [Licencia](#licencia)

## Posicionamiento

| Herramienta / proyecto | Rol |
|---|---|
| Claude Code | Ejecutor principal para el desarrollo interactivo diario (equipos de agentes nativos + `/goal`) |
| Codex | Asesor y verificador cruzado: revisa diseños y diffs, resuelve empates. Solo implementa cuando usted invoca explícitamente `$my-flow-execute` |
| OpenSpec | Solo se toman prestadas sus ideas y su estructura de directorios (specs / changes / delta specs / casillas de tasks.md). Sin CLI, sin comandos `/opsx` |
| oh-my-claudecode | Opcional. my-flow ya cubre el asesor entre modelos y la extracción de skills; use claude-hud para el HUD |
| oh-my-codex | No es necesario. Sus convenciones de flujo están destiladas en `src/core/core.md` y en las skills |

## Requisitos

- Node.js 20 o más reciente (los scripts y los hooks son Node puro, sin dependencias)
- Claude Code 2.1.x para el lado de Claude
- Codex CLI 0.135 o más reciente para el lado de Codex (con las funciones `hooks`, `goals` y `multi_agent` habilitadas)
- Windows 11 es el objetivo principal; todo funciona sin tmux ni WSL. macOS y Linux funcionan con los mismos scripts

## Inicio rápido

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

A continuación, dentro de Claude Code: `/my-flow:interview my-first-change` → `/my-flow:mf-plan my-first-change` → `/my-flow:execute my-first-change` → `/my-flow:mf-verify my-first-change`.

El lado de Codex es opcional; consulte [Instalación en Codex](#instalación-en-codex).

## Conceptos

### Las cuatro etapas

| Su solicitud se parece a | Etapas que debe usar |
|---|---|
| Concreta, un solo archivo, aceptación clara | solo `execute` (o simplemente hágalo) |
| Concreta pero con varios archivos o varios módulos | `mf-plan → execute → mf-verify` |
| Vaga, sin criterios de aceptación, "¿deberíamos...?" | `interview → mf-plan → execute → mf-verify` |
| Afecta a la configuración de build, shaders, módulos del motor, migraciones, autenticación | nunca omita `mf-plan` ni `mf-verify` |

Reglas que se mantienen en todas las etapas:

- `interview` hace una pregunta por ronda y solo se detiene cuando los no-objetivos y los límites de decisión son explícitos.
- `mf-plan` nunca implementa. `execute` nunca rediseña; si el diseño es incorrecto, deténgase y vuelva atrás.
- `mf-verify` siempre se ejecuta en un contexto separado del que escribió el código.
- Las casillas de `tasks.md` son el único registro de progreso. Una casilla se marca únicamente después de que la verificación propia de esa tarea haya pasado.

### Por qué el prefijo `mf-`

Claude Code tiene un `/plan` integrado (modo de planificación) y skills incorporadas llamadas `run` y `verify`. Las skills de plugin siempre llevan espacio de nombres (`/my-flow:...`), así que nada se sobrescribe, pero el modelo elige las skills por nombre y descripción. Los nombres distintos eliminan la ambigüedad:

| Etapa | Skill | Por qué no el nombre obvio |
|---|---|---|
| Entrevista | `interview` | sin conflicto |
| Planificación | `mf-plan` | el `/plan` integrado es el modo de planificación |
| Ejecución | `execute` | la skill integrada `run` lanza la aplicación del proyecto |
| Verificación | `mf-verify` | skill integrada `verify` |

### Una sola autoridad de bucle por sesión

En Claude Code, como máximo un `/goal` y como máximo un equipo de agentes por sesión. `execute` imprime la declaración de `/goal` para que usted la pegue (las skills no pueden establecerla por sí mismas). En Codex, un goal por hilo; `execute` llama a `create_goal` solo cuando no hay ninguno activo.

### Qué hace cada uno: Claude y Codex

Claude Code realiza el trabajo interactivo y ejecuta los bucles. Codex revisa, planifica, verifica y responde a las solicitudes de `ask`. Solo implementa cuando usted invoca explícitamente `$my-flow-execute`. No intervienen tmux, ni runtime de equipos, ni demonios de estado en ninguno de los dos lados.

## Comandos de la CLI

Todos los comandos son scripts de Node puro. `node scripts/cli.mjs <command>` (o `my-flow <command>` después de `npm link`) los despacha.

| Comando | Qué hace | Notas |
|---|---|---|
| `build [--check]` | Renderiza `src/` en el plugin de Claude y en la superficie de Codex | Ejecútelo después de editar `src/`. `--check` solo compara y sale con 1 cuando las salidas están desactualizadas |
| `install claude [--dry-run]` | Hace una copia de seguridad de `~/.claude/settings.json`, establece `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, inserta o actualiza el acuerdo de trabajo en `~/.claude/CLAUDE.md` | Imprime los comandos de instalación del plugin, no los ejecuta |
| `install codex [--link] [--dry-run]` | Hace una copia de seguridad y luego copia las skills y los TOML de agentes, escribe el shim de PowerShell, fusiona `hooks.json`, escribe los hashes de confianza en `config.toml`, inserta o actualiza `~/.codex/AGENTS.md` | `--link` usa junctions en lugar de copias |
| `uninstall codex [--dry-run]` | Revierte `install codex`, conservando todo lo demás en `~/.codex` | |
| `init [--simple] [--tools claude,codex] [dir]` | Crea `specs/`, `changes/` (con `.templates/` y `archive/`), `specs/README.md`, `.claude/rules/specs.md`, `.my-flow/`, y añade un bloque al `CLAUDE.md` / `AGENTS.md` del proyecto | `--simple` cambia a un único `docs/changes/<name>.md` por cambio |
| `spec new <name>` | Crea `changes/<name>/{proposal,design,tasks}.md` a partir de las plantillas y lo marca como actual | nombres en kebab-case |
| `spec status [name] [--json]` | Tareas marcadas / totales, estado de los artefactos (missing / empty / done), número de delta specs | Las plantillas sin modificar cuentan como vacías |
| `spec validate [name] [--json]` | Comprobaciones estructurales: secciones obligatorias, formato de las líneas de tarea, formato de los escenarios, secciones delta; los requisitos MODIFIED / REMOVED se comprueban contra la spec principal | Sale con 1 si hay errores |
| `spec archive <name> [--force]` | Requiere que todas las casillas estén marcadas y un informe PASS bajo `.my-flow/verify/`; fusiona los delta specs en `specs/` y mueve el cambio a `changes/archive/` | `--force` omite la puerta de control |
| `ask <codex\|claude> [--diff] [--files a,b] [--model m] [--timeout ms] <question>` | Ejecuta la otra CLI en modo de solo lectura como asesor; escribe un artefacto en `.my-flow/ask/` | El prompt pasa por stdin; una salida vacía cuenta como fallo |

## Skills

Claude las invoca como `/my-flow:<name>`, Codex como `$my-flow-<name>`.

| Skill | Cuándo | Qué hace | Salida |
|---|---|---|---|
| `interview <idea> [--quick] [--change <name>]` | Solicitud vaga, sin criterios de aceptación | Una pregunta por ronda, la intención antes que el detalle; puntúa la ambigüedad; termina cuando los Non-Goals y los Decision Boundaries son explícitos | `changes/<name>/proposal.md`, transcripción en `.my-flow/interviews/` |
| `mf-plan <name \| text> [--deliberate]` | Cambios en varios archivos; cualquier cosa que afecte a la configuración de build, shaders, módulos del motor, migraciones, autenticación | el planner redacta → el architect revisa (`CLEAR / WATCH / BLOCK`) → el critic revisa (`OKAY / REJECT`), hasta tres rondas | `design.md` (debe contener Do-Not-Touch y Rebuild / Re-run), `tasks.md` |
| `execute <name> [--team] [--worktree]` | `tasks.md` tiene casillas sin marcar | Compone la declaración del goal; implementa tarea por tarea, verifica, marca; ejecuta la puerta final fija | Claude: imprime `/goal …` para que usted lo pegue. Codex: `create_goal` |
| `mf-verify <name \| criteria>` | Antes de cualquier afirmación de "terminado" | Delega en el verifier de solo lectura, que ejecuta las comprobaciones por sí mismo e informa por criterio | `.my-flow/verify/<name>-<time>.md` con PASS / FAIL / INCOMPLETE |
| `ask <codex\|claude> [--diff] [--files] <question>` | Segunda opinión sobre un diseño, revisión del diff antes de la puerta final, desempate cuando la planificación se estanca | Envuelve el script `ask`, resume e indica si está de acuerdo | `.my-flow/ask/` |
| `learn [name] [--dry-run]` | La sesión resolvió algo específico del proyecto y difícil | Puerta de calidad de tres preguntas y luego extrae un SKILL.md | Se escribe tanto en `.claude/skills/` como en `.agents/skills/` |
| `spec new\|status\|validate\|archive` | Gestión de la capa de intención | Envuelve el script `spec` e interpreta su salida | la misma que el script |

`learn` tiene `disable-model-invocation`; solo usted puede invocarla.

### En qué se diferencian las tres skills de flujo de las integradas

- **`/plan` frente a `mf-plan`**: el modo de planificación es un modo de permisos de solo lectura que escribe un único archivo de plan fuera del proyecto y pide aprobación. `mf-plan` produce artefactos confirmados (`design.md`, `tasks.md`) revisados por tres roles en secuencia, con secciones obligatorias y un formato de tareas que después dirige `execute` y `mf-verify`. Puede seguir entrando primero en `/plan` para explorar.
- **`run` frente a `execute`**: la skill integrada `run` lanza la aplicación del proyecto. `execute` es un bucle de tareas sobre `tasks.md` bajo las reglas Do-Not-Touch y Rebuild, envuelto en un goal nativo, que termina con la puerta final fija (verificar → limpiar → volver a verificar → revisión independiente → terminado).
- **`verify` frente a `mf-verify`**: `mf-verify` siempre cambia de contexto (subagente verifier de solo lectura), deriva sus criterios de `tasks.md`, de los escenarios de las specs y de `design.md`, comprueba el diff contra Do-Not-Touch, comprueba que los pasos de Rebuild se ejecutaron, busca patrones de finalización falsa y escribe un informe que `spec archive` requiere.

## Roles de subagente

| Rol | Esencia | Modelo de Claude | Esfuerzo en Codex | Herramientas denegadas |
|---|---|---|---|---|
| `planner` | Convierte una propuesta en un diseño y una lista de tareas basados en evidencia; lee el código por sí mismo; cada tarea nombra su verificación | opus | high | ninguna (escribe solo bajo `changes/<name>/`) |
| `architect` | Revisor de diseño de solo lectura: antítesis, tensión, síntesis; `CLEAR / WATCH / BLOCK` | opus | high | Write, Edit |
| `critic` | Decide si el plan es ejecutable sin adivinar; simula dos o tres tareas; `OKAY / REJECT` con un máximo de cinco correcciones | sonnet | medium | Write, Edit |
| `verifier` | Solo evidencia fresca; ejecuta las comprobaciones por sí mismo; estado por criterio; nunca aprueba trabajo desde su propio contexto | sonnet | medium | Write, Edit |

Claude se dirige a ellos como `my-flow:planner`, etc. Codex los carga desde `~/.codex/agents/<name>.toml`; TOML no tiene lista de herramientas permitidas, así que el modo de solo lectura se impone mediante prosa (y mediante `-s read-only` en modo headless).

## Hooks

| Evento | Script | Comportamiento |
|---|---|---|
| SessionStart | `hooks/session-context.mjs` | Si el proyecto tiene `changes/`, lista los cambios activos con tareas marcadas / totales y el estado de los artefactos. Siempre sale con 0 |
| Stop | `hooks/completion-guard.mjs` | Si el último mensaje afirma que se ha completado el trabajo pero el diff todavía contiene `test.skip`, `.only`, TODO de relleno o retornos stub, bloquea y explica por qué; durante `execute` también bloquea mientras tasks.md tenga tareas sin marcar y sin la etiqueta blocked |

Ambos scripts son compartidos por Claude (mediante `hooks/hooks.json` en el plugin) y Codex (mediante el shim de PowerShell). Desactívelos con `MY_FLOW_SKIP_HOOKS=completion-guard` o `execute-guard` (o `all`).

## Asesor entre modelos

```bash
node scripts/ask.mjs codex --diff "Review this diff for correctness"
node scripts/ask.mjs claude --files src/a.ts,src/b.ts "Is this abstraction justified?"
```

- El prompt siempre pasa por stdin (nunca por argv), la otra CLI se ejecuta en modo de solo lectura (`codex exec -s read-only`, `claude -p --permission-mode plan`), con un tiempo de espera; una salida con código 0 y sin contenido cuenta como fallo.
- Los artefactos se guardan en `.my-flow/ask/<time>-<provider>-<slug>.md` con las secciones Original task / Final prompt / Raw output / Summary / Action items.
- Elija el modelo con `--model` o con las variables de entorno `MY_FLOW_CODEX_MODEL` / `MY_FLOW_CLAUDE_MODEL` (útil cuando el modelo de su configuración de Codex es más reciente de lo que admite la CLI instalada, p. ej. `--model gpt-5.5`).
- Los desacuerdos se resuelven por evidencia o por usted, nunca por mayoría.

## La capa de intención

```
specs/<capability>/spec.md                 current truth: Requirement + Scenario (WHEN / THEN)
changes/<name>/proposal.md                 why, what, Non-Goals, Decision Boundaries
changes/<name>/design.md                   how; MUST contain ## Do-Not-Touch and ## Rebuild / Re-run After Change
changes/<name>/tasks.md                    ordered checklist; checkboxes are the only progress ledger
changes/<name>/specs/<capability>/spec.md  delta: ## ADDED | MODIFIED | REMOVED Requirements
changes/archive/<date>-<name>/             archived changes (deltas merged into specs/)
changes/.templates/                        templates used by `spec new`
```

Formato de las specs:

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

Reglas: cada requisito tiene al menos un escenario; los escenarios usan exactamente cuatro almohadillas; los archivos delta colocan bloques de requisito completos bajo `## ADDED Requirements`, `## MODIFIED Requirements` (reemplazo completo) o `## REMOVED Requirements`. Escriba specs solo para el comportamiento que un cambio añade o modifica; `specs/` se va completando a medida que se archivan los cambios.

Las dos secciones obligatorias de `design.md` existen porque los bucles autónomos hacen que una dirección equivocada resulte costosa: `Do-Not-Touch` nombra los módulos que el cambio no debe modificar, y `Rebuild / Re-run After Change` nombra lo que debe regenerarse, reconstruirse, cocinarse o volver a ejecutarse después de cada edición (archivos de proyecto, objetivos de build, cachés, suites de pruebas). `mf-verify` comprueba ambas.

Los proyectos con `--simple` usan en su lugar un único `docs/changes/<name>.md` con las mismas secciones.

## Estructura del repositorio y autoría desde una fuente única

```
src/            single source of truth (English): core/core.md, skills/*.md, agents/*.md, rules/*.md
scripts/        build / install / init / spec / ask / cli
hooks/          the two Node hooks + the Codex PowerShell shim
templates/      project blocks (CLAUDE.md / AGENTS.md), change templates, specs README, simple-mode file
skills/ agents/ .claude-plugin/plugin.json   generated: Claude plugin surface
codex/          generated: Codex skills, agent TOMLs, AGENTS.md block, hooks template
claude/         generated: the block installed into ~/.claude/CLAUDE.md
```

Edite `src/` y luego ejecute `node scripts/build.mjs`. Los archivos generados se confirman en el repositorio para que `claude --plugin-dir` no necesite ningún paso de build; `node scripts/build.mjs --check` falla cuando se desvían.

Convenciones de la fuente:

- `{{ARGS}}` → Claude `$ARGUMENTS` / Codex `{{ARGUMENTS}}`
- `{{CALL:mf-plan}}` → Claude `/my-flow:mf-plan` / Codex `$my-flow-mf-plan`
- `<!-- MY-FLOW:CLAUDE --> … <!-- /MY-FLOW:CLAUDE -->` se conserva solo en la renderización de Claude; `CODEX` de forma análoga
- las listas de herramientas permitidas por skill y los niveles de modelo por agente viven en `manifest.json`
- `src/rules/*.md` son fragmentos de reglas (estilo de código, pruebas, git) que puede pegar en el `CLAUDE.md` / `AGENTS.md` de un proyecto; no se instalan automáticamente

## Instalación en Codex

```bash
node scripts/install.mjs codex --dry-run   # see what would change
node scripts/install.mjs codex             # backup, then skills, agents, shim, hooks.json, trusted hashes, AGENTS.md block
node scripts/install.mjs --uninstall codex # reverse
```

Si Codex sigue pidiéndole que confíe en los hooks, apruébelos una vez en `/hooks` (esto ocurre cuando cambia el algoritmo de hash upstream).

Si oh-my-codex está instalado, elimínelo primero, en este orden:

1. Haga una copia de seguridad de `~/.codex/{config.toml,hooks.json,AGENTS.md,hooks,skills,agents,prompts}`.
2. `omx uninstall --dry-run`, revise y luego `omx uninstall`.
3. Compruebe si quedan restos en `config.toml`: el par `--previous-notify …notify-hook.js` en `notify`, `developer_instructions` que mencionen oh-my-codex, `USE_OMX_EXPLORE_CMD` bajo `[shell_environment_policy.set]`. Conserve `[features] hooks / goals / multi_agent = true`.
4. `npm uninstall -g oh-my-codex`.
5. `node scripts/install.mjs codex`.

El instalador omite cualquier `~/.codex/agents/<name>.toml` que no haya creado él mismo, de modo que los agentes dejados por otra herramienta nunca se sobrescriben.

## Solución de problemas

| Síntoma | Causa y solución |
|---|---|
| `ask codex` falla con "model requires a newer version of Codex" | El modelo de `~/.codex/config.toml` es más reciente que la CLI. Ejecute `codex update` o pase `--model gpt-5.5` (o establezca `MY_FLOW_CODEX_MODEL`) |
| `ask codex` falla con `EINVAL` | Corregido en `scripts/lib/spawn.mjs`: los shims `.cmd` en Windows deben pasar por un shell. Asegúrese de ejecutar la versión actual |
| El modelo no lista `/my-flow:learn` | Es intencional. Tiene `disable-model-invocation`; escríbalo usted mismo |
| El hook de Stop bloquea continuamente | Solo bloquea cuando el último mensaje afirma que se ha completado el trabajo **y** el diff contiene marcadores de finalización falsa. Corríjalos o repórtelos como bloqueadores. Evítelo con `MY_FLOW_SKIP_HOOKS=completion-guard` |
| `spec archive` se niega | Todas las casillas deben estar marcadas y debe existir un informe que contenga `Verdict: PASS` bajo `.my-flow/verify/`. Ejecute primero `mf-verify`, o use `--force` e indíquelo |
| Codex pide confiar en los hooks | Apruébelos una vez en `/hooks`; el formato de los hashes de confianza puede haber cambiado upstream |
| Equipos en paneles divididos en Windows | No lo admite Claude Code; los equipos se ejecutan en el mismo proceso. No pida paneles de tmux |

## Licencia

MIT
