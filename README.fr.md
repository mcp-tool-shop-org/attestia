<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.md">English</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/Attestia/readme.png" alt="Attestia" width="400">
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/Attestia/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/Attestia/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://codecov.io/gh/mcp-tool-shop-org/Attestia"><img src="https://codecov.io/gh/mcp-tool-shop-org/Attestia/graph/badge.svg" alt="codecov"></a>
  <a href="https://mcp-tool-shop-org.github.io/attestia/"><img src="https://img.shields.io/badge/Landing_Page-live-blue" alt="Landing Page"></a>
  <a href="https://opensource.org/license/mit/"><img src="https://img.shields.io/badge/License-MIT-yellow" alt="MIT License"></a>
</p>

<p align="center"><strong>Une infrastructure fiable pour garantir la transparence financière dans un monde décentralisé.</strong></p>

---

## Mission

Nous pensons que l’argent – quel que soit son emplacement ou sa circulation – mérite le même niveau de rigueur que les systèmes qui l’ont créé. Les contrats intelligents s’exécutent, les blockchains enregistrent les données, mais personne n’en *atteste*.

Attestia est l’élément manquant : une gouvernance structurée, une comptabilité déterministe et une validation humaine des intentions, le tout intégré au sein de différentes chaînes, organisations et pour chaque individu.

Nous ne déplaçons pas vos fonds. Nous établissons ce qui s’est passé, nous limitons ce qui peut se produire et nous rendons les données financières inviolables.

### Nos valeurs fondamentales

- **La vérité avant la rapidité.** Chaque événement financier est enregistré de manière immuable, peut être rejoué et vérifié. Si on ne peut le prouver, il ne s’est pas produit.
- **Les humains approuvent, les machines vérifient.** L’IA conseille, les contrats intelligents exécutent, mais rien ne se fait sans une autorisation humaine explicite. Jamais.
- **Gouvernance structurelle, et non politique.** Nous ne votons pas sur ce qui est valide. Nous définissons des invariants qui s’appliquent inconditionnellement : l’identité est explicite, la chaîne de traçabilité est continue, l’ordre est déterministe.
- **L’intention n’est pas l’exécution.** Déclarer ce que vous voulez et le faire sont deux actions distinctes avec des mécanismes différents. L’écart entre les deux est là où réside la confiance.
- **Les chaînes sont des témoins, et non des autorités.** XRPL atteste. Ethereum valide. Mais l’autorité découle de règles structurelles, et non du consensus d’une chaîne particulière.
- **Une infrastructure fiable et efficace est ce qui compte.** Le monde n’a pas besoin d’un autre protocole DeFi. Il a besoin de la couche comptable sous-jacente, c’est-à-dire des mécanismes financiers qui rendent tout le reste digne de confiance.

---

## Architecture

Attestia est composée de trois systèmes, mais ils convergent vers une seule vérité :

```
┌─────────────────────────────────────────────────────────┐
│                      ATTESTIA                           │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   Personal   │  │     Org      │  │              │  │
│  │    Vault     │  │   Treasury   │  │   Registrum  │  │
│  │              │  │              │  │              │  │
│  │  Observe.    │  │  Distribute. │  │  Govern.     │  │
│  │  Budget.     │  │  Account.    │  │  Attest.     │  │
│  │  Allocate.   │  │  Reconcile.  │  │  Constrain.  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                 │                 │           │
│         └────────────┬────┘                 │           │
│                      │                      │           │
│              ┌───────┴───────┐              │           │
│              │  Cross-System │◀─────────────┘           │
│              │ Reconciliation│                           │
│              └───────┬───────┘                           │
│                      │                                   │
│              ┌───────┴───────┐                           │
│              │ XRPL Witness  │                           │
│              │  (attestation)│                           │
│              └───────────────┘                           │
└─────────────────────────────────────────────────────────┘
```

