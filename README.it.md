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

<p align="center"><strong>Infrastruttura di verità finanziaria per il mondo decentralizzato.</strong></p>

---

## Missione

Crediamo che il denaro – ovunque si trovi, qualunque sia il suo movimento – meriti lo stesso rigore dei sistemi che l'hanno creato. Gli smart contract vengono eseguiti. Le blockchain registrano. Ma nessuno *attesta*.

Attestia è lo strato mancante: governance strutturale, contabilità deterministica e consenso umano – unificati tra diverse blockchain, organizzazioni e individui.

Non spostiamo i tuoi soldi. Dimostriamo cosa è successo, limitiamo ciò che può accadere e rendiamo il registro finanziario inviolabile.

### I nostri valori

- **La verità prima della velocità.** Ogni evento finanziario è di sola aggiunta, riproducibile e riconciliabile. Se non può essere provato, allora non è accaduto.
- **Gli esseri umani approvano; le macchine verificano.** L'intelligenza artificiale fornisce consulenza, gli smart contract vengono eseguiti, ma nulla si muove senza un'esplicita autorizzazione umana. Mai.
- **Governance strutturale, non governance politica.** Non votiamo su ciò che è valido. Definiamo invarianti che valgono incondizionatamente: l'identità è esplicita, la linea di discendenza è continua, l'ordine è deterministico.
- **L'intenzione non è l'esecuzione.** Dichiarare cosa si vuole e farlo sono atti separati con porte separate. Il divario tra loro è dove risiede la fiducia.
- **Le blockchain sono testimoni, non autorità.** XRPL attesta. Ethereum regola. Ma l'autorità deriva da regole strutturali, non dal consenso di una singola blockchain.
- **Un'infrastruttura solida vince.** Il mondo non ha bisogno di un altro protocollo DeFi. Ha bisogno dello strato contabile sottostante: la "tubatura" finanziaria che rende tutto il resto affidabile.

---

## Architettura

Attestia è composta da tre sistemi, una sola verità:

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

| Sistema | Ruolo | Origine |
|--------|------|--------|
| **Personal Vault** | Osservazione di portafogli multi-chain, budget a busta chiusa, dichiarazione di intenti | Evoluto da NextLedger |
| **Org Treasury** | Gestione stipendi deterministica, distribuzioni DAO, finanziamenti a doppia porta, libro mastro a partita doppia | Evoluto da Payroll Engine |
| **Registrum** | Registro strutturale: 11 invarianti, convalida a doppio testimone, attestazione XRPL | Invariato: strato costituzionale |

---

## Provalo in 2 minuti

Il modo più rapido per comprendere Attestia è osservare un singolo flusso di pagamento. La demo interattiva esegue l'intero processo **Intento → Approvazione → Esecuzione → Verifica → Attestazione → Prova** dall'inizio alla fine: ogni fase viene calcolata in tempo reale sui pacchetti di dominio effettivi (corrispondenza, hashing, attestazione in stile XRPL, prova Merkle), e non si tratta di una simulazione.

```bash
pnpm install   # Install all dependencies
pnpm build     # Build all packages
pnpm demo      # Walk the full pipeline (~10s, paced for readability)
```

Vedrai un singolo pagamento degli stipendi trasformarsi in una prova crittografica verificabile indipendentemente, passo dopo passo. Aggiungi `--fast` per saltare i tempi di attesa ed eseguirlo istantaneamente: `pnpm demo --fast` (`pnpm demo --help` elenca tutti i flag).

---

## Schema principale

Ogni interazione segue un flusso:

```
Intent → Approve → Execute → Verify
```

1. **Intento:** Un utente o un sistema dichiara il risultato desiderato.
2. **Approvazione:** Registrum convalida a livello strutturale; un essere umano firma esplicitamente.
3. **Esecuzione:** La transazione on-chain viene inviata.
4. **Verifica:** La riconciliazione conferma; XRPL attesta il record.

Nessun passaggio è opzionale. Nessun passaggio viene automatizzato.

---

## Principi

| Principio | Implementazione |
|-----------|---------------|
| Record di sola aggiunta | Nessun AGGIORNAMENTO, nessuna ELIMINAZIONE: solo nuove voci. |
| Funzionamento sicuro (fail-closed) | Il disaccordo interrompe il sistema, non lo corregge silenziosamente. |
| Riproduzione deterministica | Gli stessi eventi producono sempre lo stesso stato. |
| Solo intelligenza artificiale di supporto | L'IA può analizzare, avvisare e suggerire, ma non approvare, firmare o eseguire. |
| Osservazione multi-chain | Ethereum, XRPL, Solana, L2: strato di lettura indipendente dalla blockchain. |
| Identità strutturale | Esplicita, immutabile, unica: non biometrica, ma costituzionale. |

---

## Stato

14 pacchetti, 2.564 test, copertura superiore al 95%, tutto a posto. Sviluppo in pubblico.

