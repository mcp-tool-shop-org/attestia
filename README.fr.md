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

Attestia propose cette couche pour l’argent : une gouvernance structurée, une comptabilité déterministe et une validation humaine de l’intention, sur plusieurs chaînes, pour les organisations et les individus.

Nous ne déplaçons pas votre argent. Nous prouvons ce qui s’est passé, nous limitons ce qui peut se produire et nous rendons les données financières inviolables.

### Ce que nous défendons

- **La vérité avant la vitesse.** Chaque événement financier est enregistré en append-only, peut être rejoué et réconcilié. S’il ne peut être prouvé, il ne s’est pas produit.
- **Les humains approuvent, les machines vérifient.** L’IA conseille, les contrats intelligents s’exécutent, mais rien ne se passe sans une autorisation humaine explicite. Jamais.
- **Une gouvernance structurée, pas une gouvernance politique.** Nous ne votons pas sur ce qui est valide. Nous définissons des invariants qui s’appliquent inconditionnellement : l’identité est explicite, la lignée est ininterrompue, l’ordre est déterministe.
- **L’intention n’est pas l’exécution.** Déclarer ce que vous voulez et le faire sont des actes distincts avec des étapes distinctes. L’écart entre eux est l’endroit où réside la confiance.
- **Les chaînes sont des témoins, pas des autorités.** XRPL atteste. Ethereum valide. Mais l’autorité découle de règles structurelles, et non du consensus d’une chaîne.
- **Une infrastructure simple est gagnante.** Le monde n’a pas besoin d’un autre protocole DeFi. Il a besoin de la couche de comptabilité sous-jacente, de l’infrastructure financière qui rend tout le reste fiable.

## Place dans le système

Attestia, Cognate et RepoMesh sont trois produits.

**Attestia** prouve qu’un événement, une transaction ou une transition d’état a eu lieu, et lie cette preuve à une chaîne. Le domaine qu’il propose est la vérité financière : coffre-fort personnel, trésorerie d’entreprise et registre. Ses primitives de preuve sont un magasin d’événements en append-only et des preuves de Merkle.

**Cognate** est le domaine de gouvernance IA basé sur ces primitives : lignée du modèle, décisions de politique, capacités de l’agent et intégrité des invites et des résultats. Il ne conserve pas un deuxième magasin d’événements.

**RepoMesh** est le réseau de publication : événements signés, manifestes de nœuds et horloge de confiance ancrée sur XRPL. Il conserve son propre registre RFC 6962. Il n’utilise pas l’arbre de Merkle d’Attestia.

Cognate appelle Attestia lorsqu’il a besoin d’une preuve, et RepoMesh lorsqu’il a besoin qu’une publication soit vérifiée.

---

## Architecture

Attestia est composé de trois systèmes, une seule vérité :

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
| **Personal Vault** | Observation de portefeuille multi-chaînes, budgétisation d’enveloppes, déclaration d’intention | Évolué à partir de NextLedger |
| **Org Treasury** | Paie déterministe, distributions DAO, financement à double validation, grand livre à écriture comptable double | Évolué à partir de Payroll Engine |
| **Registrum** | Registre structurel — 11 invariants, validation à double témoin, attestation XRPL | Inchangé — couche constitutionnelle |

---

## Essayez-le en 2 minutes

Le moyen le plus rapide de comprendre Attestia est d’observer un paiement complet. La démo interactive exécute le pipeline complet **Intention → Approbation → Exécution → Vérification → Attestation → Preuve** de bout en bout — chaque étape est calculée en temps réel par rapport aux packages de domaine réels (correspondance, hachage, attestation de type XRPL, preuve de Merkle), et non une simulation.

```bash
pnpm install   # Install all dependencies
pnpm build     # Build all packages
pnpm demo      # Walk the full pipeline (~10s, paced for readability)
```

Vous verrez un simple paiement de paie devenir une preuve cryptographique vérifiable de manière indépendante, étape par étape. Ajoutez `--fast` pour ignorer le rythme et l’exécuter instantanément : `pnpm demo --fast` (`pnpm demo --help` répertorie tous les indicateurs).

