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

<p align="center"><strong>Prova che un evento, una transazione o una transizione di stato si è verificato ed è collegato a una blockchain.</strong></p>

---

## Missione

Crediamo che il denaro, ovunque si trovi e come si muova, meriti lo stesso rigore dei sistemi che lo hanno creato. Gli smart contract vengono eseguiti. Le blockchain registrano. Ma nessuno *attesta*.

Attestia fornisce questo livello per il denaro: governance strutturale, contabilità deterministica e consenso umano, su diverse blockchain, organizzazioni e individui.

Non spostiamo il tuo denaro. Dimostriamo cosa è successo, limitiamo ciò che può accadere e rendiamo il registro finanziario inviolabile.

### I nostri valori

- **La verità prima della velocità.** Ogni evento finanziario è di sola aggiunta, riproducibile e riconciliabile. Se non può essere provato, non è successo.
- **Gli esseri umani approvano; le macchine verificano.** L'IA fornisce consulenza, gli smart contract vengono eseguiti, ma nulla si muove senza un'esplicita autorizzazione umana. Mai.
- **Governance strutturale, non governance politica.** Non votiamo su ciò che è valido. Definiamo invarianti che valgono incondizionatamente: l'identità è esplicita, la linea di discendenza è ininterrotta, l'ordine è deterministico.
- **L'intenzione non è l'esecuzione.** Dichiarare ciò che si desidera e farlo sono atti separati con porte di accesso separate. Il divario tra loro è dove risiede la fiducia.
- **Le blockchain sono testimoni, non autorità.** XRPL attesta. Ethereum liquida. Ma l'autorità deriva da regole strutturali, non dal consenso di una qualsiasi blockchain.
- **Un'infrastruttura affidabile è vincente.** Il mondo non ha bisogno di un altro protocollo DeFi. Ha bisogno del livello di contabilità sottostante, l'infrastruttura finanziaria che rende tutto il resto affidabile.

## Ruolo nel sistema

Attestia, Cognate e RepoMesh sono tre prodotti.

**Attestia** dimostra che un evento, una transazione o una transizione di stato si è verificato e lega tale prova a una blockchain. Il suo ambito è la verità finanziaria: portafoglio personale, tesoreria organizzativa e registro. I suoi elementi di prova sono un archivio di eventi di sola aggiunta e prove di Merkle.

**Cognate** è il dominio di governance AI basato su questi elementi: modello di linea di discendenza, decisioni politiche, capacità degli agenti e integrità dei prompt e degli output. Non mantiene un secondo archivio di eventi.

**RepoMesh** è la rete di rilascio: eventi firmati, manifesti dei nodi e un orologio di fiducia ancorato a XRPL. Mantiene il proprio registro RFC 6962. Non utilizza l'albero di Merkle di Attestia.

Cognate chiama Attestia quando ha bisogno di una prova e RepoMesh quando ha bisogno che un rilascio venga verificato.

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
| **Personal Vault** | Osservazione di portafogli multi-blockchain, budget a busta, dichiarazione di intenti | Evoluto da NextLedger |
| **Org Treasury** | Paghe deterministiche, distribuzioni DAO, finanziamenti a doppia porta, libro mastro a doppia entrata | Evoluto da Payroll Engine |
| **Registrum** | Registro strutturale: 11 invarianti, convalida a doppia testimonianza, attestazione XRPL | Inalterato: livello costituzionale |

---

## Provalo in 2 minuti

Il modo più rapido per comprendere Attestia è osservare un pagamento che scorre completamente attraverso l'intero processo. La demo interattiva esegue l'intera pipeline **Intento → Approvazione → Esecuzione → Verifica → Attestazione → Prova** dall'inizio alla fine: ogni fase viene calcolata in tempo reale rispetto ai pacchetti di dominio effettivi (corrispondenza, hashing, attestazione in stile XRPL, prova di Merkle), non una simulazione.

```bash
pnpm install   # Install all dependencies
pnpm build     # Build all packages
pnpm demo      # Walk the full pipeline (~10s, paced for readability)
```

Vedrai un singolo pagamento di stipendio trasformarsi in una prova crittografica verificabile in modo indipendente, passo dopo passo. Aggiungi `--fast` per saltare i tempi di attesa ed eseguirlo istantaneamente: `pnpm demo --fast` (`pnpm demo --help` elenca tutti i flag).