| Système | Rôle | Origine |
|--------|------|--------|
| **Personal Vault** | Suivi d’un portefeuille diversifié, budgétisation par enveloppes, déclaration d’intention. | Dérivé de NextLedger. |
| **Org Treasury** | Calcul de la paie basé sur des règles prédéfinies, distribution des fonds par une organisation autonome décentralisée (DAO), financement à deux niveaux, système comptable à écriture comptable双面. | Dérivé de Payroll Engine. |
| **Registrum** | Registre structurel : 11 invariants, validation par double témoin, certification XRPL. | Inchangé – niveau constitutionnel |

---

## Essayez-le en 2 minutes

Le moyen le plus rapide de comprendre Attestia est d’observer l’intégralité du processus d’une transaction. La démonstration interactive exécute la chaîne complète **Intent → Approve → Execute → Verify → Attest → Proof** – chaque étape est calculée en temps réel à partir des packages réels (correspondance, hachage, attestation de type XRPL, preuve Merkle), et non à partir d’une simulation.

```bash
pnpm install   # Install all dependencies
pnpm build     # Build all packages
pnpm demo      # Walk the full pipeline (~10s, paced for readability)
```

Vous verrez qu’une simple opération de paie se transforme progressivement en une preuve cryptographique vérifiable de manière indépendante. Ajoutez l’option `--fast` pour omettre les étapes intermédiaires et exécuter le programme instantanément : `pnpm demo --fast` (la commande `pnpm demo --help` affiche la liste complète des options).

---

## Motif principal / Modèle de base

Chaque interaction suit un schéma précis :

```
Intent → Approve → Execute → Verify
```

1. **Intention** – Un utilisateur ou un système exprime le résultat souhaité.
2. **Approbation** – Registrum valide la structure ; une personne appose sa signature de manière explicite.
3. **Exécution** – La transaction sur la chaîne est soumise.
4. **Vérification** – La réconciliation confirme ; XRPL atteste l’enregistrement.

Aucune étape n’est facultative. Aucune étape n’est automatisée ou supprimée.

---

## Principes

| Principe | Mise en œuvre |
|-----------|---------------|
| Enregistrements en ajout uniquement. | Pas de MISE À JOUR, pas de SUPPRESSION – uniquement de nouvelles entrées. |
| Fermeture en cas de panne. | Le désaccord paralyse le système et ne se résout jamais en silence. |
| Relecture déterministe | Les mêmes événements produisent toujours le même résultat. |
| IA à titre consultatif uniquement. | L’IA peut analyser, signaler un problème et faire des suggestions, mais elle ne peut jamais approuver, signer ou mettre en œuvre une décision. |
| Observation sur plusieurs chaînes. | Ethereum, XRPL, Solana, L2 : une couche de lecture compatible avec différentes chaînes. |
| Identité structurelle | Explicite, invariable, unique – non pas biométrique, mais constitutionnel. |

---

## Statut

14 lots, 2 564 tests, une couverture de plus de 95 %, tout est conforme. Le processus est transparent et accessible à tous.

| Forfait | Tests | Objectif / But |
|---------|-------|---------|
| `@attestia/types` | 75 | Types de domaines partagés (sans dépendances) |
| `@attestia/registrum` | 368 | Gouvernance constitutionnelle : 11 principes fondamentaux, double validation. |
| `@attestia/ledger` | 156 | Moteur de journalisation à entrées multiples et append-only. |
| `@attestia/chain-observer` | 295 | Observation en lecture seule sur plusieurs chaînes (EVM + XRPL + Solana + L2). |
| `@attestia/vault` | 91 | Coffre-fort personnel : portefeuilles, budgets, objectifs. |
| `@attestia/treasury` | 109 | Service de gestion financière de l’organisation : paie, versements, contrôle des flux financiers. |
| `@attestia/reconciler` | 98 | Appariement tridimensionnel intersystèmes + certification Registrum |
| `@attestia/witness` | 295 | Attestation sur la chaîne XRPL, gouvernance à plusieurs signatures, tentative répétée. |
| `@attestia/verify` | 273 | Vérification des enregistrements de jeu, preuves de conformité, application des accords de niveau de service (SLA) |
| `@attestia/event-store` | 253 | Persistance des événements en mode ajout uniquement, format JSONL, chaîne de hachage, 34 types d’événements. |
| `@attestia/proof` | 94 | Arbres de Merkle (RFC 6962), preuves d’inclusion, formatage des preuves d’attestation. |
| `@attestia/sdk` | 115 | Kit de développement logiciel (SDK) pour clients HTTP, conçu pour être utilisé par des applications externes. |
| `@attestia/node` | 342 | API REST Hono : persistance des données à long terme, authentification, prise en charge de plusieurs locataires, gestion des actifs/coffre-fort/gouvernance, OpenAPI. |
| `@attestia/demo` | — | Démo interactive en ligne de commande : présentation complète du processus Attestia (version privée, sans exécution des tests). |

