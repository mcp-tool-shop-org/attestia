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

<p align="center"><strong>Preuve qu’un événement, une transaction ou une transition d’état a eu lieu, et qu’elle est liée à une chaîne.</strong></p>

---

## Mission

Nous pensons que l’argent — où qu’il se trouve, quelle que soit sa circulation — mérite le même niveau de rigueur que les systèmes qui l’ont créé. Les contrats intelligents s’exécutent. Les blockchains enregistrent. Mais personne n’en *atteste*.

Attestia propose cette couche pour l’argent : une gouvernance structurée, une comptabilité déterministe et une validation humaine des intentions, sur plusieurs chaînes, pour les organisations et les individus.

Nous ne déplaçons pas votre argent. Nous prouvons ce qui s’est passé, nous limitons ce qui peut se produire et nous rendons les données financières inviolables.

### Nos valeurs

- **La vérité avant la rapidité.** Chaque événement financier est enregistré de manière immuable, peut être rejoué et réconcilié. S’il ne peut pas être prouvé, il ne s’est pas produit.
- **Les humains approuvent, les machines vérifient.** L’IA conseille, les contrats intelligents s’exécutent, mais rien ne se passe sans une autorisation humaine explicite. Jamais.
- **Une gouvernance structurée, pas une gouvernance politique.** Nous ne votons pas sur ce qui est valide. Nous définissons des invariants qui s’appliquent inconditionnellement : l’identité est explicite, la lignée est ininterrompue, l’ordre est déterministe.
- **L’intention n’est pas l’exécution.** Déclarer ce que vous voulez et le faire sont des actes distincts avec des étapes distinctes. L’écart entre eux est l’endroit où réside la confiance.
- **Les chaînes sont des témoins, pas des autorités.** XRPL atteste. Ethereum valide. Mais l’autorité découle de règles structurelles, et non du consensus d’une chaîne.
- **Une infrastructure simple est gagnante.** Le monde n’a pas besoin d’un autre protocole DeFi. Il a besoin de la couche comptable sous-jacente, de l’infrastructure financière qui rend tout le reste fiable.

## Notre rôle dans le système

Attestia, Cognate et RepoMesh sont trois produits.

**Attestia** prouve qu’un événement, une transaction ou une transition d’état a eu lieu, et lie cette preuve à une chaîne. Son domaine d’application est la vérité financière : coffre-fort personnel, trésorerie d’entreprise et registre. Ses primitives de preuve sont un magasin d’événements immuable et des preuves de Merkle.

**Cognate** est le domaine de gouvernance IA basé sur ces primitives : lignée des modèles, décisions de politique, capacités des agents et intégrité des invites et des résultats. Il ne conserve pas un deuxième magasin d’événements.

**RepoMesh** est le réseau de publication : événements signés, manifestes de nœuds et horloge de confiance ancrée sur XRPL. Il conserve son propre registre RFC 6962. Il n’utilise pas l’arbre de Merkle d’Attestia.

Cognate appelle Attestia lorsqu’il a besoin d’une preuve, et RepoMesh lorsqu’il a besoin qu’une publication soit vérifiée.

---

## Architecture

Attestia est composé de trois systèmes, mais il n’y a qu’une seule vérité :

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
| **Personal Vault** | Observation de portefeuille multi-chaînes, budgétisation globale, déclaration d’intention | Évolué à partir de NextLedger |
| **Org Treasury** | Paie déterministe, distributions DAO, financement à double validation, grand livre à écriture comptable double | Évolué à partir de Payroll Engine |
| **Registrum** | Registre structurel — 11 invariants, validation à double témoin, attestation XRPL | Inchangé — couche constitutionnelle |

---

## Essayez-le en 2 minutes

Le moyen le plus rapide de comprendre Attestia est d’observer un paiement qui traverse l’ensemble du processus. La démonstration interactive exécute le pipeline complet **Intention → Approbation → Exécution → Vérification → Attestation → Preuve** de bout en bout — chaque étape est calculée en temps réel par rapport aux packages de domaine réels (correspondance, hachage, attestation de type XRPL, preuve de Merkle), et non une simulation.

```bash
pnpm install   # Install all dependencies
pnpm build     # Build all packages
pnpm demo      # Walk the full pipeline (~10s, paced for readability)
```

Vous verrez un simple paiement de paie devenir une preuve cryptographique vérifiable de manière indépendante, étape par étape. Ajoutez `--fast` pour ignorer le rythme et l’exécuter instantanément : `pnpm demo --fast` (`pnpm demo --help` répertorie tous les indicateurs).

---

## Schéma de base

Chaque interaction suit un flux unique :

```
Intent → Approve → Execute → Verify
```

1. **Intention** — Un utilisateur ou un système déclare le résultat souhaité.
2. **Approbation** — Registrum valide structurellement ; un humain signe explicitement.
3. **Exécution** — La transaction sur la chaîne est soumise.
4. **Vérification** — La réconciliation confirme ; XRPL atteste l’enregistrement.

Aucune étape n’est facultative. Aucune étape n’est automatisée.

---

## Principes

