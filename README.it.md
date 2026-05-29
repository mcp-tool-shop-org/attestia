<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.md">English</a> | <a href="README.pt-BR.md">Português (BR)</a>
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

<p align="center"><strong>Infrastruttura per la trasparenza finanziaria nel mondo decentralizzato.</strong></p>

---

## Missione

Crediamo che il denaro, ovunque si trovi e come si muove, meriti la stessa accuratezza dei sistemi che lo hanno creato. Gli smart contract eseguono. Le blockchain registrano. Ma nessuno *attesta*.

Attestia è lo strato mancante: governance strutturale, contabilità deterministica e approvazione umana, tutto unificato tra blockchain, organizzazioni e individui.

Non spostiamo i vostri soldi. Dimostriamo cosa è successo, limitiamo ciò che può accadere e rendiamo la registrazione finanziaria inviolabile.

### Ciò in cui crediamo

- **Trasparenza al posto della velocità.** Ogni evento finanziario è registrato in modo permanente, riproducibile e riconciliabile. Se non può essere provato, non è successo.
- **Gli esseri umani approvano; le macchine verificano.** L'intelligenza artificiale fornisce suggerimenti, gli smart contract eseguono, ma nulla si muove senza l'autorizzazione esplicita di un essere umano. Mai.
- **Governance strutturale, non politica.** Non votiamo su ciò che è valido. Definiamo principi fondamentali che sono sempre validi: l'identità è esplicita, la provenienza è tracciabile, l'ordine è deterministico.
- **L'intento non è l'esecuzione.** Dichiarare ciò che si desidera e metterlo in atto sono azioni separate, con controlli separati. La distanza tra loro è dove risiede la fiducia.
- **Le blockchain sono testimoni, non autorità.** XRPL attesta. Ethereum liquida. Ma l'autorità deriva da regole strutturali, non dal consenso di una qualsiasi blockchain.
- **L'infrastruttura affidabile è la chiave del successo.** Il mondo non ha bisogno di un altro protocollo DeFi. Ha bisogno dello strato di contabilità sottostante, della "tubatura" finanziaria che rende tutto il resto affidabile.

---

## Architettura

Attestia è composta da tre sistemi, con un'unica fonte di verità:

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

| Sistema | Funzione | Origine |
|--------|------|--------|
| **Personal Vault** | Osservazione multi-catena del portafoglio, budgetizzazione, dichiarazione di intento | Evoluto da NextLedger |
| **Org Treasury** | Elaborazione paghe, distribuzioni DAO, finanziamenti con doppia autorizzazione, libro mastro a partita doppia | Evoluto da Payroll Engine |
| **Registrum** | Registro strutturale: 11 principi fondamentali, validazione con doppia testimonianza, attestazione XRPL | Inalterato: strato costituzionale |

---

## Provatelo in 2 minuti

Il modo più veloce per capire Attestia è osservare un pagamento che attraversa l'intero processo. La demo interattiva esegue l'intera pipeline **Intento → Approvazione → Esecuzione → Verifica → Attestazione → Prova** dall'inizio alla fine, con calcoli reali sui pacchetti di dati effettivi (corrispondenza, hashing, attestazione in stile XRPL, prova Merkle), non su una simulazione.

```bash
pnpm install   # Install all dependencies
pnpm build     # Build all packages
pnpm demo      # Walk the full pipeline (~10s, paced for readability)
```

Vedrete un singolo pagamento di stipendio trasformarsi in una prova crittografica verificabile in modo indipendente, passo dopo passo. Aggiungete `--fast` per saltare le pause ed eseguire immediatamente: `pnpm demo --fast` (`pnpm demo --help` elenca tutte le opzioni).

---

## Modello di base

Ogni interazione segue un flusso:

```
Intent → Approve → Execute → Verify
```

1. **Intento** — Un utente o un sistema dichiara un risultato desiderato.
2. **Approvazione** — Il registro valida strutturalmente; un essere umano firma esplicitamente.
3. **Esecuzione** — La transazione on-chain viene inviata.
4. **Verifica** — La riconciliazione conferma; XRPL attesta la registrazione.

Nessun passaggio è facoltativo. Nessun passaggio è automatizzato.

---

## Principi

| Principio | Implementazione |
|-----------|---------------|
| Registrazioni permanenti | Nessun UPDATE, nessun DELETE: solo nuove voci. |
| Fail-closed | Un disaccordo interrompe il sistema, ma non lo risolve silenziosamente. |
| Riproducibilità deterministica | Gli stessi eventi producono sempre lo stesso stato. |
| Intelligenza artificiale solo consultiva | L'intelligenza artificiale può analizzare, avvertire, suggerire, ma non approvare, firmare o eseguire. |
| Osservazione multi-catena | Ethereum, XRPL, Solana, L2: livello di lettura indipendente dalla blockchain. |
| Identità strutturale | Esplicito, immutabile, univoco: non biometrico, ma costituzionale. |

