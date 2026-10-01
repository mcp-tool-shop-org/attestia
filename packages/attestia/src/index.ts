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
export * as types from "../../types/src/index";
export * as ledger from "../../ledger/src/index";
export * as registrum from "../../registrum/src/index";
export * as eventStore from "../../event-store/src/index";
export * as proof from "../../proof/src/index";
export * as vault from "../../vault/src/index";
export * as treasury from "../../treasury/src/index";
export * as reconciler from "../../reconciler/src/index";
export * as chainObserver from "../../chain-observer/src/index";
export * as witness from "../../witness/src/index";
export * as verify from "../../verify/src/index";
export * as sdk from "../../sdk/src/index";
