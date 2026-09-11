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
10. [Tableau de bord](#tableau-de-bord)
11. [Plugins](#plugins)
12. [La couche d'intention](#la-couche-dintention)
13. [Structure du dépôt et rédaction à source unique](#structure-du-dépôt-et-rédaction-à-source-unique)
14. [Installation dans Codex](#installation-dans-codex)
15. [Dépannage](#dépannage)
16. [Licence](#licence)

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
| Concret, multi-fichiers, conception déjà claire | `mf-plan --fast [--go] → execute → mf-verify` |
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

Dans Claude Code, au plus un `/goal` et au plus une équipe d'agents par session. `execute` affiche l'énoncé `/goal` que vous devez coller (les skills ne peuvent pas le définir eux-mêmes) ; le hook Stop n'est qu'un filet de sécurité qui bloque les déclarations d'achèvement laissant des tâches non cochées pendant `execute`, et seulement tant que l'état écrit par `spec stage` est frais. Dans Codex, un goal par fil ; `execute` n'appelle `create_goal` que si aucun n'est actif. Une exécution lancée depuis `mf-plan --fast --go` s'arrête elle aussi une fois pour que vous colliez le `/goal`.

### Ce que font respectivement Claude et Codex

Claude Code effectue le travail interactif et exécute les boucles. Codex relit, planifie, vérifie et répond aux requêtes `ask`. Il n'implémente que lorsque vous invoquez explicitement `$my-flow-execute`. Ni tmux, ni runtime d'équipe, ni démon d'état ne sont impliqués d'un côté ou de l'autre.

## Commandes CLI

Toutes les commandes sont de simples scripts Node. `node scripts/cli.mjs <command>` (ou `my-flow <command>` après `npm link`) les distribue.

| Commande | Ce qu'elle fait | Remarques |
|---|---|---|
| `build [--check]` | Génère le plugin Claude et la surface Codex à partir de `src/` | À exécuter après modification de `src/`. `--check` compare seulement et quitte avec le code 1 lorsque les sorties sont obsolètes |
| `install claude [--dry-run]` | Sauvegarde `~/.claude/settings.json`, définit `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, insère ou met à jour l'accord de travail dans `~/.claude/CLAUDE.md`. Sous Windows, enregistre aussi la tâche planifiée `my-flow-models-check` (`conhost.exe --headless node scripts/models.mjs check --quiet --home <MY_FLOW_HOME>`) et note le home de l'outil dans `~/.my-flow/config.json` | Affiche les commandes d'installation du plugin sans les exécuter |
| `install codex [--link] [--dry-run]` | Sauvegarde, puis copie les skills et les TOML d'agents, écrit le shim PowerShell, fusionne `hooks.json`, écrit les hachages de confiance dans `config.toml`, insère ou met à jour `~/.codex/AGENTS.md`. Sous Windows, enregistre aussi la tâche planifiée `my-flow-models-check` et note le home et le répertoire des agents dans `~/.my-flow/config.json` | `--link` utilise des jonctions au lieu de copies |
| `uninstall codex [--dry-run]` | Annule `install codex` en préservant tout le reste de `~/.codex`. Retire le home Codex de `~/.my-flow/config.json` ; supprime la tâche planifiée `my-flow-models-check` seulement s'il ne reste aucune autre surface |  |
| `init [--simple] [--tools claude,codex] [dir]` | Crée `specs/`, `changes/` (avec `.templates/` et `archive/`), `specs/README.md`, `.claude/rules/specs.md`, `.my-flow/`, et ajoute un bloc au `CLAUDE.md` / `AGENTS.md` du projet | `--simple` bascule vers un seul `docs/changes/<name>.md` par changement |
| `spec new <name>` | Crée `changes/<name>/{proposal,design,tasks}.md` à partir des modèles et le marque comme courant | noms en kebab-case |
| `spec status [name] [--json]` | Tâches cochées / totales, état des artefacts (missing / empty / done), nombre de delta specs ; marque `[stale Nd]` les changements inachevés intouchés depuis 14 jours (`--stale-days`, `MY_FLOW_STALE_DAYS`), `overlap:` quand deux changements revendiquent la même exigence, `audit suggested:` après 5 fusions dans une capability (`MY_FLOW_AUDIT_EVERY`) | Les modèles non modifiés comptent comme vides |
| `spec validate [name] [--json]` | Vérifications structurelles : sections requises, format des lignes de tâches, format des scénarios, sections delta ; les exigences MODIFIED / REMOVED sont vérifiées par rapport à la spec principale | Code de sortie 1 en cas d'erreur |
| `spec archive <name> [--force]` | Exige que toutes les cases soient cochées et qu'un rapport PASS existe sous `.my-flow/verify/` ; fusionne les delta specs dans `specs/` et déplace le changement vers `changes/archive/` | `--force` contourne la barrière |
| `spec abandon <name> --reason "..." [--force]` | Troisième sortie pour un changement qui ne sera pas terminé : exige une section `## Abandoned` avec une ligne `**Reason**:` (`--reason` l'ajoute), déplace le changement vers `changes/archive/<date>-<name>-abandoned/`, ne fusionne rien | Refuse un changement entièrement coché (utiliser `archive`). Enregistre aussi un audit propre : `spec new audit-<cap>` puis `spec abandon audit-<cap> --reason "..."` |
| `spec stage <name> <stage>` | Écrit `.my-flow/state/current-change.json` (`new`, `interview`, `mf-plan`, `execute`, `done`, `archived`) avec un horodatage `updated` frais | L'execute-guard ne se déclenche que si ce fichier a moins de 12 h |
| `ask <codex\|claude> [--diff] [--files a,b] [--model m] [--timeout ms] <question>` | Exécute l'autre CLI en lecture seule comme conseiller ; écrit un artefact dans `.my-flow/ask/` | Le prompt passe par stdin ; une sortie vide compte comme un échec |
| `dashboard [start\|stop\|status] [--port N] [--root dir] [--json]` | Tableau de bord web local sur `specs/`, `changes/` et `.my-flow/` : mises à jour en direct, édition protégée ; `stop` vérifie le processus enregistré avant de le terminer | Loopback uniquement, port 4321 par défaut, aucune dépendance |
| `models [status\|analyze\|apply\|reset] [--json] [--provider claude\|codex] [--dry-run]` | Routage des modèles des sous-agents : `status` affiche les versions de CLI enregistrées, la surcharge locale (ou aucune) et les valeurs relues dans les fichiers d'agent installés ; `analyze` demande à la CLI la plus puissante disponible une correspondance rôle -> modèle / effort, la valide et l'applique ; `apply` regénère les fichiers installés depuis `~/.my-flow/models.json` ; `reset` supprime la surcharge et rétablit la base `inherit` | N'écrit que sous `~/.my-flow/` (`MY_FLOW_HOME`), `~/.codex/agents/` et le `agents/` du plugin Claude installé ; jamais dans le dépôt |
| `plugin add\|remove\|list\|enable\|disable [--json] [--dry-run]` | Registre des plugins : `add <path\|git-url>` valide le `my-flow-plugin.json` d'un dépôt de plugin et l'enregistre, `list` affiche la version, l'état du setup et l'état par surface, `enable` / `disable` / `remove` le gèrent ; un verbe fourni par un plugin s'appelle ensuite `my-flow <verb>` | N'écrit que `~/.my-flow/plugins.json` et, pour une source git, le clone sous `~/.my-flow/plugins/` ; jamais dans le dépôt |

## Skills

Claude les invoque sous la forme `/my-flow:<name>`, Codex sous la forme `$my-flow-<name>`.

| Skill | Quand | Ce qu'il fait | Sortie |
|---|---|---|---|
| `interview <idea> [--quick] [--change <name>]` | Demande vague, sans critères d'acceptation | Une question par tour, l'intention avant le détail ; évalue l'ambiguïté ; se termine lorsque les Non-Goals et les Decision Boundaries sont explicites | `changes/<name>/proposal.md`, transcription dans `.my-flow/interviews/` |
| `mf-plan <name \ | text> [--deliberate] [--fast [--go]]` | Changements multi-fichiers ; tout ce qui touche la configuration de build, les shaders, les modules moteur, les migrations, l'authentification. Avec `--fast` vous écrivez vous-même les artefacts, une passe du critic, ni planner ni architect ; refusé pour les catégories à haut risque (et avec `--deliberate`) ; `--go` enchaîne directement sur execute | planner rédige → architect relit (`CLEAR / WATCH / BLOCK`) → critic relit (`OKAY / REJECT`), jusqu'à trois tours | `design.md` (doit contenir Do-Not-Touch et Rebuild / Re-run), `tasks.md` |
| `execute <name> [--team] [--worktree]` | `tasks.md` contient des cases non cochées | Compose l'énoncé du goal ; implémente tâche par tâche, vérifie, coche ; exécute la barrière finale fixe. Peut aussi être lancé depuis `mf-plan --fast --go`, qui s'arrête elle aussi pour que vous colliez le `/goal` | Claude : affiche `/goal …` à coller. Codex : `create_goal` |
| `mf-verify <name \| criteria>` | Avant toute déclaration de « terminé » | Délègue au verifier en lecture seule, qui exécute lui-même les vérifications et rend compte critère par critère | `.my-flow/verify/<name>-<time>.md` avec PASS / FAIL / INCOMPLETE |
| `mf-audit <capability \| all>` | `spec status` affiche `audit suggested`, ou l'utilisateur dit « audit the spec » | Passe en lecture seule de l'architect comparant `specs/<cap>/spec.md` au code et aux tests : exigences non implémentées, comportement non documenté, contradictions, exigences mal placées ; ne modifie jamais `specs/` | `.my-flow/verify/audit-<cap>-<time>.md` avec `Status: CLEAN / DRIFT / BROKEN` et un nom de changement suggéré se terminant par `audit-<cap>` |
| `ask <codex\|claude> [--diff] [--files] <question>` | Second avis sur une conception, relecture du diff avant la barrière finale, arbitrage lorsque la planification s'enlise | Encapsule le script `ask`, résume et indique s'il est d'accord | `.my-flow/ask/` |
| `learn [name] [--dry-run]` | La session a résolu un problème difficile et spécifique au projet | Barrière de qualité en trois questions, puis extraction d'un SKILL.md | Écrit à la fois dans `.claude/skills/` et `.agents/skills/` |
| `spec new\|status\|validate\|abandon\|archive\|stage` | Gestion de la couche d'intention | Encapsule le script `spec` et interprète sa sortie | identique au script |
| `dashboard start\|stop\|status` | Suivre un changement dans le navigateur, modifier une proposition ou une spec hors du terminal | Enveloppe le script `dashboard` : le lance détaché et affiche l'URL, ou l'arrête | `.my-flow/state/dashboard.json` |

`learn` porte `disable-model-invocation` ; vous seul pouvez l'appeler.

### En quoi les trois skills de flux diffèrent des skills intégrés

- **`/plan` vs `mf-plan`** : le mode plan est un mode de permission en lecture seule qui écrit un seul fichier de plan hors du projet et demande une approbation. `mf-plan` produit des artefacts commités (`design.md`, `tasks.md`) relus par trois rôles successifs, avec des sections requises et un format de tâches qui pilote ensuite `execute` et `mf-verify`. Vous pouvez toujours entrer d'abord dans `/plan` pour explorer. La voie rapide `mf-plan --fast` se situe entre les deux : mêmes artefacts commités et même suite du flux, mais une seule passe du critic au lieu du consensus à trois rôles.
- **`run` vs `execute`** : le `run` intégré lance l'application du projet. `execute` est une boucle de tâches sur `tasks.md` sous les règles Do-Not-Touch et Rebuild, enveloppée dans un goal natif, qui se termine par la barrière finale fixe (vérifier → nettoyer → re-vérifier → relecture indépendante → terminé).
- **`verify` vs `mf-verify`** : `mf-verify` change toujours de contexte (sous-agent verifier en lecture seule), dérive ses critères de `tasks.md`, des scénarios de spec et de `design.md`, confronte le diff à Do-Not-Touch, vérifie que les étapes Rebuild ont été exécutées, recherche les motifs de fausse complétion et rédige un rapport que `spec archive` exige.

## Rôles des sous-agents

| Rôle | Essence | Modèle | Effort Codex | Sandbox Codex | Outils refusés |
|---|---|---|---|---|---|
| `planner` | Transforme une proposition en une conception fondée sur des preuves et une liste de tâches ; lit lui-même le code ; chaque tâche nomme sa vérification | inherit | high | aucun | aucun (n'écrit que sous `changes/<name>/`) |
| `architect` | Relecteur de conception en lecture seule : antithèse, tension, synthèse ; `CLEAR / WATCH / BLOCK` | inherit | high | read-only | Write, Edit |
| `critic` | Décide si le plan est exécutable sans deviner ; simule deux ou trois tâches ; `OKAY / REJECT` avec au plus cinq corrections | inherit | medium | read-only | Write, Edit |
| `verifier` | Preuves fraîches uniquement ; exécute lui-même les vérifications ; statut par critère ; n'approuve jamais un travail issu de son propre contexte | inherit | medium | aucun (reste en lecture seule par le prompt pour pouvoir exécuter les tests) | Write, Edit |

Sur les deux CLI, les rôles héritent du modèle de la session principale (Claude `model: inherit` ; Codex omet `model`, donc le modèle de la session parente s'applique). La commande `models` (section Commandes CLI) peut le surcharger localement par rôle ; `models status` affiche les valeurs effectives.

Claude les désigne par `my-flow:planner`, etc. Codex les charge depuis `~/.codex/agents/<name>.toml` ; le TOML n'a pas de liste d'outils autorisés, la lecture seule est donc imposée par le texte (et par `-s read-only` en mode headless).

## Hooks

| Événement | Script | Comportement |
|---|---|---|
| SessionStart | `hooks/session-context.mjs` | Si le projet contient `changes/`, liste les changements actifs avec les tâches cochées / totales et l'état des artefacts. Quitte toujours avec le code 0. Affiche aussi le résumé de routage des modèles en attente (une ligne, une fois) et, au plus une fois par `MY_FLOW_MODELS_CHECK_HOURS` (1 par défaut, `0` = à chaque démarrage), lance un `models check` détaché qui sonde les versions des CLI et, seulement si elles ont changé, exécute l'analyse en arrière-plan. Le hook lui-même n'appelle jamais de modèle. Désactivez la partie routage avec `MY_FLOW_SKIP_HOOKS=model-routing`. Sous Windows, la vérification est lancée via la tâche planifiée `my-flow-models-check` enregistrée par `install claude` / `install codex` (le Planificateur de tâches l'exécute hors du job object du hook, que Codex détruit) ; sans tâche, ou si `schtasks /run` échoue, elle retombe sur un processus enfant détaché |
| Stop | `hooks/completion-guard.mjs` | Si le dernier message déclare l'achèvement mais que le diff contient encore `test.skip`, `.only`, des TODO de remplissage ou des retours factices (stubs), bloque et explique pourquoi ; pendant `execute`, il bloque aussi une déclaration d'achèvement tant que tasks.md contient des tâches non cochées et non marquées blocked, à condition que le fichier d'état ait moins de 12 h (`MY_FLOW_EXECUTE_GUARD_TTL_HOURS`). Les messages sans déclaration d'achèvement ne sont jamais bloqués |

Les deux scripts sont partagés par Claude (via `hooks/hooks.json` dans le plugin) et Codex (via le shim PowerShell). Désactivez-les avec `MY_FLOW_SKIP_HOOKS=completion-guard` ou `execute-guard` (ou `all`). Le TTL de l'execute-guard est de 12 heures par défaut ; remplacez-le avec `MY_FLOW_EXECUTE_GUARD_TTL_HOURS`.

## Conseiller inter-modèles

```bash
node scripts/ask.mjs codex --diff "Review this diff for correctness"
node scripts/ask.mjs claude --files src/a.ts,src/b.ts "Is this abstraction justified?"
```

- Le prompt passe toujours par stdin (jamais par argv), l'autre CLI s'exécute en lecture seule (`codex exec -s read-only`, `claude -p --permission-mode plan`), avec un délai d'expiration ; un code de sortie 0 avec une sortie vide compte comme un échec.
- Les artefacts sont déposés dans `.my-flow/ask/<time>-<provider>-<slug>.md` avec les sections Original task / Final prompt / Raw output / Summary / Action items.
- Choisissez le modèle avec `--model` ou les variables d'environnement `MY_FLOW_CODEX_MODEL` / `MY_FLOW_CLAUDE_MODEL` (utile lorsque le modèle de votre configuration Codex est plus récent que ce que le CLI installé prend en charge, par ex. `--model gpt-5.5`).
- Les désaccords se résolvent par des preuves ou par vous, jamais à la majorité.

## Tableau de bord

```bash
node scripts/cli.mjs dashboard start                     # http://127.0.0.1:4321/
node scripts/cli.mjs dashboard start --port 4400 --root /path/to/project
node scripts/cli.mjs dashboard status
node scripts/cli.mjs dashboard stop
```

Une vue web locale de la couche d'intention, sans dépendance : les modules intégrés de Node côté serveur, du HTML, CSS et JavaScript écrits à la main côté navigateur, rien n'est chargé depuis le réseau. Le serveur n'écoute que sur `127.0.0.1` et refuse les requêtes dont le `Host` ou l'`Origin` n'est pas le sien ; ni les autres machines ni les autres pages web ne peuvent l'atteindre.

- **Changes** : chaque changement actif avec son étape, la progression des tâches, l'état des artefacts, les avertissements stale et overlap ; chaque changement liste ses `proposal.md`, `design.md`, `tasks.md` et ses delta specs.
- **Specs** : `specs/<capability>/spec.md` avec ses exigences ; un marqueur `<!-- via: ... -->` renvoie au changement archivé qui a produit l'exigence.
- **Archive** : changements archivés et abandonnés, lecture seule.
- **Scratch** : `.my-flow/ask/`, `.my-flow/verify/`, `.my-flow/interviews/`, lecture seule.

Les pages se mettent à jour en direct par Server-Sent Events dès qu'un fichier change sous `specs/`, `changes/` ou `.my-flow/` : une tâche cochée dans le terminal apparaît dans le navigateur sans rechargement. Le markdown sous `specs/` et sous un `changes/<name>/` actif peut être modifié dans la page. Une sauvegarde est refusée si le fichier a changé sur le disque depuis son chargement ; la page affiche alors le contenu le plus récent et propose Recharger ou Écraser. Les fins de ligne du fichier sont préservées. L'édition est prévue pour les intervalles entre les étapes, quand aucun agent n'écrit.

- **Thème** : le menu déroulant de thème de la barre latérale remplace le schéma de couleurs du système ; le choix est conservé dans le navigateur.
- **Verrou pendant execute** : tant que le changement courant est à l'étape `execute`, toute sauvegarde est refusée (HTTP 423) et l'éditeur affiche la raison à la place de Save, parce qu'un agent est en train d'écrire. Le verrou se lève dès que `spec stage` fait avancer le changement.
- **Diff** : quand la racine du projet est un arbre de travail git, une entrée `Diff` liste les changements de l'arbre de travail par rapport à `HEAD` (indexés, non indexés et non suivis) sous forme d'arbre ou de liste plate et affiche le patch du fichier choisi, en lecture seule. Elle ne se rafraîchit seule que pour les modifications sous `specs/`, `changes/` et `.my-flow/` ; utilisez son bouton Refresh après des modifications ailleurs. Sans git, l'entrée est absente. Le fichier modifié le plus récemment est marqué ; `j` / `k` passent d'un fichier à l'autre et `.` saute à ce fichier.

`start` détache le serveur et l'enregistre dans `.my-flow/state/dashboard.json` ; `stop` confirme que le processus enregistré est bien le tableau de bord (vivant, et répondant à `/api/health` avec les mêmes pid et root) avant de le terminer, et nettoie une entrée périmée sans envoyer aucun signal. La skill `/my-flow:dashboard start | stop | status` (Codex : `$my-flow-dashboard`) enveloppe les mêmes commandes.

## Plugins

Un plugin est un dépôt indépendant avec `my-flow-plugin.json` à sa racine. Il peut fournir des
skills, des agents, des hooks, des verbes CLI et des serveurs MCP. Le cœur de my-flow reste sans
dépendance : il valide le manifeste et écrit la configuration des hôtes, sans jamais parler MCP
lui-même.

```
my-flow plugin add <path|git-url>   valider et enregistrer dans ~/.my-flow/plugins.json
my-flow plugin list [--json]        version, état du setup, état Claude / Codex, verbes, serveurs
my-flow plugin enable|disable <n>   basculer le drapeau
my-flow plugin remove <n>           retirer (et le clone, si my-flow l'a créé)
my-flow <verb> ...                  un verbe fourni par un plugin activé
```

Le manifeste déclare `name`, `version`, `description`, un `codexSkillPrefix` facultatif, et
`contributes` avec `skills`, `agents`, `hooks`, `cli` et `mcpServers`. `${PLUGIN_ROOT}` est le
seul espace réservé que my-flow substitue. Toute collision avec une commande du cœur, un rôle du
cœur, un répertoire de skill Codex du cœur ou un autre plugin enregistré est refusée par
`plugin add`, si bien que `install` n'a affaire qu'aux fichiers de l'hôte.

La fusion a lieu dans `install`, jamais dans le build : les fichiers générés sous `skills/`,
`agents/` et `codex/` sont versionnés et `npm run check` échoue dès qu'ils divergent.

- `install codex` rend chaque plugin activé dans le home Codex : les skills en
  `<codexSkillPrefix><skill>` avec le fichier marqueur `.my-flow-plugin`, les TOML d'agent avec
  l'en-tête `# my-flow agent: <role> (plugin <name>, ...)`, les hooks via le shim PowerShell avec
  leurs hachages de confiance, et les tables `[mcp_servers.<server>]` dans le bloc géré. Une
  table déjà définie hors de ce bloc l'emporte et est signalée :
  `skip [mcp_servers.<server>]: defined outside the my-flow block; remove it first to let my-flow manage it`.
- `uninstall codex` retire exactement ce qu'il a écrit, par marqueur, donc même un plugin déjà
  retiré du registre est nettoyé ; un répertoire sans marqueur n'est jamais touché.
- `install claude` imprime les trois commandes par plugin (`claude plugin marketplace add`,
  `claude plugin install`, un `claude mcp add --transport stdio --scope user ...` par serveur)
  et n'en exécute aucune ; `uninstall claude` imprime les `claude mcp remove` et
  `claude plugin disable` correspondants.
- Un plugin enregistré dont le répertoire a disparu, ou dont le manifeste est cassé, est ignoré
  avec `skip plugin <name>: <reason>` et n'interrompt jamais l'installation du cœur.

Sur Claude, un skill de plugin n'atteint du code à dépendances que par `my-flow <verb>`, jamais
par `${CLAUDE_PLUGIN_ROOT}/...`, car le cache de plugins peut contenir une copie sans ses
`node_modules`.

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

Modifiez `src/`, puis exécutez `node scripts/build.mjs`. Les fichiers générés sont commités afin que `claude --plugin-dir` n'exige aucune étape de build ; `node scripts/build.mjs --check` échoue lorsqu'ils divergent. `npm test` lance la suite intégrée `node --test` pour `spec.mjs` et le hook Stop, sans aucune dépendance.

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
| Le hook Stop bloque sans cesse | Il ne bloque que lorsque le dernier message déclare l'achèvement **et** que le diff contient des marqueurs de fausse complétion, ou que le changement courant est au stade `execute` avec des tâches non cochées. Corrigez les marqueurs, terminez ou bloquez les tâches, ou exécutez `spec stage <name> done`. Contournez avec `MY_FLOW_SKIP_HOOKS=completion-guard` ou `execute-guard` |
| L'execute-guard ne se déclenche jamais, ou se déclenche pour un ancien changement | Il lit `.my-flow/state/current-change.json` et l'ignore dès que `updated` a plus de 12 h. Exécutez `spec stage <name> execute` pour le rafraîchir, ou `spec stage <name> done` pour le libérer |
| `spec archive` refuse | Toutes les cases doivent être cochées et un rapport contenant `Verdict: PASS` doit exister sous `.my-flow/verify/`. Exécutez d'abord `mf-verify`, ou utilisez `--force` en le signalant explicitement |
| Codex demande d'approuver les hooks | Approuvez une fois dans `/hooks` ; le format des hachages de confiance a peut-être changé en amont |
| Équipes en volets partagés sous Windows | Non pris en charge par Claude Code ; les équipes s'exécutent dans le même processus. Ne demandez pas de volets tmux |
| La vérification ne se termine jamais sous Codex, ou `check start` n'apparaît jamais | Lancez `schtasks /query /tn my-flow-models-check` ; si la tâche manque, ou si `node scripts/cli.mjs models status` indique que la racine du lanceur ou Node n'existe plus (checkout déplacé ou Node mis à jour), relancez `node scripts/install.mjs claude` ou `codex` pour la réenregistrer. Sous Codex, approuvez aussi une fois les hooks my-flow dans `/hooks` |
| Les sous-agents utilisent un modèle inattendu | Lancez `node scripts/cli.mjs models status` : il affiche la surcharge (le cas échéant) et les valeurs `model:` / effort relues dans les fichiers d'agent installés. `models reset` rétablit la base `inherit` ; `models.log` sous `~/.my-flow/` journalise chaque vérification et analyse. Un checkout de développement (`claude --plugin-dir`) n'est jamais réécrit, seulement le cache du plugin installé |

## Licence

MIT