---

## Stato

14 pacchetti, 2.220 test, copertura del 96,80%, tutto verde. Compilazione pubblica.

| Pacchetto | Test | Scopo |
|---------|-------|---------|
| `@attestia/types` | 72 | Tipi di dominio condivisi (nessuna dipendenza) |
| `@attestia/registrum` | 341 | Governance costituzionale: 11 invarianti, doppia verifica. |
| `@attestia/ledger` | 154 | Motore di registrazione a sola aggiunta (append-only) a doppia entrata. |
| `@attestia/chain-observer` | 278 | Osservazione in sola lettura su più blockchain (EVM + XRPL + Solana + L2). |
| `@attestia/vault` | 75 | Portafoglio personale: portafogli, budget, intenzioni. |
| `@attestia/treasury` | 92 | Tesoreria aziendale: stipendi, distribuzioni, meccanismi di finanziamento. |
| `@attestia/reconciler` | 81 | Corrispondenza cross-system in 3D + attestazione Registrum. |
| `@attestia/witness` | 278 | Attestazione on-chain su XRPL, governance multi-firma, retry. |
| `@attestia/verify` | 242 | Verifica di replay, prove di conformità, applicazione degli SLA. |
| `@attestia/event-store` | 226 | Persistenza degli eventi a sola aggiunta, JSONL, catena di hash, 34 tipi di eventi. |
| `@attestia/proof` | 75 | Alberi di Merkle, prove di inclusione, confezionamento delle prove di attestazione. |
| `@attestia/sdk` | 79 | SDK client HTTP tipizzato per consumatori esterni. |
| `@attestia/node` | 227 | API REST Hono: 34 endpoint, autenticazione, multi-tenancy, API pubblica, conformità. |
| `@attestia/demo` | — | Demo interattiva da riga di comando: panoramica completa della pipeline Attestia (privata, senza test). |

### Sviluppo

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm test             # Run all tests (2,220)
pnpm test:coverage    # Run with coverage reporting
pnpm typecheck        # Type-check all packages
pnpm bench            # Run benchmarks
```

### Test di integrazione con XRPL

Un nodo `rippled` autonomo viene eseguito in Docker per test di integrazione on-chain deterministici: nessuna dipendenza da testnet, nessun faucet, chiusura del ledger in meno di un secondo.

```bash
docker compose up -d              # Start standalone rippled
pnpm --filter @attestia/witness run test:integration  # Run on-chain round-trip tests
docker compose down               # Stop rippled
```

### Documentazione

| Documento | Scopo |
|----------|---------|
| [HANDBOOK.md](HANDBOOK.md) | Panoramica generale e riferimento completo dei pacchetti. |
| [ROADMAP.md](ROADMAP.md) | Roadmap del progetto fase per fase. |
| [DESIGN.md](DESIGN.md) | Decisioni architetturali. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Grafico dei pacchetti, flussi di dati, modello di sicurezza. |
| [REFERENCE_ARCHITECTURE.md](REFERENCE_ARCHITECTURE.md) | Stack a 5 livelli, modelli di deployment, confini di fiducia. |
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | Integrazione API con esempi curl + utilizzo dell'SDK. |
| [VERIFICATION_GUIDE.md](VERIFICATION_GUIDE.md) | Guida dettagliata per gli auditor per la verifica. |
| [THREAT_MODEL.md](THREAT_MODEL.md) | Analisi STRIDE per componente. |
| [CONTROL_MATRIX.md](CONTROL_MATRIX.md) | Mappature da minaccia a controllo a file a test. |
| [SECURITY.md](SECURITY.md) | Politica di divulgazione responsabile. |
| [INSTITUTIONAL_READINESS.md](INSTITUTIONAL_READINESS.md) | Checklist di preparazione all'adozione. |
| [PERFORMANCE_BASELINE.md](PERFORMANCE_BASELINE.md) | Benchmark registrati. |

---

## Sicurezza e ambito dei dati

- **Dati accessibili:** Lettura e scrittura di voci del registro finanziario, record di attestazione e prove crittografiche. Si connette ai nodi blockchain (XRPL) quando il modulo di attestazione è attivo.
- **Dati NON accessibili:** Nessuna telemetria. Nessun archivio di credenziali utente. Nessuna analisi di terze parti.
- **Permessi richiesti:** Accesso in lettura/scrittura alle directory di dati locali. Accesso alla rete solo per l'attestazione blockchain. Consultare [THREAT_MODEL.md](THREAT_MODEL.md) per l'analisi STRIDE completa.

## Scheda di valutazione

| Valutazione | Stato |
|------|--------|
| A. Baseline di sicurezza | PASS |
| B. Gestione degli errori | PASS |
| C. Documentazione per gli operatori | PASS |
| D. Igiene di rilascio | PASS |
| E. Identità | PASS |

## Licenza

[MIT](LICENSE)

---

Creato da <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a
