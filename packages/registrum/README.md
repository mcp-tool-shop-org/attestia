<p align="center"><img src="https://raw.githubusercontent.com/mcp-tool-shop-org/Attestia/main/assets/logo.png" alt="Attestia" width="200"></p>

# @attestia/registrum

> Part of [Attestia](https://github.com/mcp-tool-shop-org/Attestia) -- proves an event, a transaction, or a state transition happened. The domain it ships is financial truth.

**Constitutional governance layer. Dual-witness structural registrar with 11 invariants, replayable history, and optional on-chain attestation.**

[![npm version](https://img.shields.io/npm/v/@attestia/registrum)](https://www.npmjs.com/package/@attestia/registrum)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

---

## At a Glance

- Structural registrar that validates all state transitions against 11 invariants
- Dual constitutional witnesses: compiled DSL (RPEG v1) + TypeScript predicates
- Three invariant classes: Identity (3), Lineage (4), Ordering (4)
- Deterministic and replayable -- same inputs always produce same outputs
- Fail-closed: invalid transitions cause hard rejection, never partial recovery
- Versioned snapshots with content-addressed hashes for auditability
- Optional cryptographic attestation to an external immutable ledger
- 297 tests with parity evidence across both witness engines

## Installation

```bash
npm install @attestia/registrum
```

## Usage

### Register a root state

```typescript
import { StructuralRegistrar } from "@attestia/registrum";

const registrar = new StructuralRegistrar();

const result = registrar.register({
  from: null,
  to: { id: "state-1", structure: { version: 1 }, data: {} },
});

if (result.kind === "accepted") {
  console.log(`Registered at index ${result.orderIndex}`);
} else {
  console.log(`Rejected: ${result.violations.map((v) => v.invariantId)}`);
}
```

### Register a state transition

```typescript
const child = registrar.register({
  from: "state-1",
  to: { id: "state-1", structure: { version: 2 }, data: { updated: true } },
});
```

### Inspect invariants

```typescript
import { INITIAL_INVARIANTS, getInvariantsByScope } from "@attestia/registrum";

// All 11 invariants
console.log(INITIAL_INVARIANTS.map((i) => i.id));

// Only identity invariants
const identity = getInvariantsByScope("state");
```

### Snapshot and replay

```typescript
import { StructuralRegistrar } from "@attestia/registrum";
import { serialize, rehydrate } from "@attestia/registrum/persistence";

// Snapshot
const snapshot = registrar.snapshot();
const json = serialize(snapshot);

// Replay
const restored = rehydrate(json);
```

## The 11 Invariants

| Class | ID | Description |
|-------|----|-------------|
| Identity | `state.identity.immutable` | Registered state identity cannot be altered |
| Identity | `state.identity.explicit` | Every state must declare a non-empty identity |
| Identity | `state.identity.unique` | No two states may share the same identity |
| Lineage | `state.lineage.explicit` | Every transition must declare its parent |
| Lineage | `state.lineage.parent_exists` | Parent state must be registered |
| Lineage | `state.lineage.single_parent` | Only one parent per transition |
| Lineage | `state.lineage.continuous` | Lineage chains must be unbroken |
| Ordering | `ordering.total` | All accepted transitions are totally ordered |
| Ordering | `ordering.deterministic` | Same inputs produce same ordering |
| Ordering | `ordering.monotonic` | Order indices increase monotonically |
| Ordering | `ordering.non_semantic` | Ordering never depends on state content |

## Dual-Witness Architecture

Registrum maintains two independent invariant engines that must agree:

| Witness | Role | Implementation |
|---------|------|----------------|
| Registry | Primary authority | Compiled DSL (RPEG v1) |
| Legacy | Secondary witness | TypeScript predicates |

Both must accept for a transition to be valid. Disagreement halts the system (fail-closed). This is a safety feature, not technical debt.

## API

### Core Exports

| Export | Description |
|--------|-------------|
| `StructuralRegistrar` | Main registrar class |
| `INITIAL_INVARIANTS` | All 11 invariants as executable predicates |
| `getInvariantsByScope(scope)` | Filter invariants by scope (state, transition, registration) |
| `getInvariantById(id)` | Look up a single invariant |
| `isState(value)` / `isTransition(value)` | Type guards |
| `REGISTRUM_VERSION` | Current version string |

### Sub-path Exports

| Path | Contents |
|------|----------|
| `@attestia/registrum/persistence` | Snapshot serialization, rehydration, replay |
| `@attestia/registrum/registry` | Registry-driven registrar, predicate DSL |
| `@attestia/registrum/attestation` | External attestation emitter and config |

### Key Types

| Type | Description |
|------|-------------|
| `State` | Immutable system state with structure + opaque data |
| `Transition` | Proposed change from one state to another |
| `RegistrationResult` | Discriminated union: `accepted` or `rejected` |
| `Invariant` | Structural rule with scope, predicate, and failure mode |
| `InvariantViolation` | Structured verdict naming what was refused and why |

## Design Principles

- Restraint over power
- Legibility over performance
- Constraints over heuristics
- Inspection over intervention
- Stopping over endless extension

## Ecosystem

| Package | Role |
|---------|------|
| `@attestia/types` | Shared domain types (zero deps) |
| `@attestia/ledger` | Double-entry accounting engine |
| `@attestia/chain-observer` | Multi-chain observation (EVM, XRPL, Solana) |
| `@attestia/vault` | Intent management and approval workflows |
| `@attestia/treasury` | Treasury operations |
| `@attestia/reconciler` | Cross-system reconciliation |
| `@attestia/witness` | Cryptographic witnessing |
| `@attestia/proof` | Proof generation and verification |
| `@attestia/verify` | Verification primitives |
| `@attestia/event-store` | Append-only event persistence |
| `@attestia/sdk` | Developer SDK |
| `@attestia/node` | Attestia node runtime |
| `@attestia/demo` | Interactive demonstration |

## Docs

| Document | Description |
|----------|-------------|
| [What Registrum Is](docs/WHAT_REGISTRUM_IS.md) | Identity definition |
| [Provable Guarantees](docs/PROVABLE_GUARANTEES.md) | Formal claims with evidence |
| [Failure Boundaries](docs/FAILURE_BOUNDARIES.md) | Hard failure conditions |
| [History and Replay](docs/HISTORY_AND_REPLAY.md) | Temporal guarantees |
| [Dual Witness Tutorial](docs/TUTORIAL_DUAL_WITNESS.md) | Understanding dual-witness architecture |
| [Governance Philosophy](docs/governance/PHILOSOPHY.md) | Why governance exists |
| [Canonical Serialization](docs/CANONICAL_SERIALIZATION.md) | Snapshot format (constitutional) |

## License

[MIT](../../LICENSE)
