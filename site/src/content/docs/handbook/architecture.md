---
title: Architecture
description: The three-tier architecture of Attestia — Personal Vault, Org Treasury, and Registrum — and the core Intent-Approve-Execute-Verify pattern.
sidebar:
  order: 2
---

Attestia is built as three systems that share one truth. Each system has a distinct role, but they converge through cross-system reconciliation and XRPL attestation.

## Three systems, one truth

```
┌─────────────────────────────────────────────────────────┐
│                       ATTESTIA                          │
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
│              │ Reconciliation│                          │
│              └───────┬───────┘                          │
│                      │                                  │
│              ┌───────┴───────┐                          │
│              │ XRPL Witness  │                          │
│              │  (attestation)│                          │
│              └───────────────┘                          │
└─────────────────────────────────────────────────────────┘
```

### Personal Vault

**Role:** Multi-chain portfolio observation, envelope budgeting, and intent declaration.

The Personal Vault is the individual's view into their financial world. It reads balances and transactions across multiple chains (Ethereum, XRPL, Solana, L2s) without ever taking custody. Users declare intents here — what they want to happen — which then flow into the approval pipeline.

The Vault evolved from the NextLedger project and carries its read-only, observation-first philosophy: watch everything, control nothing.

### Org Treasury

**Role:** Deterministic payroll, DAO distributions, dual-gate funding, and double-entry ledger.

The Org Treasury handles organizational money flows. Payroll runs are deterministic and replayable. DAO distributions follow structural rules, not votes. Every transaction is recorded in a proper double-entry ledger with full auditability.

The Treasury evolved from the Payroll Engine project. It enforces dual-gate funding: both a structural gate (does this conform to rules?) and a human gate (did someone approve this?).

### Registrum

**Role:** Structural registrar — 11 invariants, dual-witness validation, XRPL attestation.

Registrum is the constitutional layer. It defines the invariants that hold unconditionally: identity must be explicit, lineage must be unbroken, ordering must be deterministic. It validates every operation against these 11 structural invariants before anything can proceed.

Registrum is the only system that writes to the XRPL. It is the final witness.

## The core pattern

Every interaction in Attestia follows one flow, regardless of which system initiates it:

```
Intent  →  Approve  →  Execute  →  Verify
```

| Step | What happens | Who acts |
|------|-------------|----------|
| **Intent** | A user or system declares a desired outcome | Human or system |
| **Approve** | Registrum validates structurally; a human signs explicitly | Registrum + human |
| **Execute** | The on-chain transaction is submitted | System (after approval) |
| **Verify** | Reconciliation confirms; XRPL attests the record | Reconciler + Witness |

No step is optional. No step is automated away. The gap between intent and execution is where trust lives.

## Cross-system reconciliation

The reconciler (`@attestia/reconciler`) performs 3D matching across all three systems. When the Vault says a balance changed, the Treasury says a payment went out, and Registrum says the invariants held — the reconciler confirms they all agree. If they disagree, the system halts. It never heals silently.

## XRPL witness layer

The witness module (`@attestia/witness`) is responsible for writing attestation records to the XRP Ledger. XRPL serves as the final witness — an immutable, external proof that a financial event occurred and was structurally valid. The witness supports multi-sig governance, retry logic, and batch submissions.

Chains are witnesses, not authorities. XRPL attests. But authority flows from structural rules, not from any chain's consensus.

## Supporting infrastructure

### Event store

The event store (`@attestia/event-store`) is the persistence backbone. Every operation across all three systems is recorded as an append-only, hash-chained JSONL entry. There are 32 domain event types covering vault intents, ledger transactions, treasury operations, governance changes, observer events, reconciliation outcomes, and witness submissions. Each event references the hash of its predecessor, making the chain tamper-evident and independently verifiable.

The JSONL store survives a crash mid-write. Each append is written and `fsync`ed before it returns. If a writer is
killed partway through, it can leave a torn last line with no trailing newline. On reopen, the store skips that line,
reports it in `loadDiagnostics`, and verifies the chain up to the last complete event. Since 2.1.2, the first append
after such a load writes a lone newline first, so the new event starts on its own line and links to the last complete
event. The file is never truncated or rewritten, so the torn fragment stays on disk and is skipped again on every
load. Damage anywhere else is refused: a broken line in the middle of the log, an edited event or a missing head makes
the store refuse to open with `INTEGRITY_VIOLATION`.

### Proof packaging

The proof module (`@attestia/proof`) builds Merkle trees over attestation records and packages inclusion proofs. When an external party needs to verify that a specific event was attested, the proof package provides the Merkle root, the leaf data, and the sibling hashes needed for independent verification without replaying the entire event log.

### Replay verification

The verify module (`@attestia/verify`) replays event sequences and confirms that the resulting state matches expectations. This is the foundation of Attestia's auditability: an auditor does not need to trust the system. They feed the same events into the verify module and check that the output matches. The module also handles compliance evidence generation and SLA enforcement.