| Pacchetto | Test | Scopo |
|---------|-------|---------|
| `@attestia/types` | 75 | Tipi di dominio condivisi (nessuna dipendenza) |
| `@attestia/registrum` | 368 | Governance costituzionale: 11 invarianti, convalida a doppio testimone. |
| `@attestia/ledger` | 156 | Motore a partita doppia di sola aggiunta. |
| `@attestia/chain-observer` | 295 | Osservazione multi-chain in sola lettura (EVM + XRPL + Solana + L2). |
| `@attestia/vault` | 91 | Vault personale: portafogli, budget, intenti. |
| `@attestia/treasury` | 109 | Tesoro dell'organizzazione: gestione stipendi, distribuzioni, porte di finanziamento. |
| `@attestia/reconciler` | 98 | Corrispondenza 3D tra sistemi + attestazione Registrum. |
| `@attestia/witness` | 295 | Attestazione on-chain XRPL, governance multi-firma, riprova. |
| `@attestia/verify` | 273 | Verifica della riproduzione, prove di conformità, applicazione degli SLA. |
| `@attestia/event-store` | 253 | Persistenza di eventi di sola aggiunta, JSONL, catena hash, 34 tipi di evento. |
| `@attestia/proof` | 94 | Alberi Merkle (RFC 6962), inclusioni di prove, pacchetti di prova di attestazione. |
| `@attestia/sdk` | 115 | SDK client HTTP tipizzato per consumatori esterni. |
| `@attestia/node` | 342 | API REST Hono: persistenza durevole, autenticazione, multi-tenant, tesoro/vault/governance, OpenAPI. |
| `@attestia/demo` | — | Demo interattiva CLI: esegui l'intero processo Attestia (privata, senza test). |

### Sviluppo

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm test             # Run all tests (2,564)
pnpm test:coverage    # Run with coverage reporting
pnpm typecheck        # Type-check all packages
pnpm bench            # Run benchmarks
```

### Test di integrazione XRPL

Un nodo `rippled` autonomo viene eseguito in Docker per i test di integrazione on-chain deterministici: nessuna dipendenza dalla testnet, nessun faucet, chiusura del libro mastro in meno di un secondo.

```bash
docker compose up -d              # Start standalone rippled
pnpm --filter @attestia/witness run test:integration  # Run on-chain round-trip tests
docker compose down               # Stop rippled
```

### Documentazione

| Documento | Scopo |
|----------|---------|
| [HANDBOOK.md](HANDBOOK.md) | Panoramica generale e riferimento completo dei pacchetti. |
| [ROADMAP.md](ROADMAP.md) | Roadmap del progetto per fasi. |
| [DESIGN.md](DESIGN.md) | Decisioni sull'architettura. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Grafico dei pacchetti, flussi di dati, modello di sicurezza. |
| [REFERENCE_ARCHITECTURE.md](REFERENCE_ARCHITECTURE.md) | Stack a 5 livelli, modelli di implementazione, confini di fiducia. |
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | Integrazione API con esempi curl + utilizzo dell'SDK. |
| [VERIFICATION_GUIDE.md](VERIFICATION_GUIDE.md) | Guida dettagliata per la riproduzione dei passaggi eseguiti dall’auditor |
| [THREAT_MODEL.md](THREAT_MODEL.md) | Analisi STRIDE per componente |
| [CONTROL_MATRIX.md](CONTROL_MATRIX.md) | Mappatura: minaccia → controllo → file → test |
| [SECURITY.md](SECURITY.md) | Politica di divulgazione responsabile |
| [INSTITUTIONAL_READINESS.md](INSTITUTIONAL_READINESS.md) | Lista di controllo per la preparazione all’implementazione |
| [PERFORMANCE_BASELINE.md](PERFORMANCE_BASELINE.md) | Parametri di riferimento registrati |

---

## Ambito della sicurezza e dei dati

- **Dati a cui si accede:** Lettura e scrittura di voci del libro mastro finanziario, record di attestazione e prove crittografiche. Connessione ai nodi blockchain (XRPL) quando il modulo witness è attivo.
- **Dati a cui NON si accede:** Nessuna telemetria. Nessun archivio di credenziali utente. Nessuna analisi di terze parti.
- **Autorizzazioni richieste:** Accesso in lettura/scrittura alle directory dati locali. Accesso alla rete solo per l’attestazione blockchain. Per l’analisi STRIDE completa, consultare [THREAT_MODEL.md](THREAT_MODEL.md).

## Tabella dei punteggi

| Gateway | Stato |
|------|--------|
| A. Standard di sicurezza | SUPERATO |
| B. Gestione degli errori | SUPERATO |
| C. Documentazione per l’operatore | SUPERATO |
| D. Procedure operative standard | SUPERATO |
| E. Identità | SUPERATO |

## Licenza

[MIT](LICENSE)

---

Realizzato da <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
