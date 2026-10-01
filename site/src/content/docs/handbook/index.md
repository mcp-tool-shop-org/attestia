---
title: Attestia Handbook
description: Attestia proves that an event, a transaction, or a state transition happened. The domain it ships is financial truth.
sidebar:
  order: 0
---

Welcome to the Attestia Handbook. This is the canonical reference for understanding what Attestia is, how it works, and how to build with it.

## What is Attestia?

Attestia proves that an event, a transaction, or a state transition happened, and binds that proof to a chain. The domain it ships is financial truth. Smart contracts execute. Blockchains record. But no one *attests*. For money, Attestia is structural governance, deterministic accounting, and human-approved intent across chains, organizations, and individuals.

Attestia does not move your money. It proves what happened, constrains what can happen, and makes the financial record unbreakable.

Cognate is the AI governance domain on this event store and these Merkle proofs. RepoMesh is the separate release ledger and XRPL trust clock. Cognate calls Attestia for a proof and RepoMesh to check a release.

## Handbook contents

This handbook is organized into five sections:

- **[Beginners](/Attestia/handbook/beginners/)** — New to Attestia? Start here for a plain-language walkthrough of what the project does, who it is for, core concepts, a hands-on tutorial, and answers to common questions.
- **[Getting Started](/Attestia/handbook/getting-started/)** — Install dependencies, run the test suite, and try XRPL integration testing with a local standalone rippled node.
- **[Architecture](/Attestia/handbook/architecture/)** — Understand the three-tier system (Personal Vault, Org Treasury, Registrum) and the core Intent-Approve-Execute-Verify flow.
- **[Principles](/Attestia/handbook/principles/)** — The six non-negotiable principles enforced in every line of Attestia code, and why they matter.
- **[Reference](/Attestia/handbook/reference/)** — Package status table for all 14 packages, documentation index, and security and data scope.

## At a glance

| Metric | Value |
|--------|-------|
| Packages | 14 |
| Tests | 2,564 |
| Coverage | 95%+ |
| License | MIT |
| Chain support | XRPL, Ethereum, Solana, L2s |

## Core flow

Every interaction in Attestia follows one pattern:

```
Intent  →  Approve  →  Execute  →  Verify
```

No step is optional. No step is automated away. This is the foundation everything else is built on.
