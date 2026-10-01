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

<p align="center"><strong>Preuve qu’un événement, une transaction ou une transition d’état s’est produit, et qui est liée à une chaîne. L’ensemble de la bibliothèque est regroupé dans un seul paquet.</strong></p>

Le domaine couvert par ce paquet est la vérité financière : coffre-fort personnel, trésorerie d’entreprise et registre. Gouvernance structurée, comptabilité déterministe et validation humaine des intentions sur plusieurs chaînes, organisations et individus. Attestia ne déplace pas votre argent. Il prouve ce qui s’est passé, limite ce qui peut se produire et rend les données financières inviolables.

Cognate utilise le magasin d’événements et les preuves de Merkle de ce paquet pour la gouvernance de l’IA. RepoMesh est un registre distinct et n’utilise pas cet arbre de Merkle.

Ce paquet regroupe l’ensemble des fonctionnalités de la bibliothèque Attestia dans une seule installation (ESM). Les paquets de l’espace de travail interne `@attestia/*` sont intégrés ; il n’y a donc pas de prolifération de paquets à gérer ; les dépendances d’exécution tierces (xrpl, viem, @solana/web3.js, json-canonicalize, ripple-keypairs) se résolvent normalement.

## Installation

```bash
npm install @mcptoolshop/attestia
```

> **Uniquement ESM** (Node ≥ 22). Publié avec [npm provenance](https://docs.npmjs.com/generating-provenance-statements) via GitHub Actions OIDC Trusted Publishing.

## Utilisation

Importer un domaine en tant que **namespace** à partir de la racine :

```ts
import { ledger, proof, registrum } from "@mcptoolshop/attestia";

const total = ledger.addMoney(
  { amount: "100.00", currency: "USD", decimals: 2 },
  { amount: "50.00", currency: "USD", decimals: 2 },
);

const tree = proof.MerkleTree.build([/* sha-256 leaf hashes */]);
```

…ou importer des symboles plats à partir d’un **sous-chemin** :

```ts
import { MerkleTree, verifyAttestationProof } from "@mcptoolshop/attestia/proof";
import { StructuralRegistrar } from "@mcptoolshop/attestia/registrum";
import { JsonlEventStore } from "@mcptoolshop/attestia/event-store";
import { AttestiaClient } from "@mcptoolshop/attestia/sdk";
```

## Sous-chemins

| Sous-chemin | Description |
|---------|-----------|
| `@mcptoolshop/attestia` | Fichier racine — chaque domaine en tant que namespace |
| `…/types` | Types de domaine partagés (argent, identifiants, primitives personnalisées) |
| `…/ledger` | Moteur de comptabilité à entrées multiples et append-only + calcul déterministe de la valeur |
| `…/registrum` | Registre constitutionnel — 11 invariants, double validation |
| `…/event-store` | Persistance d’événements append-only — JSONL, chaîne de hachage |
| `…/proof` | Arbres de Merkle (RFC 6962), preuves d’inclusion et d’attestation |
| `…/vault` | Coffre-fort personnel — portefeuilles, budgets, intentions |
| `…/treasury` | Trésorerie d’entreprise — paie, distributions, seuils de financement |
| `…/reconciler` | Correspondance inter-systèmes + attestation Registrum |
| `…/chain-observer` | Observation multi-chaînes en lecture seule (EVM, XRPL, Solana, L2) |
| `…/witness` | Attestation sur la chaîne XRPL, gouvernance multi-signatures |
| `…/verify` | Vérification de relecture, preuve de conformité, SLA |
| `…/sdk` | Client HTTP typé pour l’API REST d’Attestia |

## Schéma de base

Chaque interaction suit un flux unique, et aucune étape n’est facultative :

```
Intent → Approve → Execute → Verify
```

## Documentation

Manuel complet, architecture, modèle de menace et guide de vérification : **<https://mcp-tool-shop-org.github.io/attestia/>** · Source : **<https://github.com/mcp-tool-shop-org/attestia>**

## Licence

[MIT](LICENSE) — créé par [MCP Tool Shop](https://mcp-tool-shop.github.io/).
