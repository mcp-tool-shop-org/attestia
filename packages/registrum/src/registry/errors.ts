/**
 * Registrum Registry Errors
 *
 * Error classes for registry loading and validation.
 */

/**
 * Error thrown when the registry schema is invalid.
 *
 * `code` is a stable, machine-readable identifier from the registrum error
 * vocabulary (see {@link RegistrumErrorCode}). It is part of the public
 * contract: callers may switch on `code` and it will not change across patch
 * or minor releases.
 */
export class RegistryError extends Error {
  /** Stable error code: `"REGISTRY_INVALID"`. */
  readonly code = "REGISTRY_INVALID" as const;

  constructor(message: string) {
    super(message);
    this.name = "RegistryError";
  }
}

/**
 * Error thrown when an invariant definition is invalid.
 *
 * `code` is the stable identifier `"INVARIANT_DEF_INVALID"`.
 */
export class InvariantDefinitionError extends Error {
  /** Stable error code: `"INVARIANT_DEF_INVALID"`. */
  readonly code = "INVARIANT_DEF_INVALID" as const;
  readonly invariantId: string | undefined;

  constructor(message: string, invariantId?: string) {
    super(invariantId ? `[${invariantId}] ${message}` : message);
    this.name = "InvariantDefinitionError";
    this.invariantId = invariantId;
  }
}
