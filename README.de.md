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

Eine leichtgewichtige Workflow-Schicht, die in **Claude Code** und **Codex CLI** auf dieselbe Weise funktioniert. Sie fügt keine Laufzeitumgebung hinzu und hängt von keinem externen Werkzeug ab. Sie bietet Ihnen:

- einen einzigen vierstufigen Ablauf: `interview → mf-plan → execute → mf-verify`
- sieben Skills und vier Subagent-Rollen (drei davon nur lesend)
- zwei Hooks: Einspeisen des aktiven Changes beim Sitzungsstart, Blockieren falscher „fertig“-Behauptungen beim Stop
- einen modellübergreifenden Berater: Claude fragt Codex, Codex fragt Claude, stets nur lesend
- eine **Intent-Ebene**: `specs/` enthält die aktuelle Wahrheit, `changes/<name>/` enthält die Absicht eines einzelnen Changes. Die Struktur ist von OpenSpec entlehnt, aber my-flow liefert eigene Befehle `new / status / validate / archive` mit, sodass OpenSpec selbst nicht benötigt wird

Alles, was oh-my-claudecode und oh-my-codex früher gekapselt haben (Agent-Teams, `/goal`, Worktrees, Hooks, Skills, Plugins), wird direkt über die nativen Funktionen beider CLIs genutzt.

## Inhaltsverzeichnis

