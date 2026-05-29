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

<p align="center"><strong>Infrastructure de confiance financière pour le monde décentralisé.</strong></p>

---

## Mission

Nous croyons que l'argent, quel que soit son emplacement ou sa manière de circuler, mérite le même niveau de rigueur que les systèmes qui l'ont créé. Les contrats intelligents s'exécutent. Les blockchains enregistrent. Mais personne ne *certifie*.

Attestia est la couche manquante : gouvernance structurelle, comptabilité déterministe et intention approuvée par des humains, le tout unifié à travers les chaînes, les organisations et les individus.

Nous ne déplaçons pas votre argent. Nous prouvons ce qui s'est passé, nous limitons ce qui peut se passer et nous rendons l'enregistrement financier inviolable.

### Nos valeurs

- **La vérité avant la vitesse.** Chaque événement financier est enregistré de manière immuable, reproductible et réconciliable. Si quelque chose ne peut pas être prouvé, cela ne s'est pas produit.
- **Les humains approuvent ; les machines vérifient.** L'IA conseille, les contrats intelligents s'exécutent, mais rien ne se passe sans une autorisation humaine explicite. Jamais.
- **Gouvernance structurelle, pas politique.** Nous ne votons pas sur ce qui est valide. Nous définissons des invariants qui sont toujours valables : l'identité est explicite, la lignée est intacte, l'ordre est déterministe.
- **L'intention n'est pas l'exécution.** Déclarer ce que vous voulez et le faire sont des actions distinctes, avec des mécanismes de contrôle distincts. L'écart entre les deux est là où réside la confiance.
- **Les chaînes sont des témoins, pas des autorités.** XRPL certifie. Ethereum règle. Mais l'autorité émane des règles structurelles, et non du consensus de n'importe quelle chaîne.
- **L'infrastructure fiable est la clé du succès.** Le monde n'a pas besoin d'un autre protocole DeFi. Il a besoin de la couche de comptabilité sous-jacente, de la plomberie financière qui rend tout le reste digne de confiance.

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
| **Personal Vault** | Observation multi-chaînes des portefeuilles, budgétisation par enveloppe, déclaration d'intention | Évolué à partir de NextLedger |
| **Org Treasury** | Paie déterministe, distributions DAO, financement à double autorisation, grand livre comptable à double entrée | Évolué à partir de Payroll Engine |
| **Registrum** | Registraire structurel : 11 invariants, validation à double témoin, certification XRPL | Inchangé : couche constitutionnelle |

---

## Essayez-le en 2 minutes

La façon la plus rapide de comprendre Attestia est de suivre un paiement de bout en bout. La démo interactive exécute l'intégralité du pipeline **Intention → Approbation → Exécution → Vérification → Certification → Preuve**, de A à Z, avec des calculs réels effectués sur les packages de domaine réels (correspondance, hachage, certification de type XRPL, preuve Merkle), et non sur une simulation.

```bash
pnpm install   # Install all dependencies
pnpm build     # Build all packages
pnpm demo      # Walk the full pipeline (~10s, paced for readability)
```

Vous verrez un paiement de paie unique devenir une preuve cryptographique indépendamment vérifiable, étape par étape. Ajoutez `--fast` pour ignorer le rythme et exécuter instantanément : `pnpm demo --fast` (`pnpm demo --help` affiche tous les paramètres).

---

## Modèle de base

Chaque interaction suit un flux :

```
Intent → Approve → Execute → Verify
```

1. **Intention** : Un utilisateur ou un système déclare un résultat souhaité.
2. **Approbation** : Le Registrum valide structurellement ; un humain signe explicitement.
3. **Exécution** : La transaction sur la chaîne est soumise.
4. **Vérification** : La réconciliation confirme ; XRPL certifie l'enregistrement.

Aucune étape n'est facultative. Aucune étape n'est automatisée.

---

## Principes

| Principe | Implémentation |
|-----------|---------------|
| Enregistrements immuables | Pas de MISE À JOUR, pas de SUPPRESSION : uniquement de nouvelles entrées. |
| Principe du "fail-closed" | Tout désaccord arrête le système, sans jamais se corriger silencieusement. |
| Rejouabilité déterministe | Les mêmes événements produisent le même état, toujours. |
| IA consultative uniquement | L'IA peut analyser, avertir, suggérer, mais ne peut jamais approuver, signer ou exécuter. |
| Observation multi-chaînes | Ethereum, XRPL, Solana, L2 : couche de lecture indépendante de la chaîne. |
| Identité structurelle. | Explicite, immuable, unique — pas biométrique, mais constitutionnel. |

---

## Statut

14 paquets, 2 220 tests, couverture de 96,80 %, tout est vert. Construction en public.

