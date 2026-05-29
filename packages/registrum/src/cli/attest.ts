#!/usr/bin/env node
/**
 * Attestation CLI
 *
 * Generate attestation payloads from snapshots.
 * No network calls, no signing, no submission.
 *
 * Think: `git hash-object`, not `git push`.
 *
 * IMPORTANT — `--parity` is an UNVERIFIED human assertion.
 * This is an OFFLINE tool that operates on a SERIALIZED snapshot. A snapshot
 * does not retain the runtime dual-witness comparison, so this CLI cannot
 * verify whether the two witnesses actually agreed — it simply records the
 * `--parity` value the caller supplied. The resulting payload therefore
 * attests "the operator CLAIMS parity was AGREED/HALTED", not "the comparator
 * observed it." Use this for diagnostics, replay, and offline tooling only.
 *
 * For LIVE / on-ledger attestations, derive parity from the registrar itself
 * via `generateAttestationFromRegistrar(registrar, ...)`: it reads the ACTUAL
 * comparison result from `getLastParityStatus()` and fails closed if no
 * dual-witness comparison has run. That is the trustworthy path.
 *
 * Usage:
 *   npx ts-node src/cli/attest.ts \
 *     --snapshot ./snapshots/snapshot.json \
 *     --registry-hash <hex> \
 *     --mode dual \
 *     --parity AGREED \
 *     --from 0 \
 *     --to 100 \
 *     [--out attestation.json] \
 *     [--xrpl-memos]
 *
 * @module cli/attest
 */

import { readFileSync, writeFileSync } from "fs";
import { parseArgs } from "util";
import { validateSnapshot } from "../persistence/snapshot.js";
import type { RegistrarSnapshotV1 } from "../persistence/snapshot.js";
import {
  generateAttestationPayload,
  serializeAttestationPayload,
  encodeAsXrplMemos,
  REGISTRUM_VERSION,
} from "../attestation/index.js";
import type { AttestationMode, ParityStatus } from "../attestation/index.js";

const HELP = `
Registrum Attestation Payload Generator

Generate cryptographic attestation payloads from snapshots.
No network calls, no signing, no submission.

USAGE:
  npx ts-node src/cli/attest.ts [OPTIONS]

OPTIONS:
  --snapshot <path>       Path to snapshot JSON file (required)
  --registry-hash <hex>   Registry content hash, 64 hex chars (required)
  --mode <mode>           Attestation mode: dual, legacy-only, registry-only (required)
  --parity <status>       Parity status: AGREED or HALTED (required).
                          UNVERIFIED human assertion — see NOTE below.
  --from <n>              First transition index (required)
  --to <n>                Last transition index (required)
  --out <path>            Output file path (default: stdout)
  --xrpl-memos            Output XRPL memo encoding instead of JSON
  --help                  Show this help message

NOTE — --parity is an UNVERIFIED human assertion:
  This is an OFFLINE tool that reads a SERIALIZED snapshot, which does not
  retain the runtime dual-witness comparison. It therefore CANNOT confirm that
  the two witnesses agreed; it records the --parity value you supply verbatim.
  The payload attests what the OPERATOR CLAIMS, not what the comparator
  observed. Use it for diagnostics, replay, and offline tooling only.

  For LIVE / on-ledger attestations, do NOT hand-assert parity here. Derive it
  from the registrar with generateAttestationFromRegistrar(registrar, ...),
  which reads the ACTUAL result of getLastParityStatus() and fails closed if no
  dual-witness comparison has run.

EXAMPLES:
  # Generate attestation payload to stdout
  npx ts-node src/cli/attest.ts \\
    --snapshot ./snapshot.json \\
    --registry-hash abc123... \\
    --mode dual \\
    --parity AGREED \\
    --from 0 --to 100

  # Generate and save to file
  npx ts-node src/cli/attest.ts \\
    --snapshot ./snapshot.json \\
    --registry-hash abc123... \\
    --mode dual \\
    --parity AGREED \\
    --from 0 --to 100 \\
    --out attestation.json

  # Generate XRPL memo encoding
  npx ts-node src/cli/attest.ts \\
    --snapshot ./snapshot.json \\
    --registry-hash abc123... \\
    --mode dual \\
    --parity AGREED \\
    --from 0 --to 100 \\
    --xrpl-memos
`;