1. [Positionierung](#positionierung)
2. [Voraussetzungen](#voraussetzungen)
3. [Schnellstart](#schnellstart)
4. [Konzepte](#konzepte)
5. [CLI-Befehle](#cli-befehle)
6. [Skills](#skills)
7. [Subagent-Rollen](#subagent-rollen)
8. [Hooks](#hooks)
9. [Modellübergreifender Berater](#modellübergreifender-berater)
10. [Dashboard](#dashboard)
11. [Die Intent-Ebene](#die-intent-ebene)
12. [Repository-Struktur und Single-Source-Authoring](#repository-struktur-und-single-source-authoring)
13. [Installation in Codex](#installation-in-codex)
14. [Fehlerbehebung](#fehlerbehebung)
15. [Lizenz](#lizenz)

## Positionierung

| Werkzeug / Projekt | Rolle |
|---|---|
| Claude Code | Primärer Ausführer für die tägliche interaktive Entwicklung (native Agent-Teams + `/goal`) |
| Codex | Berater und Gegenprüfer: begutachtet Designs und Diffs, entscheidet bei Patt. Implementiert nur, wenn Sie `$my-flow-execute` explizit aufrufen |
| OpenSpec | Nur seine Ideen und seine Verzeichnisstruktur werden entlehnt (specs / changes / Delta-Specs / Checkboxen in tasks.md). Keine CLI, keine `/opsx`-Befehle |
| oh-my-claudecode | Optional. my-flow deckt den modellübergreifenden Berater und die Skill-Extraktion bereits ab; für das HUD verwenden Sie claude-hud |
| oh-my-codex | Nicht erforderlich. Seine Ablaufkonventionen sind in `src/core/core.md` und den Skills destilliert |

## Voraussetzungen

- Node.js 20 oder neuer (die Skripte und Hooks sind reines Node ohne Abhängigkeiten)
- Claude Code 2.1.x für die Claude-Seite
- Codex CLI 0.135 oder neuer für die Codex-Seite (Features `hooks`, `goals`, `multi_agent` aktiviert)
- Windows 11 ist die primäre Zielplattform; alles läuft ohne tmux oder WSL. macOS und Linux funktionieren mit denselben Skripten

## Schnellstart

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

Anschließend in Claude Code: `/my-flow:interview my-first-change` → `/my-flow:mf-plan my-first-change` → `/my-flow:execute my-first-change` → `/my-flow:mf-verify my-first-change`.

Die Codex-Seite ist optional; siehe [Installation in Codex](#installation-in-codex).

## Konzepte

### Die vier Stufen

| Ihre Anfrage sieht so aus | Zu verwendende Stufen |
|---|---|
| Konkret, eine einzelne Datei, klare Abnahme | nur `execute` (oder einfach direkt umsetzen) |
| Konkret, aber mehrere Dateien oder Module | `mf-plan → execute → mf-verify` |
| Vage, keine Abnahmekriterien, „sollten wir...“ | `interview → mf-plan → execute → mf-verify` |
| Berührt Build-Konfiguration, Shader, Engine-Module, Migrationen, Authentifizierung | `mf-plan` und `mf-verify` niemals überspringen |

Regeln, die über alle Stufen hinweg gelten:

- `interview` stellt eine Frage pro Runde und endet erst, wenn Nicht-Ziele und Entscheidungsgrenzen explizit sind.
- `mf-plan` implementiert nie. `execute` entwirft nie neu; ist das Design falsch, anhalten und zurückgehen.
- `mf-verify` läuft immer in einem anderen Kontext als dem, der den Code geschrieben hat.
- Die Checkboxen in `tasks.md` sind das einzige Fortschrittsprotokoll. Eine Box wird erst abgehakt, nachdem die eigene Verifikation dieser Aufgabe bestanden wurde.

### Warum das Präfix `mf-`

Claude Code hat ein eingebautes `/plan` (Plan-Modus) sowie mitgelieferte Skills namens `run` und `verify`. Plugin-Skills sind immer mit einem Namensraum versehen (`/my-flow:...`), es wird also nichts überschrieben, aber das Modell wählt Skills nach Name und Beschreibung aus. Eindeutige Namen beseitigen die Mehrdeutigkeit:

| Stufe | Skill | Warum nicht der naheliegende Name |
|---|---|---|
| Interview | `interview` | kein Konflikt |
| Planung | `mf-plan` | das eingebaute `/plan` ist der Plan-Modus |
| Ausführung | `execute` | der eingebaute Skill `run` startet die App des Projekts |
| Verifikation | `mf-verify` | eingebauter Skill `verify` |

### Eine Schleifenautorität pro Sitzung

In Claude Code gibt es höchstens ein `/goal` und höchstens ein Agent-Team pro Sitzung. `execute` gibt die `/goal`-Anweisung aus, die Sie einfügen (Skills können sie nicht selbst setzen); der Stop-Hook ist nur eine Absicherung, die während `execute` Fertigstellungsbehauptungen mit unerledigten Aufgaben blockiert, und das nur, solange der von `spec stage` geschriebene Zustand frisch ist. In Codex gilt ein Goal pro Thread; `execute` ruft `create_goal` nur auf, wenn keines aktiv ist.

### Was Claude und Codex jeweils tun

Claude Code erledigt die interaktive Arbeit und führt die Schleifen aus. Codex begutachtet, plant, verifiziert und beantwortet `ask`-Anfragen. Es implementiert nur, wenn Sie `$my-flow-execute` explizit aufrufen. Auf keiner Seite sind tmux, eine Team-Laufzeit oder Zustands-Daemons beteiligt.

## CLI-Befehle

Alle Befehle sind einfache Node-Skripte. `node scripts/cli.mjs <command>` (oder `my-flow <command>` nach `npm link`) leitet an sie weiter.

| Befehl | Was er tut | Hinweise |
|---|---|---|
| `build [--check]` | Rendert `src/` in das Claude-Plugin und die Codex-Oberfläche | Nach dem Bearbeiten von `src/` ausführen. `--check` vergleicht nur und beendet sich mit Exit-Code 1, wenn die Ausgaben veraltet sind |
| `install claude [--dry-run]` | Sichert `~/.claude/settings.json`, setzt `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, fügt die Arbeitsvereinbarung in `~/.claude/CLAUDE.md` ein bzw. aktualisiert sie | Gibt die Installationsbefehle für das Plugin aus, führt sie aber nicht aus |
| `install codex [--link] [--dry-run]` | Sichert, kopiert dann Skills und Agent-TOMLs, schreibt das PowerShell-Shim, führt `hooks.json` zusammen, schreibt vertrauenswürdige Hashes in `config.toml`, fügt `~/.codex/AGENTS.md` ein bzw. aktualisiert sie | `--link` verwendet Junctions statt Kopien |
| `uninstall codex [--dry-run]` | Macht `install codex` rückgängig und bewahrt alles andere in `~/.codex` | |
| `init [--simple] [--tools claude,codex] [dir]` | Erstellt `specs/`, `changes/` (mit `.templates/` und `archive/`), `specs/README.md`, `.claude/rules/specs.md`, `.my-flow/` und hängt einen Block an die `CLAUDE.md` / `AGENTS.md` des Projekts an | `--simple` wechselt zu einer einzelnen `docs/changes/<name>.md` pro Change |
| `spec new <name>` | Erstellt `changes/<name>/{proposal,design,tasks}.md` aus Vorlagen und markiert den Change als aktuell | Namen in kebab-case |
| `spec status [name] [--json]` | Abgehakte / gesamte Aufgaben, Artefaktzustand (missing / empty / done), Anzahl der Delta-Specs; markiert unfertige Changes, die 14 Tage unberührt blieben, mit `[stale Nd]` (`--stale-days`, `MY_FLOW_STALE_DAYS`), `overlap:` wenn zwei Changes dieselbe Anforderung beanspruchen, `audit suggested:` nach 5 Merges in eine Capability (`MY_FLOW_AUDIT_EVERY`) | Unveränderte Vorlagen zählen als leer |
| `spec validate [name] [--json]` | Strukturprüfungen: erforderliche Abschnitte, Format der Aufgabenzeilen, Szenarioformat, Delta-Abschnitte; MODIFIED / REMOVED-Anforderungen werden gegen die Haupt-Spec geprüft | Exit-Code 1 bei Fehlern |
| `spec archive <name> [--force]` | Erfordert, dass alle Boxen abgehakt sind und ein PASS-Bericht unter `.my-flow/verify/` liegt; führt Delta-Specs in `specs/` zusammen und verschiebt den Change nach `changes/archive/` | `--force` überspringt die Sperre |
| `spec abandon <name> --reason "..." [--force]` | Dritter Ausgang für einen Change, der nicht fertiggestellt wird: erfordert einen Abschnitt `## Abandoned` mit einer `**Reason**:`-Zeile (`--reason` fügt sie an), verschiebt den Change nach `changes/archive/<date>-<name>-abandoned/`, merged nichts | Verweigert einen vollständig abgehakten Change (dann `archive`). Protokolliert auch ein sauberes Audit: `spec new audit-<cap>`, dann `spec abandon audit-<cap> --reason "..."` |
| `spec stage <name> <stage>` | Schreibt `.my-flow/state/current-change.json` (`new`, `interview`, `mf-plan`, `execute`, `done`, `archived`) mit einem frischen `updated`-Zeitstempel | Der execute-guard greift nur, solange diese Datei jünger als 12 h ist |
| `ask <codex\|claude> [--diff] [--files a,b] [--model m] [--timeout ms] <question>` | Führt die andere CLI nur lesend als Berater aus; schreibt ein Artefakt nach `.my-flow/ask/` | Der Prompt geht über stdin; leere Ausgabe zählt als Fehlschlag |
| `dashboard [start\|stop\|status] [--port N] [--root dir] [--json]` | Lokales Web-Dashboard über `specs/`, `changes/` und `.my-flow/`: Live-Updates, abgesichertes Bearbeiten; `stop` prüft den eingetragenen Prozess, bevor es ihn beendet | Nur Loopback, Standardport 4321, keine Abhängigkeiten |

## Skills

Claude ruft sie als `/my-flow:<name>` auf, Codex als `$my-flow-<name>`.

| Skill | Wann | Was er tut | Ausgabe |
|---|---|---|---|
| `interview <idea> [--quick] [--change <name>]` | Vage Anfrage, keine Abnahmekriterien | Eine Frage pro Runde, Absicht vor Detail; bewertet Mehrdeutigkeit; endet, wenn Non-Goals und Decision Boundaries explizit sind | `changes/<name>/proposal.md`, Transkript in `.my-flow/interviews/` |
| `mf-plan <name \| text> [--deliberate]` | Änderungen über mehrere Dateien; alles, was Build-Konfiguration, Shader, Engine-Module, Migrationen oder Authentifizierung berührt | planner entwirft → architect begutachtet (`CLEAR / WATCH / BLOCK`) → critic begutachtet (`OKAY / REJECT`), bis zu drei Runden | `design.md` (muss Do-Not-Touch und Rebuild / Re-run enthalten), `tasks.md` |
| `execute <name> [--team] [--worktree]` | `tasks.md` enthält nicht abgehakte Boxen | Formuliert die Goal-Anweisung; implementiert Aufgabe für Aufgabe, verifiziert, hakt ab; führt die feste Abschlussprüfung aus | Claude: gibt `/goal …` zum Einfügen aus. Codex: `create_goal` |
| `mf-verify <name \| criteria>` | Vor jeder „fertig“-Behauptung | Delegiert an den nur lesenden verifier, der die Prüfungen selbst ausführt und pro Kriterium berichtet | `.my-flow/verify/<name>-<time>.md` mit PASS / FAIL / INCOMPLETE |
| `mf-audit <capability \| all>` | `spec status` meldet `audit suggested`, oder der Nutzer sagt „audit the spec“ | Nur lesender architect-Durchlauf, der `specs/<cap>/spec.md` mit Code und Tests vergleicht: nicht umgesetzte Anforderungen, undokumentiertes Verhalten, Widersprüche, falsch einsortierte Anforderungen; bearbeitet `specs/` nie | `.my-flow/verify/audit-<cap>-<time>.md` mit `Status: CLEAN / DRIFT / BROKEN` und einem vorgeschlagenen Change-Namen, der auf `audit-<cap>` endet |
| `ask <codex\|claude> [--diff] [--files] <question>` | Zweitmeinung zu einem Design, Diff-Review vor der Abschlussprüfung, Entscheidung bei festgefahrener Planung | Kapselt das `ask`-Skript, fasst zusammen und gibt an, ob es zustimmt | `.my-flow/ask/` |
| `learn [name] [--dry-run]` | Die Sitzung hat etwas Projektspezifisches und Schwieriges gelöst | Qualitätsprüfung mit drei Fragen, dann Extraktion einer SKILL.md | Wird sowohl nach `.claude/skills/` als auch nach `.agents/skills/` geschrieben |
| `spec new\|status\|validate\|abandon\|archive\|stage` | Verwaltung der Intent-Ebene | Kapselt das `spec`-Skript und interpretiert dessen Ausgabe | wie das Skript |
| `dashboard start\|stop\|status` | Einen Change im Browser verfolgen, ein Proposal oder eine Spec außerhalb des Terminals bearbeiten | Kapselt das `dashboard`-Skript: startet es losgelöst und gibt die URL aus, oder stoppt es | `.my-flow/state/dashboard.json` |

`learn` trägt `disable-model-invocation`; nur Sie können es aufrufen.

### Wie sich die drei Ablauf-Skills von den eingebauten unterscheiden

- **`/plan` vs. `mf-plan`**: Der Plan-Modus ist ein nur lesender Berechtigungsmodus, der eine einzelne Plandatei außerhalb des Projekts schreibt und um Freigabe bittet. `mf-plan` erzeugt committete Artefakte (`design.md`, `tasks.md`), die nacheinander von drei Rollen begutachtet werden, mit erforderlichen Abschnitten und einem Aufgabenformat, das später `execute` und `mf-verify` steuert. Sie können weiterhin zuerst `/plan` betreten, um zu erkunden.
- **`run` vs. `execute`**: Das eingebaute `run` startet die App des Projekts. `execute` ist eine Aufgabenschleife über `tasks.md` unter den Regeln Do-Not-Touch und Rebuild, eingebettet in ein natives Goal, und endet mit der festen Abschlussprüfung (verifizieren → aufräumen → erneut verifizieren → unabhängiges Review → fertig).
- **`verify` vs. `mf-verify`**: `mf-verify` wechselt immer den Kontext (nur lesender verifier-Subagent), leitet seine Kriterien aus `tasks.md`, den Spec-Szenarien und `design.md` ab, prüft das Diff gegen Do-Not-Touch, prüft, ob die Rebuild-Schritte ausgeführt wurden, sucht nach Mustern vorgetäuschter Fertigstellung und schreibt einen Bericht, den `spec archive` verlangt.

## Subagent-Rollen

| Rolle | Kern | Claude-Modell | Codex-Effort | Verweigerte Werkzeuge |
|---|---|---|---|---|
| `planner` | Verwandelt einen Vorschlag in ein evidenzbasiertes Design und eine Aufgabenliste; liest den Code selbst; jede Aufgabe benennt ihre Verifikation | opus | high | keine (schreibt nur unter `changes/<name>/`) |
| `architect` | Nur lesender Design-Gutachter: Antithese, Spannung, Synthese; `CLEAR / WATCH / BLOCK` | opus | high | Write, Edit |
| `critic` | Entscheidet, ob der Plan ohne Raten ausführbar ist; simuliert zwei oder drei Aufgaben; `OKAY / REJECT` mit höchstens fünf Korrekturen | sonnet | medium | Write, Edit |
| `verifier` | Nur frische Belege; führt die Prüfungen selbst aus; Status pro Kriterium; billigt nie Arbeit aus dem eigenen Kontext | sonnet | medium | Write, Edit |

Claude spricht sie als `my-flow:planner` usw. an. Codex lädt sie aus `~/.codex/agents/<name>.toml`; TOML kennt keine Werkzeug-Allowlist, daher wird der Nur-Lese-Modus durch Prosa durchgesetzt (und headless durch `-s read-only`).

## Hooks

| Ereignis | Skript | Verhalten |
|---|---|---|
| SessionStart | `hooks/session-context.mjs` | Wenn das Projekt `changes/` enthält, listet es die aktiven Changes mit abgehakten / gesamten Aufgaben und Artefaktzustand auf. Beendet sich immer mit Exit-Code 0 |
| Stop | `hooks/completion-guard.mjs` | Wenn die letzte Nachricht Fertigstellung behauptet, das Diff aber noch `test.skip`, `.only`, Platzhalter-TODOs oder Stub-Rückgaben enthält, blockiert es und erklärt warum; während `execute` blockiert er außerdem eine Fertigstellungsbehauptung, solange tasks.md noch unerledigte, nicht als blocked markierte Aufgaben enthält und die Zustandsdatei jünger als 12 h ist (`MY_FLOW_EXECUTE_GUARD_TTL_HOURS`). Nachrichten ohne Fertigstellungsbehauptung werden nie blockiert |

Beide Skripte werden von Claude (über `hooks/hooks.json` im Plugin) und Codex (über das PowerShell-Shim) gemeinsam genutzt. Deaktivieren Sie sie mit `MY_FLOW_SKIP_HOOKS=completion-guard` oder `execute-guard` (oder `all`). Die TTL des execute-guard beträgt standardmäßig 12 Stunden; überschreiben Sie sie mit `MY_FLOW_EXECUTE_GUARD_TTL_HOURS`.

## Modellübergreifender Berater

```bash
node scripts/ask.mjs codex --diff "Review this diff for correctness"
node scripts/ask.mjs claude --files src/a.ts,src/b.ts "Is this abstraction justified?"
```

- Der Prompt geht immer über stdin (nie über argv), die andere CLI läuft nur lesend (`codex exec -s read-only`, `claude -p --permission-mode plan`), mit einem Timeout; Exit-Code 0 mit leerer Ausgabe zählt als Fehlschlag.
- Artefakte landen in `.my-flow/ask/<time>-<provider>-<slug>.md` mit den Abschnitten Original task / Final prompt / Raw output / Summary / Action items.
- Wählen Sie das Modell mit `--model` oder den Umgebungsvariablen `MY_FLOW_CODEX_MODEL` / `MY_FLOW_CLAUDE_MODEL` (nützlich, wenn das Modell in Ihrer Codex-Konfiguration neuer ist, als die installierte CLI unterstützt, z. B. `--model gpt-5.5`).
- Meinungsverschiedenheiten werden durch Belege oder durch Sie entschieden, nie per Mehrheit.

## Dashboard

```bash
node scripts/cli.mjs dashboard start                     # http://127.0.0.1:4321/
node scripts/cli.mjs dashboard start --port 4400 --root /path/to/project
node scripts/cli.mjs dashboard status
node scripts/cli.mjs dashboard stop
```

Eine lokale Web-Ansicht der Intent-Ebene ohne Abhängigkeiten: Node-Bordmittel auf dem Server, handgeschriebenes HTML, CSS und JavaScript im Browser, nichts wird aus dem Netz geladen. Der Server bindet nur `127.0.0.1` und lehnt Anfragen ab, deren `Host` oder `Origin` nicht sein eigener ist; weder andere Rechner noch andere Webseiten erreichen ihn.

- **Changes**: jeder aktive Change mit Stage, Aufgabenfortschritt, Artefaktzustand, Stale- und Overlap-Warnungen; jeder Change listet `proposal.md`, `design.md`, `tasks.md` und seine Delta-Specs.
- **Specs**: `specs/<capability>/spec.md` mit seinen Anforderungen; ein `<!-- via: ... -->`-Marker verweist auf den archivierten Change, der die Anforderung erzeugt hat.
- **Archive**: archivierte und aufgegebene Changes, nur lesend.
- **Scratch**: `.my-flow/ask/`, `.my-flow/verify/`, `.my-flow/interviews/`, nur lesend.

Die Seiten aktualisieren sich live über Server-Sent Events, sobald sich eine Datei unter `specs/`, `changes/` oder `.my-flow/` ändert; eine im Terminal abgehakte Aufgabe erscheint ohne Neuladen im Browser. Markdown unter `specs/` und unter einem aktiven `changes/<name>/` lässt sich in der Seite bearbeiten. Ein Speichern wird abgelehnt, wenn sich die Datei seit dem Laden auf der Platte geändert hat; die Seite zeigt dann den neueren Inhalt und bietet Neu laden oder Überschreiben an. Die Zeilenenden der Datei bleiben erhalten. Das Bearbeiten ist für die Pausen zwischen den Stages gedacht, wenn kein Agent schreibt.

- **Theme**: Das Theme-Dropdown in der Seitenleiste überstimmt das Farbschema des Systems; die Wahl bleibt im Browser gespeichert.
- **Sperre während execute**: Solange der aktuelle Change in der Stage `execute` ist, wird jedes Speichern abgelehnt (HTTP 423) und der Editor zeigt statt Save den Grund an, weil ein Agent gerade schreibt. Die Sperre fällt, sobald `spec stage` den Change weiterschaltet.
- **Diff**: Ist das Projektverzeichnis ein Git-Arbeitsbaum, listet ein Eintrag `Diff` die Änderungen des Arbeitsbaums gegenüber `HEAD` (gestaged, ungestaged und unversioniert) als Baum oder flache Liste und rendert den Patch der gewählten Datei, nur lesend. Er aktualisiert sich nur bei Änderungen unter `specs/`, `changes/` und `.my-flow/`; nach anderen Änderungen die Schaltfläche Refresh benutzen. Ohne Git fehlt der Eintrag. Die zuletzt geänderte Datei ist markiert; `j` / `k` wechseln zwischen den Dateien und `.` springt zu dieser Datei.

`start` löst den Server vom Terminal und trägt ihn in `.my-flow/state/dashboard.json` ein; `stop` prüft, dass der eingetragene Prozess wirklich das Dashboard ist (lebt und `/api/health` mit derselben pid und demselben root beantwortet), bevor es ihn beendet, und räumt einen veralteten Eintrag auf, ohne irgendetwas zu signalisieren. Der Skill `/my-flow:dashboard start | stop | status` (Codex: `$my-flow-dashboard`) kapselt dieselben Befehle.

## Die Intent-Ebene

```
specs/<capability>/spec.md                 current truth: Requirement + Scenario (WHEN / THEN)
changes/<name>/proposal.md                 why, what, Non-Goals, Decision Boundaries
changes/<name>/design.md                   how; MUST contain ## Do-Not-Touch and ## Rebuild / Re-run After Change
changes/<name>/tasks.md                    ordered checklist; checkboxes are the only progress ledger
changes/<name>/specs/<capability>/spec.md  delta: ## ADDED | MODIFIED | REMOVED Requirements
changes/archive/<date>-<name>/             archived changes (deltas merged into specs/)
changes/.templates/                        templates used by `spec new`
```

Spec-Format:

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

Regeln: Jede Anforderung hat mindestens ein Szenario; Szenarien verwenden genau vier Rauten; Delta-Dateien platzieren vollständige Anforderungsblöcke unter `## ADDED Requirements`, `## MODIFIED Requirements` (vollständiger Ersatz) oder `## REMOVED Requirements`. Schreiben Sie Specs nur für Verhalten, das ein Change hinzufügt oder ändert; `specs/` füllt sich, während Changes archiviert werden.

Die beiden erforderlichen Abschnitte in `design.md` existieren, weil autonome Schleifen eine falsche Richtung teuer machen: `Do-Not-Touch` benennt die Module, die der Change nicht verändern darf, und `Rebuild / Re-run After Change` benennt, was nach jeder Bearbeitung neu generiert, neu gebaut, gecookt oder erneut ausgeführt werden muss (Projektdateien, Build-Ziele, Caches, Testsuiten). `mf-verify` prüft beides.

Projekte im `--simple`-Modus verwenden stattdessen eine einzelne `docs/changes/<name>.md` mit denselben Abschnitten.

## Repository-Struktur und Single-Source-Authoring

```
src/            single source of truth (English): core/core.md, skills/*.md, agents/*.md, rules/*.md
scripts/        build / install / init / spec / ask / cli
hooks/          the two Node hooks + the Codex PowerShell shim
templates/      project blocks (CLAUDE.md / AGENTS.md), change templates, specs README, simple-mode file
skills/ agents/ .claude-plugin/plugin.json   generated: Claude plugin surface
codex/          generated: Codex skills, agent TOMLs, AGENTS.md block, hooks template
claude/         generated: the block installed into ~/.claude/CLAUDE.md
```

Bearbeiten Sie `src/` und führen Sie anschließend `node scripts/build.mjs` aus. Generierte Dateien werden committet, damit `claude --plugin-dir` keinen Build-Schritt benötigt; `node scripts/build.mjs --check` schlägt fehl, wenn sie abweichen. `npm test` führt die eingebaute `node --test`-Suite für `spec.mjs` und den Stop-Hook aus; Abhängigkeiten sind nicht nötig.

Konventionen der Quellen:

- `{{ARGS}}` → Claude `$ARGUMENTS` / Codex `{{ARGUMENTS}}`
- `{{CALL:mf-plan}}` → Claude `/my-flow:mf-plan` / Codex `$my-flow-mf-plan`
- `<!-- MY-FLOW:CLAUDE --> … <!-- /MY-FLOW:CLAUDE -->` bleibt nur im Claude-Rendering erhalten; `CODEX` entsprechend
- Werkzeug-Allowlists pro Skill und Modellstufen pro Agent liegen in `manifest.json`
- `src/rules/*.md` sind Regelfragmente (Codestil, Tests, Git), die Sie in die `CLAUDE.md` / `AGENTS.md` eines Projekts einfügen können; sie werden nicht automatisch installiert

## Installation in Codex

```bash
node scripts/install.mjs codex --dry-run   # see what would change
node scripts/install.mjs codex             # backup, then skills, agents, shim, hooks.json, trusted hashes, AGENTS.md block
node scripts/install.mjs --uninstall codex # reverse
```

Falls Codex Sie weiterhin auffordert, den Hooks zu vertrauen, genehmigen Sie sie einmalig in `/hooks` (das passiert, wenn sich der Upstream-Hash-Algorithmus ändert).

Falls oh-my-codex installiert ist, entfernen Sie es zuerst, in dieser Reihenfolge:

1. Sichern Sie `~/.codex/{config.toml,hooks.json,AGENTS.md,hooks,skills,agents,prompts}`.
2. `omx uninstall --dry-run`, prüfen, dann `omx uninstall`.
3. Prüfen Sie `config.toml` auf Überreste: das Paar `--previous-notify …notify-hook.js` in `notify`, `developer_instructions`, die oh-my-codex erwähnen, `USE_OMX_EXPLORE_CMD` unter `[shell_environment_policy.set]`. Behalten Sie `[features] hooks / goals / multi_agent = true`.
4. `npm uninstall -g oh-my-codex`.
5. `node scripts/install.mjs codex`.

Der Installer überspringt jede `~/.codex/agents/<name>.toml`, die er nicht selbst erstellt hat, sodass von einem anderen Werkzeug hinterlassene Agents nie überschrieben werden.

## Fehlerbehebung

| Symptom | Ursache und Behebung |
|---|---|
| `ask codex` schlägt fehl mit „model requires a newer version of Codex“ | Das Modell in `~/.codex/config.toml` ist neuer als die CLI. Führen Sie `codex update` aus oder übergeben Sie `--model gpt-5.5` (oder setzen Sie `MY_FLOW_CODEX_MODEL`) |
| `ask codex` schlägt fehl mit `EINVAL` | Behoben in `scripts/lib/spawn.mjs`: `.cmd`-Shims unter Windows müssen über eine Shell laufen. Stellen Sie sicher, dass Sie die aktuelle Version verwenden |
| `/my-flow:learn` wird vom Modell nicht aufgelistet | Beabsichtigt. Es trägt `disable-model-invocation`; geben Sie es selbst ein |
| Der Stop-Hook blockiert ständig | Er blockiert nur, wenn die letzte Nachricht Fertigstellung behauptet **und** entweder das Diff Marker vorgetäuschter Fertigstellung enthält oder der aktuelle Change in Stufe `execute` noch unerledigte Aufgaben hat. Beheben Sie die Marker, erledigen oder blockieren Sie die Aufgaben, oder führen Sie `spec stage <name> done` aus. Umgehen mit `MY_FLOW_SKIP_HOOKS=completion-guard` oder `execute-guard` |
| Der execute-guard greift nie oder greift bei einem alten Change | Er liest `.my-flow/state/current-change.json` und ignoriert sie, sobald `updated` älter als 12 h ist. Führen Sie `spec stage <name> execute` zum Auffrischen aus, oder `spec stage <name> done` zum Freigeben |
| `spec archive` verweigert | Alle Boxen müssen abgehakt sein und ein Bericht mit `Verdict: PASS` muss unter `.my-flow/verify/` liegen. Führen Sie zuerst `mf-verify` aus oder verwenden Sie `--force` und sagen Sie das ausdrücklich |
| Codex bittet darum, den Hooks zu vertrauen | Einmalig in `/hooks` genehmigen; das Format der vertrauenswürdigen Hashes hat sich möglicherweise upstream geändert |
| Split-Pane-Teams unter Windows | Von Claude Code nicht unterstützt; Teams laufen im selben Prozess. Fragen Sie nicht nach tmux-Panes |

## Lizenz

MIT
