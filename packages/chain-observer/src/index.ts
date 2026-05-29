/**
 * @attestia/chain-observer — Multi-chain read-only observation layer.
 *
 * This package provides a unified interface for observing blockchain state
 * across multiple chains (EVM, XRPL, and future additions).
 *
 * Design rules:
 * - READ-ONLY: No signing, no submission, no execution
 * - Chain-agnostic interface, chain-specific implementations
 * - All observations are immutable once captured
 * - Observation timestamps are always recorded
 * - Errors are surfaced, never swallowed
 */

// Core observer interface
export type {
  ChainObserver,
  ObserverConfig,
  BalanceQuery,
  BalanceResult,
  TransferQuery,
  TransferEvent,
  TokenBalanceQuery,
  TokenBalance,
  ConnectionStatus,
} from "./observer.js";

// Observer registry
export {
  ObserverRegistry,
} from "./registry.js";

// Structured errors
export { ObserverError, classifyRpcError, toObserverError } from "./errors.js";
export type { ObserverErrorCode } from "./errors.js";

// Chain definitions
export {
  CHAINS,
  getChainRef,
  isEvmChain,
  isXrplChain,
  isSolanaChain,
} from "./chains.js";

// Finality configuration
export type { FinalityConfig, ChainProfile } from "./finality.js";

// Chain profiles
export {
  ETHEREUM_PROFILE,
  ETHEREUM_SEPOLIA_PROFILE,
  ARBITRUM_PROFILE,
  OPTIMISM_PROFILE,
  BASE_PROFILE,
  POLYGON_PROFILE,
  SOLANA_MAINNET_PROFILE,
  SOLANA_DEVNET_PROFILE,
  XRPL_MAINNET_PROFILE,
  XRPL_TESTNET_PROFILE,
  CHAIN_PROFILES,
  getChainProfile,
} from "./profiles.js";

// Chain-specific observers
export { EvmObserver } from "./evm/index.js";
export { XrplObserver } from "./xrpl/index.js";
export { SolanaObserver, DEFAULT_SOLANA_RPC_CONFIG } from "./solana/index.js";
export type { SolanaRpcConfig } from "./solana/index.js";

// XRPL EVM Sidechain adapter
export { XrplEvmAdapter, normalizeBridgeEvent, isBridgeContract, bridgeEventKey } from "./xrpl-evm/index.js";
export type { BridgeEvent, BridgeStatus } from "./xrpl-evm/index.js";

// Re-export chain types from @attestia/types for convenience
export type {
  ChainId,
  ChainRef,
  TxHash,
  BlockRef,
  TokenRef,
  OnChainEvent,
} from "@attestia/types";
