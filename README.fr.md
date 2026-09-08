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

Une couche de workflow légère qui fonctionne de la même manière dans **Claude Code** et **Codex CLI**. Elle n'ajoute aucun runtime et ne dépend d'aucun outil externe. Elle vous apporte :

- un flux unique en quatre étapes : `interview → mf-plan → execute → mf-verify`
- sept skills et quatre rôles de sous-agents (dont trois en lecture seule)
- deux hooks : injection du changement actif au démarrage de la session, blocage des fausses déclarations de « terminé » à l'arrêt
- un conseiller inter-modèles : Claude interroge Codex, Codex interroge Claude, toujours en lecture seule
- une **couche d'intention** : `specs/` contient la vérité actuelle, `changes/<name>/` contient l'intention d'un changement. La structure est empruntée à OpenSpec, mais my-flow fournit ses propres commandes `new / status / validate / archive` ; OpenSpec lui-même n'est donc pas requis

Tout ce que oh-my-claudecode et oh-my-codex encapsulaient autrefois (équipes d'agents, `/goal`, worktrees, hooks, skills, plugins) est utilisé directement via les fonctionnalités natives des deux CLI.

## Table des matières

1. [Positionnement](#positionnement)
2. [Prérequis](#prérequis)
3. [Démarrage rapide](#démarrage-rapide)
4. [Concepts](#concepts)
5. [Commandes CLI](#commandes-cli)
6. [Skills](#skills)
7. [Rôles des sous-agents](#rôles-des-sous-agents)
8. [Hooks](#hooks)
9. [Conseiller inter-modèles](#conseiller-inter-modèles)
10. [La couche d'intention](#la-couche-dintention)
11. [Structure du dépôt et rédaction à source unique](#structure-du-dépôt-et-rédaction-à-source-unique)
12. [Installation dans Codex](#installation-dans-codex)
13. [Dépannage](#dépannage)
14. [Licence](#licence)

## Positionnement

| Outil / projet | Rôle |
|---|---|
| Claude Code | Exécuteur principal pour le développement interactif quotidien (équipes d'agents natives + `/goal`) |
| Codex | Conseiller et contre-vérificateur : relit les conceptions et les diffs, tranche en cas d'égalité. N'implémente que lorsque vous invoquez explicitement `$my-flow-execute` |
| OpenSpec | Seules ses idées et sa structure de répertoires sont empruntées (specs / changes / delta specs / cases à cocher de tasks.md). Pas de CLI, pas de commandes `/opsx` |
| oh-my-claudecode | Optionnel. my-flow couvre déjà le conseiller inter-modèles et l'extraction de skills ; utilisez claude-hud pour le HUD |
| oh-my-codex | Non nécessaire. Ses conventions de flux sont distillées dans `src/core/core.md` et dans les skills |

## Prérequis

- Node.js 20 ou plus récent (les scripts et les hooks sont du Node pur, sans dépendances)
- Claude Code 2.1.x pour le côté Claude
- Codex CLI 0.135 ou plus récent pour le côté Codex (fonctionnalités `hooks`, `goals`, `multi_agent` activées)
- Windows 11 est la cible principale ; tout fonctionne sans tmux ni WSL. macOS et Linux fonctionnent avec les mêmes scripts

## Démarrage rapide

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

Ensuite, dans Claude Code : `/my-flow:interview my-first-change` → `/my-flow:mf-plan my-first-change` → `/my-flow:execute my-first-change` → `/my-flow:mf-verify my-first-change`.

Le côté Codex est optionnel ; voir [Installation dans Codex](#installation-dans-codex).

## Concepts

### Les quatre étapes

| Votre demande ressemble à | Étapes à utiliser |
|---|---|
| Concrète, un seul fichier, acceptation claire | `execute` seul (ou faites-le directement) |
| Concrète mais multi-fichiers ou multi-modules | `mf-plan → execute → mf-verify` |
| Vague, sans critères d'acceptation, « devrions-nous... » | `interview → mf-plan → execute → mf-verify` |
| Touche la configuration de build, les shaders, les modules moteur, les migrations, l'authentification | ne sautez jamais `mf-plan` ni `mf-verify` |

Règles valables à toutes les étapes :

- `interview` pose une question par tour et ne s'arrête que lorsque les non-objectifs et les limites de décision sont explicites.
- `mf-plan` n'implémente jamais. `execute` ne reconçoit jamais ; si la conception est erronée, arrêtez-vous et revenez en arrière.
- `mf-verify` s'exécute toujours dans un contexte distinct de celui qui a écrit le code.
- Les cases à cocher de `tasks.md` sont le seul registre de progression. Une case n'est cochée qu'après la réussite de la vérification propre à cette tâche.

### Pourquoi le préfixe `mf-`

Claude Code possède un `/plan` intégré (mode plan) et des skills fournis nommés `run` et `verify`. Les skills de plugin sont toujours préfixés par un espace de noms (`/my-flow:...`), rien n'est donc écrasé, mais le modèle choisit les skills d'après leur nom et leur description. Des noms distincts lèvent l'ambiguïté :

| Étape | Skill | Pourquoi pas le nom évident |
|---|---|---|
| Interview | `interview` | aucun conflit |
| Plan | `mf-plan` | le `/plan` intégré est le mode plan |
| Exécution | `execute` | le skill intégré `run` lance l'application du projet |
| Vérification | `mf-verify` | skill intégré `verify` |

### Une seule autorité de boucle par session

Dans Claude Code, au plus un `/goal` et au plus une équipe d'agents par session. `execute` affiche l'énoncé `/goal` que vous devez coller (les skills ne peuvent pas le définir eux-mêmes). Dans Codex, un goal par fil ; `execute` n'appelle `create_goal` que si aucun n'est actif.

### Ce que font respectivement Claude et Codex

Claude Code effectue le travail interactif et exécute les boucles. Codex relit, planifie, vérifie et répond aux requêtes `ask`. Il n'implémente que lorsque vous invoquez explicitement `$my-flow-execute`. Ni tmux, ni runtime d'équipe, ni démon d'état ne sont impliqués d'un côté ou de l'autre.

## Commandes CLI

Toutes les commandes sont de simples scripts Node. `node scripts/cli.mjs <command>` (ou `my-flow <command>` après `npm link`) les distribue.

| Commande | Ce qu'elle fait | Remarques |
|---|---|---|
| `build [--check]` | Génère le plugin Claude et la surface Codex à partir de `src/` | À exécuter après modification de `src/`. `--check` compare seulement et quitte avec le code 1 lorsque les sorties sont obsolètes |
| `install claude [--dry-run]` | Sauvegarde `~/.claude/settings.json`, définit `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, insère ou met à jour l'accord de travail dans `~/.claude/CLAUDE.md` | Affiche les commandes d'installation du plugin sans les exécuter |
| `install codex [--link] [--dry-run]` | Sauvegarde, puis copie les skills et les TOML d'agents, écrit le shim PowerShell, fusionne `hooks.json`, écrit les hachages de confiance dans `config.toml`, insère ou met à jour `~/.codex/AGENTS.md` | `--link` utilise des jonctions au lieu de copies |
| `uninstall codex [--dry-run]` | Annule `install codex` en préservant tout le reste de `~/.codex` | |
| `init [--simple] [--tools claude,codex] [dir]` | Crée `specs/`, `changes/` (avec `.templates/` et `archive/`), `specs/README.md`, `.claude/rules/specs.md`, `.my-flow/`, et ajoute un bloc au `CLAUDE.md` / `AGENTS.md` du projet | `--simple` bascule vers un seul `docs/changes/<name>.md` par changement |
| `spec new <name>` | Crée `changes/<name>/{proposal,design,tasks}.md` à partir des modèles et le marque comme courant | noms en kebab-case |
| `spec status [name] [--json]` | Tâches cochées / totales, état des artefacts (missing / empty / done), nombre de delta specs | Les modèles non modifiés comptent comme vides |
| `spec validate [name] [--json]` | Vérifications structurelles : sections requises, format des lignes de tâches, format des scénarios, sections delta | Code de sortie 1 en cas d'erreur |
| `spec archive <name> [--force]` | Exige que toutes les cases soient cochées et qu'un rapport PASS existe sous `.my-flow/verify/` ; fusionne les delta specs dans `specs/` et déplace le changement vers `changes/archive/` | `--force` contourne la barrière |
| `ask <codex\|claude> [--diff] [--files a,b] [--model m] [--timeout ms] <question>` | Exécute l'autre CLI en lecture seule comme conseiller ; écrit un artefact dans `.my-flow/ask/` | Le prompt passe par stdin ; une sortie vide compte comme un échec |

## Skills

Claude les invoque sous la forme `/my-flow:<name>`, Codex sous la forme `$my-flow-<name>`.

| Skill | Quand | Ce qu'il fait | Sortie |
|---|---|---|---|
| `interview <idea> [--quick] [--change <name>]` | Demande vague, sans critères d'acceptation | Une question par tour, l'intention avant le détail ; évalue l'ambiguïté ; se termine lorsque les Non-Goals et les Decision Boundaries sont explicites | `changes/<name>/proposal.md`, transcription dans `.my-flow/interviews/` |
| `mf-plan <name \| text> [--deliberate]` | Changements multi-fichiers ; tout ce qui touche la configuration de build, les shaders, les modules moteur, les migrations, l'authentification | planner rédige → architect relit (`CLEAR / WATCH / BLOCK`) → critic relit (`OKAY / REJECT`), jusqu'à trois tours | `design.md` (doit contenir Do-Not-Touch et Rebuild / Re-run), `tasks.md` |
| `execute <name> [--team] [--worktree]` | `tasks.md` contient des cases non cochées | Compose l'énoncé du goal ; implémente tâche par tâche, vérifie, coche ; exécute la barrière finale fixe | Claude : affiche `/goal …` à coller. Codex : `create_goal` |
| `mf-verify <name \| criteria>` | Avant toute déclaration de « terminé » | Délègue au verifier en lecture seule, qui exécute lui-même les vérifications et rend compte critère par critère | `.my-flow/verify/<name>-<time>.md` avec PASS / FAIL / INCOMPLETE |
| `ask <codex\|claude> [--diff] [--files] <question>` | Second avis sur une conception, relecture du diff avant la barrière finale, arbitrage lorsque la planification s'enlise | Encapsule le script `ask`, résume et indique s'il est d'accord | `.my-flow/ask/` |
| `learn [name] [--dry-run]` | La session a résolu un problème difficile et spécifique au projet | Barrière de qualité en trois questions, puis extraction d'un SKILL.md | Écrit à la fois dans `.claude/skills/` et `.agents/skills/` |
| `spec new\|status\|validate\|archive` | Gestion de la couche d'intention | Encapsule le script `spec` et interprète sa sortie | identique au script |

`learn` porte `disable-model-invocation` ; vous seul pouvez l'appeler.

### En quoi les trois skills de flux diffèrent des skills intégrés

- **`/plan` vs `mf-plan`** : le mode plan est un mode de permission en lecture seule qui écrit un seul fichier de plan hors du projet et demande une approbation. `mf-plan` produit des artefacts commités (`design.md`, `tasks.md`) relus par trois rôles successifs, avec des sections requises et un format de tâches qui pilote ensuite `execute` et `mf-verify`. Vous pouvez toujours entrer d'abord dans `/plan` pour explorer.
- **`run` vs `execute`** : le `run` intégré lance l'application du projet. `execute` est une boucle de tâches sur `tasks.md` sous les règles Do-Not-Touch et Rebuild, enveloppée dans un goal natif, qui se termine par la barrière finale fixe (vérifier → nettoyer → re-vérifier → relecture indépendante → terminé).
- **`verify` vs `mf-verify`** : `mf-verify` change toujours de contexte (sous-agent verifier en lecture seule), dérive ses critères de `tasks.md`, des scénarios de spec et de `design.md`, confronte le diff à Do-Not-Touch, vérifie que les étapes Rebuild ont été exécutées, recherche les motifs de fausse complétion et rédige un rapport que `spec archive` exige.

## Rôles des sous-agents

| Rôle | Essence | Modèle Claude | Effort Codex | Outils refusés |
|---|---|---|---|---|
| `planner` | Transforme une proposition en une conception fondée sur des preuves et une liste de tâches ; lit lui-même le code ; chaque tâche nomme sa vérification | opus | high | aucun (n'écrit que sous `changes/<name>/`) |
| `architect` | Relecteur de conception en lecture seule : antithèse, tension, synthèse ; `CLEAR / WATCH / BLOCK` | opus | high | Write, Edit |
| `critic` | Décide si le plan est exécutable sans deviner ; simule deux ou trois tâches ; `OKAY / REJECT` avec au plus cinq corrections | sonnet | medium | Write, Edit |
| `verifier` | Preuves fraîches uniquement ; exécute lui-même les vérifications ; statut par critère ; n'approuve jamais un travail issu de son propre contexte | sonnet | medium | Write, Edit |

Claude les désigne par `my-flow:planner`, etc. Codex les charge depuis `~/.codex/agents/<name>.toml` ; le TOML n'a pas de liste d'outils autorisés, la lecture seule est donc imposée par le texte (et par `-s read-only` en mode headless).

## Hooks

| Événement | Script | Comportement |
|---|---|---|
| SessionStart | `hooks/session-context.mjs` | Si le projet contient `changes/`, liste les changements actifs avec les tâches cochées / totales et l'état des artefacts. Quitte toujours avec le code 0 |
| Stop | `hooks/completion-guard.mjs` | Si le dernier message déclare l'achèvement mais que le diff contient encore `test.skip`, `.only`, des TODO de remplissage ou des retours factices (stubs), bloque et explique pourquoi |

Les deux scripts sont partagés par Claude (via `hooks/hooks.json` dans le plugin) et Codex (via le shim PowerShell). Désactivez-les avec `MY_FLOW_SKIP_HOOKS=completion-guard` (ou `all`).

## Conseiller inter-modèles

```bash
node scripts/ask.mjs codex --diff "Review this diff for correctness"
node scripts/ask.mjs claude --files src/a.ts,src/b.ts "Is this abstraction justified?"
```

- Le prompt passe toujours par stdin (jamais par argv), l'autre CLI s'exécute en lecture seule (`codex exec -s read-only`, `claude -p --permission-mode plan`), avec un délai d'expiration ; un code de sortie 0 avec une sortie vide compte comme un échec.
- Les artefacts sont déposés dans `.my-flow/ask/<time>-<provider>-<slug>.md` avec les sections Original task / Final prompt / Raw output / Summary / Action items.
- Choisissez le modèle avec `--model` ou les variables d'environnement `MY_FLOW_CODEX_MODEL` / `MY_FLOW_CLAUDE_MODEL` (utile lorsque le modèle de votre configuration Codex est plus récent que ce que le CLI installé prend en charge, par ex. `--model gpt-5.5`).
- Les désaccords se résolvent par des preuves ou par vous, jamais à la majorité.

## La couche d'intention

```
specs/<capability>/spec.md                 current truth: Requirement + Scenario (WHEN / THEN)
changes/<name>/proposal.md                 why, what, Non-Goals, Decision Boundaries
changes/<name>/design.md                   how; MUST contain ## Do-Not-Touch and ## Rebuild / Re-run After Change
changes/<name>/tasks.md                    ordered checklist; checkboxes are the only progress ledger
changes/<name>/specs/<capability>/spec.md  delta: ## ADDED | MODIFIED | REMOVED Requirements
changes/archive/<date>-<name>/             archived changes (deltas merged into specs/)
changes/.templates/                        templates used by `spec new`
```

Format de spec :

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

Règles : chaque exigence a au moins un scénario ; les scénarios utilisent exactement quatre dièses ; les fichiers delta placent des blocs d'exigences complets sous `## ADDED Requirements`, `## MODIFIED Requirements` (remplacement intégral) ou `## REMOVED Requirements`. N'écrivez des specs que pour le comportement qu'un changement ajoute ou modifie ; `specs/` se remplit au fur et à mesure de l'archivage des changements.

Les deux sections obligatoires de `design.md` existent parce que les boucles autonomes rendent une mauvaise direction coûteuse : `Do-Not-Touch` nomme les modules que le changement ne doit pas modifier, et `Rebuild / Re-run After Change` nomme ce qui doit être régénéré, reconstruit, « cooké » ou réexécuté après chaque modification (fichiers de projet, cibles de build, caches, suites de tests). `mf-verify` vérifie les deux.

Les projets en mode `--simple` utilisent à la place un seul `docs/changes/<name>.md` avec les mêmes sections.

## Structure du dépôt et rédaction à source unique

```
src/            single source of truth (English): core/core.md, skills/*.md, agents/*.md, rules/*.md
scripts/        build / install / init / spec / ask / cli
hooks/          the two Node hooks + the Codex PowerShell shim
templates/      project blocks (CLAUDE.md / AGENTS.md), change templates, specs README, simple-mode file
skills/ agents/ .claude-plugin/plugin.json   generated: Claude plugin surface
codex/          generated: Codex skills, agent TOMLs, AGENTS.md block, hooks template
claude/         generated: the block installed into ~/.claude/CLAUDE.md
```

Modifiez `src/`, puis exécutez `node scripts/build.mjs`. Les fichiers générés sont commités afin que `claude --plugin-dir` n'exige aucune étape de build ; `node scripts/build.mjs --check` échoue lorsqu'ils divergent.

Conventions des sources :

- `{{ARGS}}` → Claude `$ARGUMENTS` / Codex `{{ARGUMENTS}}`
- `{{CALL:mf-plan}}` → Claude `/my-flow:mf-plan` / Codex `$my-flow-mf-plan`
- `<!-- MY-FLOW:CLAUDE --> … <!-- /MY-FLOW:CLAUDE -->` n'est conservé que dans le rendu Claude ; `CODEX` de même
- les listes d'outils autorisés par skill et les niveaux de modèle par agent se trouvent dans `manifest.json`
- `src/rules/*.md` sont des fragments de règles (style de code, tests, git) que vous pouvez coller dans le `CLAUDE.md` / `AGENTS.md` d'un projet ; ils ne sont pas installés automatiquement

## Installation dans Codex

```bash
node scripts/install.mjs codex --dry-run   # see what would change
node scripts/install.mjs codex             # backup, then skills, agents, shim, hooks.json, trusted hashes, AGENTS.md block
node scripts/install.mjs --uninstall codex # reverse
```

Si Codex vous demande encore d'approuver les hooks, approuvez-les une fois dans `/hooks` (cela se produit lorsque l'algorithme de hachage en amont change).

Si oh-my-codex est installé, supprimez-le d'abord, dans cet ordre :

1. Sauvegardez `~/.codex/{config.toml,hooks.json,AGENTS.md,hooks,skills,agents,prompts}`.
2. `omx uninstall --dry-run`, vérifiez, puis `omx uninstall`.
3. Vérifiez qu'il ne reste rien dans `config.toml` : la paire `--previous-notify …notify-hook.js` dans `notify`, des `developer_instructions` mentionnant oh-my-codex, `USE_OMX_EXPLORE_CMD` sous `[shell_environment_policy.set]`. Conservez `[features] hooks / goals / multi_agent = true`.
4. `npm uninstall -g oh-my-codex`.
5. `node scripts/install.mjs codex`.

L'installateur ignore tout `~/.codex/agents/<name>.toml` qu'il n'a pas créé ; les agents laissés par un autre outil ne sont donc jamais écrasés.

## Dépannage

| Symptôme | Cause et correctif |
|---|---|
| `ask codex` échoue avec « model requires a newer version of Codex » | Le modèle dans `~/.codex/config.toml` est plus récent que le CLI. Exécutez `codex update`, ou passez `--model gpt-5.5` (ou définissez `MY_FLOW_CODEX_MODEL`) |
| `ask codex` échoue avec `EINVAL` | Corrigé dans `scripts/lib/spawn.mjs` : les shims `.cmd` sous Windows doivent passer par un shell. Assurez-vous d'utiliser la version actuelle |
| `/my-flow:learn` n'est pas listé par le modèle | Voulu. Il porte `disable-model-invocation` ; saisissez-le vous-même |
| Le hook Stop bloque sans cesse | Il ne bloque que lorsque le dernier message déclare l'achèvement **et** que le diff contient des marqueurs de fausse complétion. Corrigez-les ou signalez-les comme bloquants. Contournez avec `MY_FLOW_SKIP_HOOKS=completion-guard` |
| `spec archive` refuse | Toutes les cases doivent être cochées et un rapport contenant `Verdict: PASS` doit exister sous `.my-flow/verify/`. Exécutez d'abord `mf-verify`, ou utilisez `--force` en le signalant explicitement |
| Codex demande d'approuver les hooks | Approuvez une fois dans `/hooks` ; le format des hachages de confiance a peut-être changé en amont |
| Équipes en volets partagés sous Windows | Non pris en charge par Claude Code ; les équipes s'exécutent dans le même processus. Ne demandez pas de volets tmux |

## Licence

MIT
