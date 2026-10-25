---
title: Principles
description: The six enforced principles that define Attestia — not aspirational goals, but invariants enforced in code.
sidebar:
  order: 3
---

These are not aspirational. They are enforced in code. Every package in Attestia implements these principles as hard constraints — violations cause the system to halt, not to degrade gracefully.

## The six principles

### 1. Append-only records

**Implementation:** No UPDATE, no DELETE — only new entries.

Every financial event in Attestia is immutable once recorded. The event store (`@attestia/event-store`) enforces append-only semantics at the storage layer. If a correction is needed, a new compensating entry is appended — the original record is never modified. This means the full history is always replayable and auditable. There are 34 defined event types, and every one follows this rule.

### 2. Fail-closed

**Implementation:** Disagreement halts the system, never heals silently.

When the reconciler detects a mismatch between what the Vault observed, what the Treasury recorded, and what Registrum approved, the system stops. It does not attempt automatic repair. It does not pick a "most likely correct" value. It halts and requires human intervention.

This is a deliberate design choice. Silent healing is the source of most financial system bugs. Attestia treats every disagreement as a potential integrity violation until proven otherwise.

### 3. Deterministic replay

**Implementation:** Same events produce the same state, always.

Given the same sequence of events, Attestia will produce the same state regardless of when or where you replay them. This is enforced through the hash-chained event store: each event references the hash of the previous event, creating a tamper-evident chain. The verify module (`@attestia/verify`) can replay any sequence and confirm the result matches the expected state.

This property makes Attestia auditable by design. An auditor does not need to trust the system — they can independently verify by replaying the event log.

### 4. Advisory AI only

**Implementation:** AI can analyze, warn, suggest — never approve, sign, or execute.

AI is a useful tool for pattern detection, anomaly flagging, and advisory analysis. But in Attestia, AI is never in the approval chain. It cannot sign transactions. It cannot authorize payments. It cannot override structural invariants.

This principle exists because financial systems require accountability. An AI suggestion is not an approval. A human must always be the one who says "yes, proceed."

### 5. Multi-chain observation

**Implementation:** Ethereum, XRPL, Solana, L2s — chain-agnostic read layer.

The chain observer (`@attestia/chain-observer`) reads from multiple blockchains without being coupled to any single one. It supports EVM chains (Ethereum, Polygon, Arbitrum, etc.), XRPL, Solana, and Layer 2 networks. The observation layer is strictly read-only — it never submits transactions through the observer.

This means Attestia can provide a unified financial view regardless of where assets live. The only chain that receives writes is XRPL, through the witness module, for attestation purposes.

### 6. Structural identity

**Implementation:** Explicit, immutable, unique — not biometric, but constitutional.

Identity in Attestia is structural, not personal. An entity is identified by its constitutional properties: its role in the system, its permissions, its lineage. These identifiers are explicit (never inferred), immutable (never changed after creation), and unique (no two entities share an identity).

This is enforced by Registrum's 11 invariants. Identity is one of the hardest problems in decentralized systems — Attestia solves it by making identity a structural fact, not a social agreement.

## Why these principles matter

Financial infrastructure fails in predictable ways: records get silently modified, systems heal mismatches without human awareness, AI makes decisions that no one authorized, and identity becomes a moving target.

Attestia's six principles are direct responses to these failure modes. Each one closes a specific class of bug that plagues traditional and decentralized financial systems alike. They are not ideals to aspire to — they are invariants that the code enforces on every operation.