---

## Schéma de base

Chaque interaction suit un flux :

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
| Enregistrements en append-only | Pas de MISE À JOUR, pas de SUPPRESSION — uniquement de nouvelles entrées |
| Fonctionnement en mode sécurisé | Le désaccord arrête le système, il ne se répare jamais silencieusement |
| Relecture déterministe | Les mêmes événements produisent toujours le même état |
| IA uniquement à titre consultatif | L’IA peut analyser, avertir, suggérer — mais elle n’approuve, ne signe et n’exécute jamais |
| Observation multi-chaînes | Ethereum, XRPL, Solana, L2s — couche de lecture agnostique de la chaîne |
| Identité structurelle | Explicite, immuable, unique — pas biométrique, mais constitutionnelle |

---

## État

Version 2.1.2. 15 packages d’espace de travail, 2 594 tests en CI plus 3 tests de validation de bundle, 94,9 à 100 % de couverture des instructions par package, tout est vert. Construction en public.

| Package | Tests | Objectif |
|---------|-------|---------|
| `@attestia/types` | 75 | Types de domaine partagés (zéro dépendance) |
| `@attestia/registrum` | 368 | Gouvernance constitutionnelle — 11 invariants, double témoin |
| `@attestia/ledger` | 156 | Moteur d’écriture comptable double en append-only |
| `@attestia/chain-observer` | 295 | Observation multi-chaînes en lecture seule (EVM + XRPL + Solana + L2s) |
| `@attestia/vault` | 91 | Coffre-fort personnel — portefeuilles, budgets, intentions |
| `@attestia/treasury` | 109 | Trésorerie d’entreprise — paie, distributions, étapes de financement |
| `@attestia/reconciler` | 98 | Correspondance croisée 3D + attestation Registrum |
| `@attestia/witness` | 295 | Attestation sur la chaîne XRPL, gouvernance multi-signatures, nouvelle tentative |
| `@attestia/verify` | 273 | Vérification de la relecture, preuve de conformité, application des SLA |
| `@attestia/event-store` | 263 | Persistance des événements en append-only, JSONL, chaîne de hachage, 34 types d’événements |
| `@attestia/proof` | 94 | Arbres de Merkle (RFC 6962), preuves d’inclusion, regroupement des preuves d’attestation |
| `@attestia/sdk` | 115 | Kit de développement logiciel (SDK) de client HTTP typé pour les consommateurs externes |
| `@attestia/node` | 362 | API REST Hono — persistance durable, authentification, multi-location, gestion des actifs/coffre-fort/gouvernance, OpenAPI |
| `@mcptoolshop/attestia` | 3 | Le paquet npm publié : toutes les bibliothèques ci-dessus dans un seul ensemble, avec des exportations de sous-chemin (tests de validation, exécutés par `pnpm test` ; les tests de couverture de l’intégration continue ne les incluent pas) |
| `@attestia/demo` | — | Démo interactive en ligne de commande — présentation complète du pipeline Attestia (privé, sans tests) |

### Nouveautés de la version 2.1

- **2.1.2 : récupération en cas de plantage pour le journal des événements.** Si un processus d’écriture est interrompu en cours d’écriture d’une ligne, `JsonlEventStore` ignore la dernière ligne incomplète lors de la réouverture, et sa première écriture ajoute un saut de ligne afin que les nouveaux événements commencent sur une nouvelle ligne. Le fragment incomplet reste dans le fichier et est ignoré à chaque chargement. Les événements dont le `append()` a été renvoyé se trouvent sur le disque. Un événement endommagé au milieu du journal entraîne toujours le refus d’ouverture du magasin (`INTEGRITY_VIOLATION`, avec la valeur par défaut `verifyOnLoad: true`). Le fichier README du magasin d’événements indique [ce qui est conservé après une reprise](packages/event-store/README.md).
- **2.1.1 : Zod 4.** La validation s’exécute désormais avec Zod 4.6.7. La formulation des messages de validation intégrés dans `details.issues[].message` et dans `ConfigError` a été modifiée (par exemple, `"Required"` est maintenant `"Invalid input: expected <type>, received undefined"`). Les codes d’erreur, les chemins des problèmes, l’enveloppe d’erreur HTTP et les propres messages d’affinage d’Attestia restent inchangés, il convient donc de faire correspondre les codes et les chemins, et non le texte du message.
- **2.1.0 : un journal d’événements durable pour le service.** `ATTESTIA_EVENTS_FILE` ouvre ce fichier en tant que journal d’événements du propriétaire configuré. S’il n’est pas défini, le service reste en mémoire. Une entrée `API_KEYS` malformée n’ajoute plus la clé à l’erreur de démarrage.

