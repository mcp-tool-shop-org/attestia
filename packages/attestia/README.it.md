<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.md">English</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/Attestia/readme.png" alt="Attestia" width="400">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mcptoolshop/attestia"><img src="https://img.shields.io/npm/v/@mcptoolshop/attestia" alt="npm version"></a>
  <a href="https://github.com/mcp-tool-shop-org/attestia/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/attestia/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://opensource.org/license/mit/"><img src="https://img.shields.io/badge/License-MIT-yellow" alt="MIT License"></a>
</p>

<p align="center"><strong>Prova che un evento, una transazione o una transizione di stato si è verificato, e che è legato a una catena. L’intera libreria in un unico pacchetto.</strong></p>

Il dominio di questo pacchetto è la verità finanziaria: portafoglio personale, tesoreria aziendale e registro. Governance strutturale, contabilità deterministica e consenso umano tra catene, organizzazioni e individui. Attestia non sposta i tuoi fondi. Dimostra cosa è successo, limita ciò che può accadere e rende il registro finanziario inviolabile.

Cognate utilizza l’archivio eventi e le prove di Merkle in questo pacchetto per la governance dell’IA. RepoMesh è un registro separato e non utilizza questo albero di Merkle.

Questo pacchetto include l’intera libreria Attestia in un’unica installazione (ESM). I pacchetti interni `@attestia/*` sono inclusi direttamente: non è necessario gestire la proliferazione dei pacchetti; le dipendenze di runtime di terze parti (xrpl, viem, @solana/web3.js, json-canonicalize, ripple-keypairs) vengono risolte normalmente.

## Installazione

```bash
npm install @mcptoolshop/attestia
```

> **Solo ESM** (Node ≥ 22). Pubblicato con [npm provenance](https://docs.npmjs.com/generating-provenance-statements) tramite GitHub Actions OIDC Trusted Publishing.

## Utilizzo

Importa un dominio come **namespace** dalla radice:

```ts
import { ledger, proof, registrum } from "@mcptoolshop/attestia";

const total = ledger.addMoney(
  { amount: "100.00", currency: "USD", decimals: 2 },
  { amount: "50.00", currency: "USD", decimals: 2 },
);

const tree = proof.MerkleTree.build([/* sha-256 leaf hashes */]);
```

…oppure importa simboli singoli da un **sottopercorso**:

```ts
import { MerkleTree, verifyAttestationProof } from "@mcptoolshop/attestia/proof";
import { StructuralRegistrar } from "@mcptoolshop/attestia/registrum";
import { JsonlEventStore } from "@mcptoolshop/attestia/event-store";
import { AttestiaClient } from "@mcptoolshop/attestia/sdk";
```

## Sottopercorsi

| Sottopercorso | Cos’è |
|---------|-----------|
| `@mcptoolshop/attestia` | Radice del pacchetto: ogni dominio come namespace |
| `…/types` | Tipi di dominio condivisi (denaro, ID, elementi primitivi con marchio) |
| `…/ledger` | Motore di contabilità a partita doppia con aggiunta sequenziale + matematica deterministica del denaro |
| `…/registrum` | Registro costituzionale: 11 invarianti, doppia attestazione |
| `…/event-store` | Archiviazione di eventi con aggiunta sequenziale: JSONL, catena di hash |
| `…/proof` | Alberi di Merkle (RFC 6962), prove di inclusione + attestazione |
| `…/vault` | Portafoglio personale: portafogli, budget, obiettivi |
| `…/treasury` | Tesoreria aziendale: buste paga, distribuzioni, controlli sui finanziamenti |
| `…/reconciler` | Corrispondenza tra sistemi + attestazione del Registrum |
| `…/chain-observer` | Osservazione multi-catena in sola lettura (EVM, XRPL, Solana, L2) |
| `…/witness` | Attestazione on-chain XRPL, governance multi-firma |
| `…/verify` | Verifica della riproduzione, prove di conformità, SLA |
| `…/sdk` | Client HTTP tipizzato per l’API REST di Attestia |

## Schema principale

Ogni interazione segue un flusso e nessuna fase è facoltativa:

```
Intent → Approve → Execute → Verify
```

## Documentazione

Manuale completo, architettura, modello di minaccia e guida alla verifica: **<https://mcp-tool-shop-org.github.io/attestia/>** · Sorgente: **<https://github.com/mcp-tool-shop-org/attestia>**

## Licenza

[MIT](LICENSE) — sviluppato da [MCP Tool Shop](https://mcp-tool-shop.github.io/).