interface CliArgs {
  snapshot?: string;
  "registry-hash"?: string;
  mode?: string;
  parity?: string;
  from?: string;
  to?: string;
  out?: string;
  "xrpl-memos"?: boolean;
  help?: boolean;
}

function main(): void {
  const { values } = parseArgs({
    options: {
      snapshot: { type: "string" },
      "registry-hash": { type: "string" },
      mode: { type: "string" },
      parity: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      out: { type: "string" },
      "xrpl-memos": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });

  const args = values as CliArgs;

  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }

  // Validate required arguments
  const missing: string[] = [];
  if (!args.snapshot) missing.push("--snapshot");
  if (!args["registry-hash"]) missing.push("--registry-hash");
  if (!args.mode) missing.push("--mode");
  if (!args.parity) missing.push("--parity");
  if (!args.from) missing.push("--from");
  if (!args.to) missing.push("--to");

  if (missing.length > 0) {
    console.error(`Error: Missing required arguments: ${missing.join(", ")}`);
    console.error("Use --help for usage information.");
    process.exit(1);
  }

  // Validate mode
  const validModes: AttestationMode[] = ["dual", "legacy-only", "registry-only"];
  if (!validModes.includes(args.mode as AttestationMode)) {
    console.error(
      `Error: Invalid mode "${args.mode}". Must be one of: ${validModes.join(", ")}`
    );
    process.exit(1);
  }

  // Validate parity
  const validParity: ParityStatus[] = ["AGREED", "HALTED"];
  if (!validParity.includes(args.parity as ParityStatus)) {
    console.error(
      `Error: Invalid parity "${args.parity}". Must be one of: ${validParity.join(", ")}`
    );
    process.exit(1);
  }

  // Validate registry hash format
  const hashRegex = /^[0-9a-fA-F]{64}$/;
  if (!hashRegex.test(args["registry-hash"]!)) {
    console.error(
      "Error: Invalid registry-hash format. Must be 64 hexadecimal characters."
    );
    process.exit(1);
  }

  // Parse transition indices
  const transitionFrom = parseInt(args.from!, 10);
  const transitionTo = parseInt(args.to!, 10);

  if (isNaN(transitionFrom) || transitionFrom < 0) {
    console.error("Error: --from must be a non-negative integer.");
    process.exit(1);
  }
  if (isNaN(transitionTo) || transitionTo < 0) {
    console.error("Error: --to must be a non-negative integer.");
    process.exit(1);
  }
  if (transitionTo < transitionFrom) {
    console.error("Error: --to must be >= --from.");
    process.exit(1);
  }

  // Load and validate snapshot
  let snapshotRaw: unknown;
  try {
    const content = readFileSync(args.snapshot!, "utf8");
    snapshotRaw = JSON.parse(content);
  } catch (err) {
    console.error(`Error: Failed to read snapshot file: ${(err as Error).message}`);
    process.exit(1);
  }

  try {
    validateSnapshot(snapshotRaw);
  } catch (err) {
    console.error(`Error: Invalid snapshot: ${(err as Error).message}`);
    process.exit(1);
  }

  const snapshot = snapshotRaw as RegistrarSnapshotV1;

  // Generate attestation payload
  const payload = generateAttestationPayload(
    snapshot,
    args["registry-hash"]!.toLowerCase(),
    {
      registrumVersion: REGISTRUM_VERSION,
      mode: args.mode as AttestationMode,
      parityStatus: args.parity as ParityStatus,
      transitionFrom,
      transitionTo,
    }
  );

  // Format output
  let output: string;
  if (args["xrpl-memos"]) {
    const memos = encodeAsXrplMemos(payload);
    output = JSON.stringify(memos, null, 2);
  } else {
    output = serializeAttestationPayload(payload);
  }

  // Write output
  if (args.out) {
    try {
      writeFileSync(args.out, output, "utf8");
      console.error(`Attestation payload written to: ${args.out}`);
    } catch (err) {
      console.error(`Error: Failed to write output: ${(err as Error).message}`);
      process.exit(1);
    }
  } else {
    console.log(output);
  }
}

main();