| Paquet | Tests | Objectif |
|---------|-------|---------|
| `@attestia/types` | 72 | Types de domaine partagés (zéro dépendance) |
| `@attestia/registrum` | 341 | Gouvernance constitutionnelle — 11 invariants, double témoin. |
| `@attestia/ledger` | 154 | Moteur d'écriture seule à double entrée. |
| `@attestia/chain-observer` | 278 | Observation en lecture seule multi-chaînes (EVM + XRPL + Solana + L2). |
| `@attestia/vault` | 75 | Coffre personnel — portefeuilles, budgets, intentions. |
| `@attestia/treasury` | 92 | Trésorerie de l'organisation — paie, distributions, mécanismes de financement. |
| `@attestia/reconciler` | 81 | Correspondance 3D inter-systèmes + attestation Registrum. |
| `@attestia/witness` | 278 | Attestation sur chaîne XRPL, gouvernance multi-signatures, tentative de relance. |
| `@attestia/verify` | 242 | Vérification de relecture, preuves de conformité, application des accords de niveau de service (SLA). |
| `@attestia/event-store` | 226 | Persistance des événements en écriture seule, JSONL, chaîne de hachage, 34 types d'événements. |
| `@attestia/proof` | 75 | Arbres de Merkle, preuves d'inclusion, emballage des preuves d'attestation. |
| `@attestia/sdk` | 79 | SDK client HTTP typé pour les consommateurs externes. |
| `@attestia/node` | 227 | API REST Hono — 34 points de terminaison, authentification, multi-tenancy, API publique, conformité. |
| `@attestia/demo` | — | Démonstration interactive en ligne de commande — exploration complète du pipeline Attestia (privé, sans tests). |

### Développement

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm test             # Run all tests (2,220)
pnpm test:coverage    # Run with coverage reporting
pnpm typecheck        # Type-check all packages
pnpm bench            # Run benchmarks
```

### Tests d'intégration XRPL

Un nœud `rippled` autonome s'exécute dans Docker pour les tests d'intégration sur chaîne déterministes — aucune dépendance de testnet, aucun faucet, fermeture du registre en moins d'une seconde.

```bash
docker compose up -d              # Start standalone rippled
pnpm --filter @attestia/witness run test:integration  # Run on-chain round-trip tests
docker compose down               # Stop rippled
```

### Documentation

| Document | Objectif |
|----------|---------|
| [HANDBOOK.md](HANDBOOK.md) | Aperçu général et référence complète des paquets. |
| [ROADMAP.md](ROADMAP.md) | Feuille de route du projet, phase par phase. |
| [DESIGN.md](DESIGN.md) | Décisions d'architecture. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Graphe des paquets, flux de données, modèle de sécurité. |
| [REFERENCE_ARCHITECTURE.md](REFERENCE_ARCHITECTURE.md) | Pile en 5 couches, modèles de déploiement, limites de confiance. |
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | Intégration API avec exemples curl + utilisation du SDK. |
| [VERIFICATION_GUIDE.md](VERIFICATION_GUIDE.md) | Guide de relecture pas à pas pour les auditeurs. |
| [THREAT_MODEL.md](THREAT_MODEL.md) | Analyse STRIDE par composant. |
| [CONTROL_MATRIX.md](CONTROL_MATRIX.md) | Correspondances menace → contrôle → fichier → test. |
| [SECURITY.md](SECURITY.md) | Politique de divulgation responsable. |
| [INSTITUTIONAL_READINESS.md](INSTITUTIONAL_READINESS.md) | Liste de contrôle de préparation à l'adoption (du produit). |
| [PERFORMANCE_BASELINE.md](PERFORMANCE_BASELINE.md) | Benchmarks enregistrés. |

---

## Sécurité et périmètre des données

- **Données accessibles :** Lecture et écriture des entrées du registre financier, des enregistrements d'attestation et des preuves cryptographiques. Connexion aux nœuds de la blockchain (XRPL) lorsque le module de témoin est actif.
- **Données NON accessibles :** Aucune télémétrie. Aucun stockage d'identifiants utilisateur. Aucune analyse tierce.
- **Autorisations requises :** Accès en lecture/écriture aux répertoires de données locaux. Accès réseau uniquement pour l'attestation de la blockchain. Consultez [THREAT_MODEL.md](THREAT_MODEL.md) pour une analyse STRIDE complète.

## Tableau de bord

| Portail | Statut |
|------|--------|
| A. Base de sécurité | PASSÉ |
| B. Gestion des erreurs | PASSÉ |
| C. Documentation pour les opérateurs | PASSÉ |
| D. Hygiène de déploiement | PASSÉ |
| E. Identité | PASSÉ |

## Licence

[MIT](LICENSE)

---

Créé par <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
