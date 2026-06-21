---
title: Attestia Handbook
description: Complete guide to Attestia — financial truth infrastructure for the decentralized world.
sidebar:
  order: 0
---

Welcome to the Attestia Handbook. This is the canonical reference for understanding what Attestia is, how it works, and how to build with it.

## What is Attestia?

Attestia is financial truth infrastructure for the decentralized world. Smart contracts execute. Blockchains record. But no one *attests*. Attestia is the missing layer: structural governance, deterministic accounting, and human-approved intent — unified across chains, organizations, and individuals.

Attestia does not move your money. It proves what happened, constrains what can happen, and makes the financial record unbreakable.

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
