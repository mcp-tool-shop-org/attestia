---
title: Beginners
description: New to Attestia? A plain-language introduction to what it does, who it is for, core concepts, a hands-on tutorial, and answers to common questions.
sidebar:
  order: 99
---

This page is for anyone encountering Attestia for the first time. It explains what the project does in plain language, walks through the core ideas, and ends with a hands-on tutorial you can run in your terminal.

## 1. What is Attestia and why does it exist?

Attestia is a TypeScript monorepo that provides financial truth infrastructure for decentralized systems. It sits between the applications that move money and the blockchains that record transactions, adding a layer of structural governance, deterministic accounting, and human-approved intent.

Most blockchain tooling focuses on executing transactions. Attestia focuses on the question that comes after: *can you prove what happened, and can you prove it was authorized?*

The project exists because financial systems — both traditional and decentralized — share a common failure mode: records get silently modified, mismatches are healed without human awareness, and automated systems make decisions nobody authorized. Attestia closes these gaps by enforcing strict invariants at every step.

## 2. Who is it for?

Attestia is designed for several audiences:

- **DAO operators** who need deterministic payroll, distributions, and dual-gate funding with a full audit trail.
- **DeFi builders** who need a governance and attestation layer underneath their protocols.
- **Compliance teams** who need replayable, provable financial records that an auditor can independently verify.
- **Individual users** who want a unified, read-only view of their multi-chain portfolio with envelope budgeting and intent-based allocation.
- **Developers** building financial applications who need an append-only ledger, cross-system reconciliation, or on-chain attestation.

If you are building anything that involves money moving across chains and you need to prove what happened, Attestia is the infrastructure layer you would otherwise have to build yourself.

## 3. Core concepts

These are the five ideas you need to understand before working with Attestia.

### Intent-Approve-Execute-Verify

Every operation follows four steps, in order, with no exceptions:

1. **Intent** — Someone declares what they want to happen.
2. **Approve** — The system validates structurally (does this conform to the rules?) and a human signs explicitly.
3. **Execute** — The transaction is submitted.
4. **Verify** — Reconciliation confirms the outcome matches the intent; the XRPL witnesses the result.

This pattern appears everywhere in Attestia. It is not optional and no step can be skipped.

### Three systems, one truth

Attestia has three subsystems that share a single source of truth:

- **Personal Vault** reads balances across multiple chains and lets individuals declare intents and manage budgets. It never takes custody of funds.
- **Org Treasury** handles organizational payments: payroll, distributions, and dual-gate funding with a double-entry ledger.
- **Registrum** is the constitutional layer. It enforces 11 structural invariants and validates every operation before it can proceed. It is the only system that writes attestation records to the XRPL.

### Append-only records

Nothing is ever updated or deleted. If a correction is needed, a new compensating entry is appended. The event store tracks 32 domain event types, and every one is immutable once recorded. This makes the full history replayable at any time.

### Fail-closed

When the system detects a disagreement between what different subsystems report, it halts. It does not attempt automatic repair. This is deliberate — silent healing is the source of most financial system bugs.

### Structural identity

Identity in Attestia is structural, not personal. An entity is identified by its role, permissions, and lineage within the system. These identifiers are explicit, immutable, and unique. This is enforced by Registrum's 11 invariants.

## 4. How it works (step by step)

Here is what happens when a user wants to make a payment through Attestia:

1. The user opens their **Personal Vault** and declares an intent: "Pay 100 XRP to address rN...".
2. The intent is recorded as an append-only event in the **event store**.
3. **Registrum** checks the intent against its 11 structural invariants. Does the identity exist? Is the lineage valid? Is the ordering deterministic?
4. A human reviews and explicitly approves the intent. AI may have flagged anomalies, but the human is always the one who says yes.
5. The approved intent flows to **Org Treasury** (if organizational) or stays in the Vault (if personal), and the on-chain transaction is submitted.
6. The **reconciler** performs 3D matching: does what the Vault observed match what the Treasury recorded match what Registrum approved?
7. If all three agree, the **witness** module writes an attestation record to the XRPL as an immutable, external proof.
8. The **verify** module can replay the entire sequence at any time and confirm the final state matches expectations.

If any step fails or any subsystem disagrees, the system halts and waits for human intervention.

## 5. Hands-on tutorial

Attestia includes an interactive CLI demo (`@attestia/demo`) that walks through the full pipeline in your terminal. No blockchain node required.

### Prerequisites

- Node.js 20 or later
- pnpm (the project uses pnpm workspaces)

### Steps

```bash
# Clone and install
git clone https://github.com/mcp-tool-shop-org/Attestia.git
cd Attestia
pnpm install

# Build all packages (the demo depends on several workspace packages)
pnpm build

# Run the interactive demo
pnpm demo
```

The demo runs the full Attestia pipeline locally: declare an intent, approve it, execute it, record it in the ledger, verify the result, reconcile across systems, compute a global state hash, build a Merkle tree, package an attestation proof, and verify that proof. Each step prints what is happening so you can follow the flow.

After running the demo, try the test suite to see the full scope of the project:

```bash
# Run all 2,220 tests
pnpm test

# Run with coverage reporting
pnpm test:coverage
```

## 6. Glossary

| Term | Definition |
|------|-----------|
| **Intent** | A declared desired outcome. Intents are recorded before any action is taken. |
| **Registrum** | The constitutional governance layer. Enforces 11 structural invariants on every operation. |
| **Invariant** | A structural rule that must hold unconditionally. Violations halt the system. |
| **Attestation** | An immutable proof that a financial event occurred and was structurally valid. Written to the XRPL. |
| **Reconciliation** | 3D matching across the Vault, Treasury, and Registrum to confirm all three systems agree. |
| **Witness** | The module that writes attestation records to the XRPL. Supports multi-sig governance and retry logic. |
| **Event store** | Append-only persistence layer. Stores 32 domain event types as hash-chained JSONL entries. |
| **Vault** | The Personal Vault. Reads multi-chain balances and manages individual budgets and intents. |
| **Treasury** | The Org Treasury. Handles payroll, distributions, and dual-gate funding with double-entry accounting. |
| **Dual-gate** | A funding pattern requiring both a structural gate (does it conform to rules?) and a human gate (did someone approve?). |
| **Fail-closed** | When a disagreement is detected, the system halts rather than attempting automatic repair. |
| **Deterministic replay** | Given the same events, the system produces the same state, always. Enables independent auditor verification. |
| **Global state hash** | A single hash representing the entire system state at a point in time. Used for replay verification. |
| **Merkle tree** | A hash tree used to package attestation proofs with efficient inclusion verification. |

## 7. Next steps

Once you have run the demo and understand the core flow, here is where to go next:

- **[Getting Started](/Attestia/handbook/getting-started/)** — Deeper setup instructions including XRPL integration testing with a local Docker-based rippled node.
- **[Architecture](/Attestia/handbook/architecture/)** — Detailed breakdown of the three-tier system, cross-system reconciliation, and the XRPL witness layer.
- **[Principles](/Attestia/handbook/principles/)** — The six non-negotiable principles enforced in code, with explanations of why each one matters.
- **[Reference](/Attestia/handbook/reference/)** — Full package table with test counts, documentation index, and security scope.
- **Source code** — The `packages/` directory contains 14 independently buildable packages. Start with `@attestia/types` for the shared domain types, then explore `@attestia/registrum` for the invariant system.
