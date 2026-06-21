/**
 * @mcptoolshop/attestia — the full Attestia library, one package.
 *
 * The root entry exposes every domain as a NAMESPACE (no symbol collisions):
 *
 *   import { ledger, proof, registrum } from "@mcptoolshop/attestia";
 *   const m = ledger.addMoney(a, b);
 *
 * For flat/deep imports, use the subpath exports instead:
 *
 *   import { MerkleTree } from "@mcptoolshop/attestia/proof";
 *   import { StructuralRegistrar } from "@mcptoolshop/attestia/registrum";
 */
export * as types from "@attestia/types";
export * as ledger from "@attestia/ledger";
export * as registrum from "@attestia/registrum";
export * as eventStore from "@attestia/event-store";
export * as proof from "@attestia/proof";
export * as vault from "@attestia/vault";
export * as treasury from "@attestia/treasury";
export * as reconciler from "@attestia/reconciler";
export * as chainObserver from "@attestia/chain-observer";
export * as witness from "@attestia/witness";
export * as verify from "@attestia/verify";
export * as sdk from "@attestia/sdk";
