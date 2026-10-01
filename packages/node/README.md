<p align="center"><img src="https://raw.githubusercontent.com/mcp-tool-shop-org/Attestia/main/assets/logo.png" alt="Attestia" width="200"></p>

# @attestia/node

> Part of [Attestia](https://github.com/mcp-tool-shop-org/Attestia) — proves an event, a transaction, or a state transition happened. The domain it ships is financial truth.

**Production-ready HTTP service built on Hono with authentication, multi-tenancy, rate limiting, and 30+ API endpoints.**

[![npm version](https://img.shields.io/npm/v/@attestia/node)](https://www.npmjs.com/package/@attestia/node)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

---

## At a Glance

- **Hono-based HTTP server** with `createApp()` factory for testability
- **30+ endpoints** across intents, events, verification, proofs, compliance, attestation, and export
- **Authentication**: API key (`X-Api-Key`) and JWT with role-based permissions (admin, operator, viewer)
- **Multi-tenancy**: isolated `AttestiaService` instances per tenant via `TenantRegistry`
- **Rate limiting**: token bucket algorithm with configurable RPM and burst
- **Idempotency**: automatic deduplication for POST requests via `Idempotency-Key` header
- **Prometheus metrics** endpoint for monitoring (request count, latency, error rates)
- **Public endpoints** for third-party verification, proof checking, and compliance reports
- Structured logging via Pino, request ID tracking, ETag support, CORS
- Zod-validated configuration from environment variables
- Graceful shutdown on SIGTERM/SIGINT
- 184 tests

## Installation

```bash
npm install @attestia/node
```

## Usage

### Quick Start

```typescript
import { createApp } from "@attestia/node";

const { app } = createApp({
  serviceConfig: {
    ownerId: "my-org",
    defaultCurrency: "USDC",
    defaultDecimals: 6,
  },
});

// Use with @hono/node-server, Bun, Deno, or any Hono-compatible runtime
```

### With Authentication and Rate Limiting

```typescript
import { createApp, parseApiKeys } from "@attestia/node";

const keys = parseApiKeys("sk-live-abc:admin:tenant-1,sk-live-def:viewer:tenant-2");

const { app } = createApp({
  serviceConfig: {
    ownerId: "default",
    defaultCurrency: "USDC",
    defaultDecimals: 6,
  },
  auth: {
    apiKeys: new Map(keys.map((k) => [k.key, k])),
    jwtSecret: process.env.JWT_SECRET,
  },
  rateLimit: { rpm: 100, burst: 20 },
});
```

### Environment Configuration

All configuration is loaded from environment variables via Zod validation:

```bash
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=info
NODE_ENV=production

# Auth
API_KEYS=sk-live-abc:admin:tenant-1,sk-live-def:operator:tenant-2
JWT_SECRET=your-secret
JWT_ISSUER=attestia

# Rate limiting
RATE_LIMIT_RPM=100
RATE_LIMIT_BURST=20

# Domain
DEFAULT_CURRENCY=USDC
DEFAULT_DECIMALS=6
```

### Programmatic Usage (Testing)

```typescript
import { createApp } from "@attestia/node";

const { app, tenantRegistry, metricsCollector } = createApp({
  serviceConfig: { ownerId: "test", defaultCurrency: "USDC", defaultDecimals: 6 },
});

// Direct request for testing (no HTTP server needed)
const res = await app.request("/api/v1/intents", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    id: "test-001",
    kind: "transfer",
    description: "Test intent",
    params: {},
  }),
});
```

## API Endpoints

### Authenticated (`/api/v1/`)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/intents` | Declare a new intent |
| `GET` | `/api/v1/intents` | List intents (paginated) |
| `GET` | `/api/v1/intents/:id` | Get intent by ID |
| `POST` | `/api/v1/intents/:id/approve` | Approve an intent |
| `POST` | `/api/v1/intents/:id/reject` | Reject an intent |
| `POST` | `/api/v1/intents/:id/execute` | Mark intent as executed |
| `POST` | `/api/v1/intents/:id/verify` | Verify an intent |
| `GET` | `/api/v1/events` | List all events |
| `GET` | `/api/v1/verify/hash` | Get current GlobalStateHash |
| `POST` | `/api/v1/verify/replay` | Full replay verification |
| `GET` | `/api/v1/proofs/merkle-root` | Get current Merkle root |
| `GET` | `/api/v1/proofs/attestation/:id` | Get attestation proof package |
| `GET` | `/api/v1/compliance/soc2` | SOC 2 compliance report |
| `GET` | `/api/v1/export/bundle` | Export state bundle |

### Public (No Auth)

| Method | Path | Description |
|---|---|---|
| `POST` | `/public/v1/verify/bundle` | Verify a state bundle |
| `POST` | `/public/v1/proofs/verify` | Verify an attestation proof |
| `GET` | `/public/v1/compliance/frameworks` | List available frameworks |
| `GET` | `/health` | Health check |
| `GET` | `/metrics` | Prometheus metrics |

## Key Exports

| Export | Description |
|---|---|
| `createApp()` | Application factory returning `AppInstance` |
| `AttestiaService` | Core service orchestrating all subsystems |
| `TenantRegistry` | Multi-tenant service registry |
| `loadConfig()` | Load and validate env config via Zod |
| `ConfigSchema` | Zod schema for environment variables |
| `parseApiKeys()` | Parse `key:role:tenant` formatted API key string |

## Ecosystem

This package is part of the Attestia monorepo with 13 sister packages:

`@attestia/types` | `@attestia/ledger` | `@attestia/registrum` | `@attestia/vault` | `@attestia/treasury` | `@attestia/event-store` | `@attestia/verify` | `@attestia/proof` | `@attestia/reconciler` | `@attestia/chain-observer` | `@attestia/witness` | `@attestia/sdk` | `@attestia/demo`

## Docs

| Document | Description |
|---|---|
| [Architecture](../../docs/architecture.md) | System architecture overview |
| [API Reference](../../docs/api.md) | Full API documentation |
| [Deployment Guide](../../docs/deployment.md) | Production deployment guide |

## License

[MIT](../../LICENSE)