---

## Schema principale

Ogni interazione segue un flusso:

```
Intent → Approve → Execute → Verify
```

1. **Intento:** un utente o un sistema dichiara un risultato desiderato
2. **Approvazione:** Registrum convalida strutturalmente; un essere umano firma esplicitamente
3. **Esecuzione:** la transazione on-chain viene inviata
4. **Verifica:** la riconciliazione conferma; XRPL attesta il record

Nessun passaggio è facoltativo. Nessun passaggio viene automatizzato.

---

## Principi

| Principio | Implementazione |
|-----------|---------------|
| Record di sola aggiunta | Nessun AGGIORNAMENTO, nessuna ELIMINAZIONE: solo nuove voci |
| Funzionamento sicuro | Il disaccordo interrompe il sistema, non lo corregge silenziosamente |
| Riproduzione deterministica | Gli stessi eventi producono sempre lo stesso stato |
| Solo IA di supporto | L'IA può analizzare, avvisare, suggerire, ma non approvare, firmare o eseguire |
| Osservazione multi-blockchain | Ethereum, XRPL, Solana, L2s: livello di lettura indipendente dalla blockchain |
| Identità strutturale | Esplicita, immutabile, unica: non biometrica, ma costituzionale |

---

## Stato

Versione 2.1.3. 15 pacchetti di spazio di lavoro, 2.605 test in CI più 3 test di verifica del bundle, copertura dello statement dal 94,9 al 100% per pacchetto, tutto a posto. In fase di sviluppo pubblico.