### Développement

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm test             # Run all tests (2,564)
pnpm test:coverage    # Run with coverage reporting
pnpm typecheck        # Type-check all packages
pnpm bench            # Run benchmarks
```

### Tests d’intégration de XRPL

Un nœud « rippled » indépendant fonctionne dans Docker pour effectuer des tests d’intégration déterministes sur la chaîne de blocs – il n’est pas nécessaire d’utiliser un réseau de test, ni de recourir à une source de financement, et le temps de clôture du registre est inférieur à une seconde.

```bash
docker compose up -d              # Start standalone rippled
pnpm --filter @attestia/witness run test:integration  # Run on-chain round-trip tests
docker compose down               # Stop rippled
```

### Documentation

| Document | Objectif / But |
|----------|---------|
| [HANDBOOK.md](HANDBOOK.md) | Présentation générale à l’intention de la direction et référence complète du dossier. |
| [ROADMAP.md](ROADMAP.md) | Planification du projet par étapes successives. |
| [DESIGN.md](DESIGN.md) | Décisions concernant l’architecture |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Diagramme de l’architecture, flux de données, modèle de sécurité. |
| [REFERENCE_ARCHITECTURE.md](REFERENCE_ARCHITECTURE.md) | Architecture à cinq niveaux, modèles de déploiement, limites de confiance. |
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | Intégration de l’API avec des exemples utilisant curl + utilisation du kit de développement logiciel (SDK) |
| [VERIFICATION_GUIDE.md](VERIFICATION_GUIDE.md) | Guide étape par étape pour l’auditeur |
| [THREAT_MODEL.md](THREAT_MODEL.md) | Analyse STRIDE par composant |
| [CONTROL_MATRIX.md](CONTROL_MATRIX.md) | Correspondances : menace → contrôle → fichier → test |
| [SECURITY.md](SECURITY.md) | Politique de divulgation responsable |
| [INSTITUTIONAL_READINESS.md](INSTITUTIONAL_READINESS.md) | Liste de contrôle de la préparation à l’adoption (du produit) |
| [PERFORMANCE_BASELINE.md](PERFORMANCE_BASELINE.md) | Valeurs de référence enregistrées |

---

## Portée en matière de sécurité et de données

- **Données auxquelles on accède :** Lecture et écriture des entrées du grand livre financier, des registres d’attestation et des preuves cryptographiques. Connexion aux nœuds de la blockchain (XRPL) lorsque le module témoin est actif.
- **Données auxquelles on n’accède PAS :** Aucune télémétrie. Aucun stockage des informations d’identification de l’utilisateur. Aucune analyse par un tiers.
- **Autorisations requises :** Accès en lecture/écriture aux répertoires de données locaux. Accès au réseau uniquement pour l’attestation blockchain. Voir [THREAT_MODEL.md](THREAT_MODEL.md) pour l’analyse STRIDE complète.

## Tableau de bord

| Porte d’entrée | Statut |
|------|--------|
| A. Base de sécurité | RÉUSSI |
| B. Gestion des erreurs | RÉUSSI |
| C. Documentation pour les opérateurs | RÉUSSI |
| D. Bonnes pratiques lors de la livraison | RÉUSSI |
| E. Identité | RÉUSSI |

## Licence

[MIT](LICENSE)

---

Créé par <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