Consultez [CHANGELOG.md](CHANGELOG.md) pour obtenir la liste complète.

### Développement

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm test             # Run all tests (2,597)
pnpm test:coverage    # Run with coverage reporting
pnpm typecheck        # Type-check all packages
pnpm bench            # Run benchmarks
```

### Tests d’intégration XRPL

Un nœud `rippled` autonome s’exécute dans Docker pour des tests d’intégration déterministes sur la chaîne — aucune dépendance de testnet, pas de robinet, temps de fermeture du grand livre inférieur à une seconde.

```bash
docker compose up -d              # Start standalone rippled
pnpm --filter @attestia/witness run test:integration  # Run on-chain round-trip tests
docker compose down               # Stop rippled
```

### Documentation

| Document | Objectif |
|----------|---------|
| [HANDBOOK.md](HANDBOOK.md) | Présentation générale et référence complète du paquet |
| [ROADMAP.md](ROADMAP.md) | Feuille de route du projet, étape par étape |
| [DESIGN.md](DESIGN.md) | Décisions architecturales |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Graphique du paquet, flux de données, modèle de sécurité |
| [REFERENCE_ARCHITECTURE.md](REFERENCE_ARCHITECTURE.md) | Pile à 5 couches, modèles de déploiement, limites de confiance |
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | Intégration de l’API avec des exemples curl + utilisation du SDK |
| [VERIFICATION_GUIDE.md](VERIFICATION_GUIDE.md) | Guide de relecture étape par étape pour les auditeurs |
| [THREAT_MODEL.md](THREAT_MODEL.md) | Analyse STRIDE par composant |
| [CONTROL_MATRIX.md](CONTROL_MATRIX.md) | Mappages menace → contrôle → fichier → test |
| [SECURITY.md](SECURITY.md) | Politique de divulgation responsable |
| [INSTITUTIONAL_READINESS.md](INSTITUTIONAL_READINESS.md) | Liste de contrôle de préparation à l’adoption (du produit) |
| [PERFORMANCE_BASELINE.md](PERFORMANCE_BASELINE.md) | Benchmarks enregistrés |

---

## Sécurité et portée des données

- **Données auxquelles on accède :** Lecture et écriture des entrées du grand livre financier, des enregistrements d’attestation et des preuves cryptographiques. Le service écrit son journal d’événements dans le fichier nommé par `ATTESTIA_EVENTS_FILE` lorsqu’il est défini. Se connecte aux nœuds de la blockchain (XRPL) lorsque le module témoin est actif.
- **Données auxquelles on n’accède PAS :** Pas de télémétrie. Pas de stockage des informations d’identification de l’utilisateur. Pas d’analyse par des tiers.
- **Intégrité sur le disque :** le journal des événements est en append-only et en chaîne de hachage. Une dernière ligne incomplète due à un plantage est ignorée et le journal reprend ; tout dommage qui brise la chaîne entraîne le refus d’ouverture du magasin par défaut.
- **Autorisations requises :** Accès en lecture/écriture aux répertoires de données locaux. Accès réseau uniquement pour l’attestation de la blockchain. Consultez [THREAT_MODEL.md](THREAT_MODEL.md) pour l’analyse STRIDE complète.

## Tableau de bord

| Porte | État |
|------|--------|
| A. Base de sécurité | OK |
| B. Gestion des erreurs | OK |
| C. Documentation pour les opérateurs | OK |
| D. Hygiène de livraison | OK |
| E. Identité | OK |

## Licence

[MIT](LICENSE)

---

Créé par <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