| Principe | Implémentation |
|-----------|---------------|
| Enregistrements immuables | Pas de MISE À JOUR, pas de SUPPRESSION — uniquement de nouvelles entrées |
| Fonctionnement en mode sécurisé | Le désaccord arrête le système, il ne se répare jamais silencieusement |
| Relecture déterministe | Les mêmes événements produisent toujours le même état |
| IA uniquement à titre consultatif | L’IA peut analyser, avertir, suggérer — mais elle ne peut jamais approuver, signer ou exécuter |
| Observation multi-chaînes | Ethereum, XRPL, Solana, L2 — couche de lecture agnostique de la chaîne |
| Identité structurelle | Explicite, immuable, unique — pas biométrique, mais constitutionnelle |

---

## État

14 packages, 2 564 tests, 95 % de couverture, tout est vert. Développement en public.

| Package | Tests | Objectif |
|---------|-------|---------|
| `@attestia/types` | 75 | Types de domaine partagés (zéro dépendance) |
| `@attestia/registrum` | 368 | Gouvernance constitutionnelle — 11 invariants, double témoin |
| `@attestia/ledger` | 156 | Moteur d’écriture comptable double immuable |
| `@attestia/chain-observer` | 295 | Observation multi-chaînes en lecture seule (EVM + XRPL + Solana + L2) |
| `@attestia/vault` | 91 | Coffre-fort personnel — portefeuilles, budgets, intentions |
| `@attestia/treasury` | 109 | Trésorerie d’entreprise — paie, distributions, étapes de financement |
| `@attestia/reconciler` | 98 | Correspondance croisée 3D + attestation Registrum |
| `@attestia/witness` | 295 | Attestation sur la chaîne XRPL, gouvernance multi-signatures, nouvelle tentative |
| `@attestia/verify` | 273 | Vérification de la relecture, preuve de conformité, application des SLA |
| `@attestia/event-store` | 253 | Persistance des événements immuable, JSONL, chaîne de hachage, 34 types d’événements |
| `@attestia/proof` | 94 | Arbres de Merkle (RFC 6962), preuves d’inclusion, regroupement des preuves d’attestation |
| `@attestia/sdk` | 115 | Kit de développement logiciel (SDK) de client HTTP typé pour les utilisateurs externes |
| `@attestia/node` | 342 | API REST Hono — persistance durable, authentification, multi-location, gestion des actifs/coffre-fort/gouvernance, OpenAPI |
| `@attestia/demo` | — | Démo interactive en ligne de commande — présentation complète du processus Attestia (privé, sans tests) |

### Développement

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm test             # Run all tests (2,564)
pnpm test:coverage    # Run with coverage reporting
pnpm typecheck        # Type-check all packages
pnpm bench            # Run benchmarks
```

### Tests d’intégration XRPL

Un nœud `rippled` autonome s’exécute dans Docker pour des tests d’intégration déterministes sur la chaîne — aucune dépendance au testnet, pas de robinet, temps de clôture du registre inférieur à une seconde.

```bash
docker compose up -d              # Start standalone rippled
pnpm --filter @attestia/witness run test:integration  # Run on-chain round-trip tests
docker compose down               # Stop rippled
```

### Documentation

| Document | Objectif |
|----------|---------|
| [HANDBOOK.md](HANDBOOK.md) | Présentation générale et référence complète du package |
| [ROADMAP.md](ROADMAP.md) | Feuille de route du projet, étape par étape |
| [DESIGN.md](DESIGN.md) | Décisions architecturales |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Graphique du package, flux de données, modèle de sécurité |
| [REFERENCE_ARCHITECTURE.md](REFERENCE_ARCHITECTURE.md) | Pile à 5 couches, modèles de déploiement, limites de confiance |
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | Intégration de l’API avec des exemples curl + utilisation du SDK |
| [VERIFICATION_GUIDE.md](VERIFICATION_GUIDE.md) | Guide de reproduction étape par étape pour les auditeurs |
| [THREAT_MODEL.md](THREAT_MODEL.md) | Analyse STRIDE par composant |
| [CONTROL_MATRIX.md](CONTROL_MATRIX.md) | Correspondances menace → contrôle → fichier → test |
| [SECURITY.md](SECURITY.md) | Politique de divulgation responsable |
| [INSTITUTIONAL_READINESS.md](INSTITUTIONAL_READINESS.md) | Liste de contrôle de la préparation à l’adoption (du produit) |
| [PERFORMANCE_BASELINE.md](PERFORMANCE_BASELINE.md) | Benchmarks enregistrés |

---

## Sécurité et portée des données

- **Données auxquelles on accède :** Lecture et écriture des entrées du registre financier, des enregistrements d’attestation et des preuves cryptographiques. Connexion aux nœuds de la blockchain (XRPL) lorsque le module témoin est actif.
- **Données auxquelles on n’accède PAS :** Pas de télémétrie. Pas de stockage des informations d’identification de l’utilisateur. Pas d’analyse par des tiers.
- **Autorisations requises :** Accès en lecture/écriture aux répertoires de données locaux. Accès réseau uniquement pour l’attestation de la blockchain. Voir [THREAT_MODEL.md](THREAT_MODEL.md) pour l’analyse STRIDE complète.

## Tableau de bord

| Contrôle | État |
|------|--------|
| A. Base de sécurité | RÉUSSI |
| B. Gestion des erreurs | RÉUSSI |
| C. Documentation pour les opérateurs | RÉUSSI |
| D. Bonnes pratiques de livraison | RÉUSSI |
| E. Identité | RÉUSSI |

## Licence

[MIT](LICENSE)

---

Créé par <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
