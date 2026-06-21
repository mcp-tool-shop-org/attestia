<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.md">English</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/Attestia/readme.png" alt="Attestia" width="400">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mcptoolshop/attestia"><img src="https://img.shields.io/npm/v/@mcptoolshop/attestia" alt="npm version"></a>
  <a href="https://github.com/mcp-tool-shop-org/attestia/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/attestia/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://opensource.org/license/mit/"><img src="https://img.shields.io/badge/License-MIT-yellow" alt="MIT License"></a>
</p>

<p align="center"><strong>Infrastructure de vérité financière pour le monde décentralisé : l’ensemble de la bibliothèque Attestia dans un seul ensemble.</strong></p>

Gouvernance structurelle, comptabilité déterministe et validation humaine des intentions – unifiées entre les chaînes, les organisations et les individus. Attestia ne manipule pas votre argent ; elle prouve ce qui s’est passé, limite ce qui peut se produire et rend le registre financier inviolable.

Cet ensemble regroupe l’ensemble de la bibliothèque Attestia dans une seule installation (ESM). Les packages internes `@attestia/*` sont intégrés ; il n’y a donc pas de prolifération de packages à gérer ; les dépendances d’exécution tierces (xrpl, viem, @solana/web3.js, json-canonicalize, ripple-keypairs) se résolvent normalement.

## Installation

```bash
npm install @mcptoolshop/attestia
```

> **Uniquement ESM** (Node ≥ 22). Publié avec [npm provenance](https://docs.npmjs.com/generating-provenance-statements) via GitHub Actions OIDC Trusted Publishing.

## Utilisation

Importez un domaine en tant que **espace de noms** à partir du répertoire racine :

```ts
import { ledger, proof, registrum } from "@mcptoolshop/attestia";

const total = ledger.addMoney(
  { amount: "100.00", currency: "USD", decimals: 2 },
  { amount: "50.00", currency: "USD", decimals: 2 },
);

const tree = proof.MerkleTree.build([/* sha-256 leaf hashes */]);
```

…ou importez des symboles plats à partir d’un **sous-répertoire** :

```ts
import { MerkleTree, verifyAttestationProof } from "@mcptoolshop/attestia/proof";
import { StructuralRegistrar } from "@mcptoolshop/attestia/registrum";
import { JsonlEventStore } from "@mcptoolshop/attestia/event-store";
import { AttestiaClient } from "@mcptoolshop/attestia/sdk";
```

## Sous-répertoires

| Sous-répertoire | Qu’est-ce que c’est |
|---------|-----------|
| `@mcptoolshop/attestia` | Répertoire racine : chaque domaine en tant qu’espace de noms |
| `…/types` | Types de domaines partagés (monnaie, identifiants, primitives personnalisées) |
| `…/ledger` | Moteur d’écriture uniquement à double entrée + calcul déterministe des devises |
| `…/registrum` | Registre constitutionnel : 11 invariants, validation par deux témoins |
| `…/event-store` | Persistance d’événements en écriture uniquement : JSONL, chaîne de hachage |
| `…/proof` | Arbres de Merkle (RFC 6962), preuves d’inclusion et d’attestation |
| `…/vault` | Coffre-fort personnel : portefeuilles, budgets, intentions |
| `…/treasury` | Trésorerie organisationnelle : paie, distributions, seuils de financement |
| `…/reconciler` | Correspondance intersystème + attestation Registrum |
| `…/chain-observer` | Observation multi-chaînes en lecture seule (EVM, XRPL, Solana, L2) |
| `…/witness` | Attestation sur chaîne XRPL, gouvernance multi-signatures |
| `…/verify` | Vérification de relecture, preuves de conformité, SLA |
| `…/sdk` | Client HTTP typé pour l’API REST Attestia |

## Schéma principal

Chaque interaction suit un flux unique, et aucune étape n’est facultative :

```
Intent → Approve → Execute → Verify
```

## Documentation

Manuel complet, architecture, modèle de menace et guide de vérification : **<https://mcp-tool-shop-org.github.io/attestia/>** · Source : **<https://github.com/mcp-tool-shop-org/attestia>**

## Licence

[MIT](LICENSE) – créé par [MCP Tool Shop](https://mcp-tool-shop.github.io/).
