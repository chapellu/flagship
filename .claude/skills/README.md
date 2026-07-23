# Skills — cucco-team

Skills Claude Code disponibles dans ce repo. Elles sont auto-découvertes depuis
`.claude/skills/<nom>/SKILL.md` et invocables via `/<nom>` ou automatiquement
quand leur description correspond au contexte.

## Provenance & licence

L'ensemble de ces skills provient de **[mattpocock/skills](https://github.com/mattpocock/skills)**
(« Skills for Real Engineers » de Matt Pocock), sous licence **MIT** — voir
[`LICENSE.mattpocock-skills`](./LICENSE.mattpocock-skills).

Set adopté : les **22 skills curés** du plugin officiel (`engineering` +
`productivity`). Les catégories `deprecated/`, `in-progress/`, `personal/` et
`misc/` (spécifiques TypeScript) n'ont pas été reprises. Le dossier
`agents/openai.yaml` (métadonnées OpenAI) de chaque skill a été retiré car
inutile pour Claude Code.

Pour mettre à jour : re-cloner la source et resynchroniser les dossiers modifiés.

## Skills disponibles

### Cadrage & interviews
| Skill | Rôle |
|-------|------|
| `grilling` | Grille l'utilisateur pour stress-tester un plan/une décision (déclenché par les phrases « grill »). |
| `grill-me` | Interview contradictoire pour durcir un plan ou un design. |
| `grill-with-docs` | Même interview, en produisant au passage ADR et glossaire. |
| `ask-matt` | Routeur : quelle skill / quel flow correspond à ta situation ? |

### Spec → tickets → implémentation
| Skill | Rôle |
|-------|------|
| `to-spec` | Transforme la conversation en spec publiée sur l'issue tracker. |
| `to-tickets` | Découpe un plan en tickets « tracer-bullet » avec leurs dépendances bloquantes. |
| `wayfinder` | Planifie un gros chantier comme une carte de tickets de décision, résolus un à un. |
| `implement` | Construit un travail à partir d'un spec ou d'un jeu de tickets. |
| `tdd` | Développement piloté par les tests (red-green-refactor, tests d'intégration). |
| `prototype` | Prototype jetable pour valider un modèle d'état ou une logique. |

### Qualité & investigation
| Skill | Rôle |
|-------|------|
| `code-review` | Revue à deux axes (standards du repo + conformité au spec), sous-agents parallèles. |
| `diagnosing-bugs` | Boucle de diagnostic pour bugs difficiles et régressions de perf. |
| `resolving-merge-conflicts` | Résout un conflit de merge/rebase en cours. |

### Architecture & domaine
| Skill | Rôle |
|-------|------|
| `domain-modeling` | Construit et affine le modèle de domaine (langage ubiquitaire, ADR). |
| `codebase-design` | Vocabulaire partagé pour concevoir des « modules profonds ». |
| `improve-codebase-architecture` | Scanne le codebase pour des opportunités d'approfondissement (rapport HTML). |
| `research` | Investigue une question sur des sources primaires et consigne le résultat en Markdown. |
| `triage` | Fait passer issues et PRs externes par une machine à états de triage. |
| `setup-matt-pocock-skills` | Configure le repo (issue tracker, labels de triage, docs de domaine). À lancer une fois. |

### Productivité
| Skill | Rôle |
|-------|------|
| `handoff` | Compacte la conversation en document de passation pour un autre agent. |
| `teach` | Enseigne une compétence ou un concept dans ce workspace. |
| `writing-great-skills` | Référence pour écrire/éditer des skills prévisibles. |

## Première utilisation

Lancer `/setup-matt-pocock-skills` une fois pour câbler l'issue tracker et les
docs de domaine (`docs/agents/*.md`) — plusieurs skills (`code-review`,
`to-spec`, `triage`, `to-tickets`…) lisent leur configuration depuis là.
