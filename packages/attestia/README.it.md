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

<p align="center"><strong>Infrastruttura per la verifica finanziaria nel mondo decentralizzato: l’intera libreria Attestia in un unico pacchetto.</strong></p>

Governance strutturale, contabilità deterministica e convalida umana delle intenzioni: tutto integrato tra diverse catene di blocchi, organizzazioni e singoli individui. Attestia non gestisce i vostri fondi; si limita a dimostrare cosa è successo, a definire i limiti di ciò che può accadere e a rendere inalterabile la documentazione finanziaria.

Questo pacchetto include l’intera libreria Attestia e la integra in un’unica installazione (ESM). I pacchetti interni `@attestia/*` sono inclusi direttamente nel codice, quindi non è necessario gestire una proliferazione di pacchetti; le dipendenze esterne necessarie per l’esecuzione (xrpl, viem, @solana/web3.js, json-canonicalize, ripple-keypairs) vengono risolte normalmente.

## Installa

```bash
npm install @mcptoolshop/attestia
```

> **Solo ESM** (versione Node ≥ 22). Pubblicato tramite GitHub Actions OIDC Trusted Publishing, con l’utilizzo di [npm provenance](https://docs.npmjs.com/generating-provenance-statements).

## Utilizzo

Importa un dominio come **spazio dei nomi** dalla directory principale:

```ts
import { ledger, proof, registrum } from "@mcptoolshop/attestia";

const total = ledger.addMoney(
  { amount: "100.00", currency: "USD", decimals: 2 },
  { amount: "50.00", currency: "USD", decimals: 2 },
);

const tree = proof.MerkleTree.build([/* sha-256 leaf hashes */]);
```

…oppure importa simboli piatti da una **sottocartella**:

```ts
import { MerkleTree, verifyAttestationProof } from "@mcptoolshop/attestia/proof";
import { StructuralRegistrar } from "@mcptoolshop/attestia/registrum";
import { JsonlEventStore } from "@mcptoolshop/attestia/event-store";
import { AttestiaClient } from "@mcptoolshop/attestia/sdk";
```

## Sottodirectory

| Sottodirectory | Cos’è. |
|---------|-----------|
| `@mcptoolshop/attestia` | Dominio principale: ogni dominio funge da spazio dei nomi. |
| `…/types` | Tipi di dominio condivisi (valuta, identificativi, elementi grafici personalizzati). |
| `…/ledger` | Motore di contabilità a doppia registrazione con possibilità di aggiungere dati in modo sequenziale + calcoli monetari deterministici. |
| `…/registrum` | Registro costituzionale – 11 invarianti, sistema a doppia verifica. |
| `…/event-store` | Memorizzazione degli eventi con possibilità di aggiungere dati in modo sequenziale – formato JSONL, catena di hash. |
| `…/proof` | Alberi di Merkle (RFC 6962), prove di inclusione e attestazione. |
| `…/vault` | Archivio personale: portafogli, budget, obiettivi. |
| `…/treasury` | Risorse finanziarie dell’organizzazione: gestione delle retribuzioni, distribuzione dei fondi, controllo degli stanziamenti. |
| `…/reconciler` | Correlazione tra sistemi diversi + attestazione tramite Registrum |
| `…/chain-observer` | Osservazione in sola lettura su più blockchain (EVM, XRPL, Solana, L2). |
| `…/witness` | Attestazione sulla blockchain XRPL, sistema di governance a più firme. |
| `…/verify` | Verifica delle registrazioni, documentazione di conformità, accordo sui livelli di servizio (SLA) |
| `…/sdk` | Client HTTP basato su tipizzazione statica per l’API REST di Attestia. |

## Schema di base/principale

Ogni interazione segue un determinato schema e nessuna fase è facoltativa:

```
Intent → Approve → Execute → Verify
```

## Documentazione

Manuale completo, descrizione dell’architettura, modello delle minacce e guida alla verifica: **<https://mcp-tool-shop-org.github.io/attestia/>** · Fonte: **<https://github.com/mcp-tool-shop-org/attestia>**

## Licenza

[LICENZA MIT] – sviluppato da [MCP Tool Shop](https://mcp-tool-shop.github.io/).
