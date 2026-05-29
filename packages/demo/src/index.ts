#!/usr/bin/env node
/**
 * @attestia/demo — Interactive CLI walkthrough (entry point).
 *
 * Thin bootstrap: parses flags, prints --help instantly, and dynamically
 * imports the heavy pipeline so a missing `dist/` build (or a missing workspace
 * dependency) surfaces as a branded hint instead of a raw Node stack trace.
 *
 * Runs the full Attestia pipeline in your terminal:
 * declare intent -> approve -> execute -> ledger -> verify ->
 * reconcile -> attest -> state-hash -> merkle-tree -> proof -> verify-proof
 */

import chalk from "chalk";

const argv = process.argv.slice(2);
const WANT_HELP = argv.includes("--help") || argv.includes("-h");
const FAST = argv.includes("--fast") || argv.includes("--no-delay");
const VERBOSE = argv.includes("--verbose") || Boolean(process.env.DEBUG);

function printHelp(): void {
  console.log();
  console.log(chalk.cyan.bold("  attestia-demo") + chalk.gray(" — interactive walk-through of the Attestia pipeline"));
  console.log();
  console.log(chalk.white("  Runs every stage for real (matching, hashing, attestation, proof)"));
  console.log(chalk.white("  end to end: one payroll payment becomes an independently"));
  console.log(chalk.white("  verifiable cryptographic proof."));
  console.log();
  console.log(chalk.white.bold("  Usage:"));
  console.log(chalk.gray("    attestia-demo [flags]"));
  console.log();
  console.log(chalk.white.bold("  Flags:"));
  console.log(chalk.gray("    --fast, --no-delay   Run instantly (skip the ~600ms step pacing)"));
  console.log(chalk.gray("    --verbose            Print full stack traces on failure (or set DEBUG)"));
  console.log(chalk.gray("    --help, -h           Show this help and exit"));
  console.log();
  console.log(chalk.gray("  Colour respects NO_COLOR and non-TTY output (auto-detected)."));
  console.log();
}

function reportFailure(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error();
  console.error(chalk.red.bold("  ✗ Demo failed: ") + chalk.red(message));

  // Most common first-run trip: dist not built, or a workspace dep not built.
  const code = err instanceof Error && "code" in err ? String((err as { code?: unknown }).code) : "";
  const looksLikeMissingModule =
    code === "ERR_MODULE_NOT_FOUND" ||
    code === "MODULE_NOT_FOUND" ||
    /Cannot find (module|package)|ERR_MODULE_NOT_FOUND|[\\/]dist[\\/]/.test(message);
  if (looksLikeMissingModule) {
    console.error(chalk.yellow("    Hint: did you run `pnpm build` first? The demo imports compiled dist output."));
  }

  if (VERBOSE) {
    console.error();
    console.error(chalk.gray(err instanceof Error && err.stack ? err.stack : String(err)));
  } else {
    console.error(chalk.dim("    Re-run with --verbose (or DEBUG=1) for the full stack trace."));
  }
  console.error();
  process.exit(1);
}

async function main(): Promise<void> {
  if (WANT_HELP) {
    printHelp();
    return;
  }
  // Dynamic import so a missing build fails inside this try/catch (a static
  // import would throw at module-load time, before any branded handling).
  const { run } = await import("./pipeline.js");
  await run({ fast: FAST });
}

main().catch(reportFailure);