| Pacchetto | Test | Scopo |
|---------|-------|---------|
| `@attestia/types` | 75 | Tipi di dominio condivisi (nessuna dipendenza) |
| `@attestia/registrum` | 368 | Governance costituzionale: 11 invarianti, doppia testimonianza |
| `@attestia/ledger` | 156 | Motore a doppia entrata di sola aggiunta |
| `@attestia/chain-observer` | 295 | Osservazione multi-blockchain in sola lettura (EVM + XRPL + Solana + L2s) |
| `@attestia/vault` | 91 | Portafoglio personale: portafogli, budget, intenti |
| `@attestia/treasury` | 109 | Tesoreria organizzativa: paghe, distribuzioni, porte di finanziamento |
| `@attestia/reconciler` | 98 | Corrispondenza 3D tra sistemi + attestazione di Registrum |
| `@attestia/witness` | 295 | Attestazione on-chain XRPL, governance multi-firma, riprova |
| `@attestia/verify` | 273 | Verifica della riproduzione, prova di conformità, applicazione degli SLA |
| `@attestia/event-store` | 263 | Persistenza di eventi di sola aggiunta, JSONL, catena di hash, 34 tipi di eventi |
| `@attestia/proof` | 94 | Alberi di Merkle (RFC 6962), prove di inclusione, pacchettizzazione delle prove di attestazione |
| `@attestia/sdk` | 115 | SDK HTTP client tipizzato per utenti esterni |
| `@attestia/node` | 362 | API REST Hono: persistenza affidabile, autenticazione, multi-tenant, gestione di asset/portafogli/governance, OpenAPI |
| `@mcptoolshop/attestia` | 3 | Il pacchetto npm pubblicato: tutte le librerie di cui sopra in un unico pacchetto, con esportazioni di sottopercorsi (test di verifica, eseguiti da `pnpm test`; l'esecuzione dei test di copertura di CI non li include) |
| `@attestia/demo` | — | Demo interattiva della CLI: esecuzione completa della pipeline Attestia (privata, senza test) |

### Novità nella versione 2.1

- **2.1.2: ripristino in caso di arresto anomalo per il registro eventi.** Se un processo di scrittura viene interrotto a metà di una riga, `JsonlEventStore` salta l'ultima riga incompleta al riavvio e la prima scrittura aggiunge un carattere di nuova riga, in modo che i nuovi eventi inizino su una riga nuova. Il frammento incompleto rimane nel file e viene saltato ad ogni caricamento. Gli eventi per i quali `append()` è stato restituito si trovano sul disco. Un evento danneggiato nel mezzo del registro fa sì che l'archivio rifiuti comunque di aprirsi (`INTEGRITY_VIOLATION`, con l'impostazione predefinita `verifyOnLoad: true`). Il file README dell'archivio eventi indica [cosa viene mantenuto dopo un riavvio](packages/event-store/README.md).
- **2.1.1: Zod 4.** La convalida ora viene eseguita con Zod 4.6.7. La formulazione dei messaggi di convalida integrati in `details.issues[].message` e in `ConfigError` è stata modificata (ad esempio, `"Required"` è ora `"Invalid input: expected <type>, received undefined"`). I codici di errore, i percorsi dei problemi, l'involucro di errore HTTP e i messaggi di raffinamento di Attestia rimangono invariati, quindi è necessario confrontare i codici e i percorsi, non il testo del messaggio.
- **2.1.0: un registro eventi affidabile per il servizio.** `ATTESTIA_EVENTS_FILE` apre quel file come registro eventi del proprietario configurato. Se non è impostato, il servizio rimane in memoria. Una voce `API_KEYS` non valida non inserisce più la chiave nell'errore di avvio.

Consultare [CHANGELOG.md](CHANGELOG.md) per l'elenco completo.

### Sviluppo

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm test             # Run all tests (2,597)
pnpm test:coverage    # Run with coverage reporting
pnpm typecheck        # Type-check all packages
pnpm bench            # Run benchmarks
```

### Test di integrazione XRPL

Un nodo `rippled` autonomo viene eseguito in Docker per test di integrazione deterministici sulla catena: nessuna dipendenza dalla testnet, nessun faucet, chiusura del registro in meno di un secondo.

```bash
docker compose up -d              # Start standalone rippled
pnpm --filter @attestia/witness run test:integration  # Run on-chain round-trip tests
docker compose down               # Stop rippled
```

### Documentazione

| Documento | Scopo |
|----------|---------|
| [HANDBOOK.md](HANDBOOK.md) | Panoramica generale e riferimento completo del pacchetto |
| [ROADMAP.md](ROADMAP.md) | Roadmap del progetto per fasi |
| [DESIGN.md](DESIGN.md) | Decisioni sull'architettura |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Grafico del pacchetto, flussi di dati, modello di sicurezza |
| [REFERENCE_ARCHITECTURE.md](REFERENCE_ARCHITECTURE.md) | Stack a 5 livelli, modelli di distribuzione, confini di fiducia |
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | Integrazione API con esempi di curl + utilizzo dell'SDK |
| [VERIFICATION_GUIDE.md](VERIFICATION_GUIDE.md) | Guida passo passo per l'auditor |
| [THREAT_MODEL.md](THREAT_MODEL.md) | Analisi STRIDE per componente |
| [CONTROL_MATRIX.md](CONTROL_MATRIX.md) | Mappature Minaccia → controllo → file → test |
| [SECURITY.md](SECURITY.md) | Politica di divulgazione responsabile |
| [INSTITUTIONAL_READINESS.md](INSTITUTIONAL_READINESS.md) | Checklist di preparazione all'adozione |
| [PERFORMANCE_BASELINE.md](PERFORMANCE_BASELINE.md) | Benchmark registrati |

---

## Sicurezza e ambito dei dati

- **Dati a cui si accede:** legge e scrive voci del registro finanziario, record di attestazione e prove crittografiche. Il servizio scrive il proprio registro eventi nel file specificato da `ATTESTIA_EVENTS_FILE` quando è impostato. Si connette ai nodi blockchain (XRPL) quando il modulo witness è attivo.
- **Dati a cui NON si accede:** nessun telemetria. Nessun archivio di credenziali utente. Nessuna analisi di terze parti.
- **Integrità su disco:** il registro eventi è di sola aggiunta e concatenato tramite hash. Una riga incompleta da un arresto anomalo viene saltata e il registro riprende; qualsiasi danno che interrompe la catena fa sì che l'archivio rifiuti di aprirsi per impostazione predefinita.
- **Autorizzazioni richieste:** accesso in lettura/scrittura alle directory dei dati locali. Accesso alla rete solo per l'attestazione blockchain. Consultare [THREAT_MODEL.md](THREAT_MODEL.md) per l'analisi STRIDE completa.

## Valutazione

| Controllo | Stato |
|------|--------|
| A. Baseline di sicurezza | PASSATO |
| B. Gestione degli errori | PASSATO |
| C. Documentazione per gli operatori | PASSATO |
| D. Igiene di rilascio | PASSATO |
| E. Identità | PASSATO |

## Licenza

[MIT](LICENSE)

---

Creato da <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
