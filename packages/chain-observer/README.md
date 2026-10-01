<p align="center"><img src="https://raw.githubusercontent.com/mcp-tool-shop-org/Attestia/main/assets/logo.png" alt="Attestia" width="200"></p>

# @attestia/chain-observer

> Part of [Attestia](https://github.com/mcp-tool-shop-org/Attestia) -- proves an event, a transaction, or a state transition happened. The domain it ships is financial truth.

**Multi-chain read-only observation layer. Unified interface for EVM, XRPL, Solana, and L2 chains. Observe balances, transfers, and finality -- never sign or submit.**

[![npm version](https://img.shields.io/npm/v/@attestia/chain-observer)](https://www.npmjs.com/package/@attestia/chain-observer)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

---

## At a Glance

- Strictly read-only: no signing, no transaction submission, no execution
- Unified `ChainObserver` interface across all supported chain families
- EVM support: Ethereum, Arbitrum, Optimism, Base, Polygon (via viem)
- XRPL support: Mainnet and Testnet (via xrpl.js)
- Solana support: Mainnet and Devnet with commitment-level finality (via @solana/web3.js)
- XRPL EVM Sidechain bridge event adapter for cross-chain observation
- `ObserverRegistry` for multi-chain queries with parallel execution
- Predefined `ChainProfile` configs encoding each chain's finality model
- Reorg detection for EVM chains with configurable confirmation depth

## Installation

```bash
npm install @attestia/chain-observer
```

## Usage

### Observe an EVM chain

```typescript
import { EvmObserver, CHAINS, ETHEREUM_PROFILE } from "@attestia/chain-observer";

const observer = new EvmObserver({
  chain: CHAINS.ETHEREUM_MAINNET,
  rpcUrl: "https://eth.llamarpc.com",
  profile: ETHEREUM_PROFILE,
});

await observer.connect();

const balance = await observer.getBalance({
  address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
});
console.log(`${balance.balance} ${balance.symbol} at block ${balance.atBlock}`);

const transfers = await observer.getTransfers({
  address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  direction: "incoming",
  limit: 10,
});

await observer.disconnect();
```

### Observe Solana

```typescript
import { SolanaObserver, CHAINS, SOLANA_MAINNET_PROFILE } from "@attestia/chain-observer";

const solana = new SolanaObserver({
  chain: CHAINS.SOLANA_MAINNET,
  rpcUrl: "https://api.mainnet-beta.solana.com",
  profile: SOLANA_MAINNET_PROFILE,
});

await solana.connect();

const balance = await solana.getBalance({
  address: "So11111111111111111111111111111111111111112",
  finality: "finalized",
});
```

### Multi-chain observation with the registry

```typescript
import {
  ObserverRegistry,
  EvmObserver,
  XrplObserver,
  CHAINS,
  ETHEREUM_PROFILE,
  XRPL_MAINNET_PROFILE,
} from "@attestia/chain-observer";

const registry = new ObserverRegistry();

registry.register(new EvmObserver({
  chain: CHAINS.ETHEREUM_MAINNET,
  rpcUrl: "https://eth.llamarpc.com",
  profile: ETHEREUM_PROFILE,
}));

registry.register(new XrplObserver({
  chain: CHAINS.XRPL_MAINNET,
  rpcUrl: "wss://xrplcluster.com",
  profile: XRPL_MAINNET_PROFILE,
}));

// Connect all observers in parallel
const status = await registry.connectAll();

// Query balance across all chains
const balances = await registry.getBalanceMultiChain({
  address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
});
```

### Chain identification helpers

```typescript
import { isEvmChain, isXrplChain, isSolanaChain, getChainRef } from "@attestia/chain-observer";

isEvmChain("eip155:1");        // true
isXrplChain("xrpl:main");      // true
isSolanaChain("solana:devnet"); // true

const chain = getChainRef("eip155:1");
// { chainId: "eip155:1", name: "Ethereum Mainnet", family: "evm" }
```

## API

### Observer Classes

| Class | Chain Family | Backend |
|-------|-------------|---------|
| `EvmObserver` | EVM (Ethereum, L2s) | viem |
| `XrplObserver` | XRP Ledger | xrpl.js |
| `SolanaObserver` | Solana | @solana/web3.js |
| `XrplEvmAdapter` | XRPL EVM Sidechain bridge | viem |

### ChainObserver Interface

| Method | Description |
|--------|-------------|
| `connect()` | Connect to the chain's RPC endpoint |
| `disconnect()` | Disconnect from the chain |
| `getStatus()` | Check connection, latest block, finality status |
| `getBalance(query)` | Get native token balance |
| `getTokenBalance(query)` | Get specific token balance (ERC-20, trust line, SPL) |
| `getTransfers(query)` | Get transfer events with direction/token/block filters |

### ObserverRegistry

| Method | Description |
|--------|-------------|
| `register(observer)` | Register an observer for a chain |
| `get(chainId)` | Get observer by chain ID |
| `connectAll()` | Connect all observers in parallel |
| `disconnectAll()` | Disconnect all observers |
| `getBalanceMultiChain(query)` | Query balance across multiple chains |
| `getStatusAll()` | Get status of all observers |

### Supported Chains

| Chain | ID | Profile |
|-------|----|---------|
| Ethereum Mainnet | `eip155:1` | `ETHEREUM_PROFILE` |
| Ethereum Sepolia | `eip155:11155111` | `ETHEREUM_SEPOLIA_PROFILE` |
| Arbitrum One | `eip155:42161` | `ARBITRUM_PROFILE` |
| OP Mainnet | `eip155:10` | `OPTIMISM_PROFILE` |
| Base Mainnet | `eip155:8453` | `BASE_PROFILE` |
| Polygon PoS | `eip155:137` | `POLYGON_PROFILE` |
| Solana Mainnet | `solana:mainnet-beta` | `SOLANA_MAINNET_PROFILE` |
| Solana Devnet | `solana:devnet` | `SOLANA_DEVNET_PROFILE` |
| XRPL Mainnet | `xrpl:main` | `XRPL_MAINNET_PROFILE` |
| XRPL Testnet | `xrpl:testnet` | `XRPL_TESTNET_PROFILE` |

### Sub-path Exports

| Path | Contents |
|------|----------|
| `@attestia/chain-observer/evm` | `EvmObserver`, L2 adapter, reorg detector |
| `@attestia/chain-observer/xrpl` | `XrplObserver` |
| `@attestia/chain-observer/solana` | `SolanaObserver`, RPC config |

## Ecosystem

| Package | Role |
|---------|------|
| `@attestia/types` | Shared domain types (zero deps) |
| `@attestia/ledger` | Double-entry accounting engine |
| `@attestia/registrum` | Constitutional governance layer |
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
| [Architecture](../../docs/ARCHITECTURE.md) | System architecture overview |
| [Intent Lifecycle](../../docs/INTENT_LIFECYCLE.md) | How intents flow through the system |
| [Contributing](../../CONTRIBUTING.md) | Contribution guidelines |

## License

[MIT](../../LICENSE)
