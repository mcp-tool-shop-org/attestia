#!/usr/bin/env node

/**
 * attestia-status — Monorepo health summary.
 *
 * Reports package versions, dependency counts, and overall structure.
 * Useful for quick sanity checks before releases or audits.
 *
 * Defensive by design: a single missing or malformed package.json renders an
 * inline "(unreadable: …)" row instead of crashing the whole report. Exit codes
 * are explicit — 0 on success, 1 if the root package.json cannot be read, 2 if
 * one or more package manifests were unreadable.
 *
 * Colour: a tiny self-contained ANSI helper (no runtime dependency — this script
 * runs from the repo root where workspace packages aren't resolvable). Honours
 * NO_COLOR and non-TTY output, matching the demo's behaviour.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PACKAGES_DIR = join(ROOT, "packages");

// ── Minimal colour helper (NO_COLOR + non-TTY aware) ─────────────────────────
const USE_COLOR = !process.env.NO_COLOR && Boolean(process.stdout.isTTY);
const wrap = (open, close) => (s) => (USE_COLOR ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));
const c = {
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  red: wrap(31, 39),
  white: wrap(37, 39),
  bold: wrap(1, 22),
};
const cyanBold = (s) => c.cyan(c.bold(s));

/** Read + parse JSON. Throws with a concise reason (no raw stack) on failure. */
function readJson(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    const reason = err && err.code === "ENOENT" ? "file not found" : (err?.message ?? String(err));
    throw new Error(reason);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`invalid JSON — ${err?.message ?? String(err)}`);
  }
}

/** Green ✓ when ok, yellow ! otherwise. */
function marker(ok) {
  return ok ? c.green("✓") : c.yellow("!");
}

function main() {
  // ── Root manifest (fatal if unreadable — everything keys off it) ──────────
  let rootPkg;
  try {
    rootPkg = readJson(join(ROOT, "package.json"));
  } catch (err) {
    console.error(c.red("\n  ✗ Cannot read root package.json: ") + c.red(err.message));
    console.error(c.gray("    Run this from the Attestia repo root (or check the file is valid JSON).\n"));
    process.exit(1);
  }

  console.log();
  console.log(cyanBold("  Attestia Monorepo Status"));
  console.log(c.gray("  " + "─".repeat(40)));
  console.log(`  Root version:  ${c.white(rootPkg.version ?? "unspecified")}`);
  console.log(`  Node engine:   ${c.white(rootPkg.engines?.node ?? "unspecified")}`);
  console.log(`  Package mgr:   ${c.white(rootPkg.packageManager ?? "unspecified")}`);

  // ── Packages ──────────────────────────────────────────────────────────────
  let dirs = [];
  if (existsSync(PACKAGES_DIR)) {
    dirs = readdirSync(PACKAGES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  }

  console.log(`\n  ${c.bold(c.white(`Packages (${dirs.length}):`))}\n`);
  console.log(
    c.gray(
      `  ${"Name".padEnd(20)} ${"Version".padEnd(10)} ${"Deps".padStart(5)} ${"DevDeps".padStart(8)}  Tests`
    )
  );
  console.log(
    c.gray(
      `  ${"─".repeat(20)} ${"─".repeat(10)} ${"─".repeat(5)} ${"─".repeat(8)}  ${"─".repeat(6)}`
    )
  );

  let totalDeps = 0;
  let packagesWithTests = 0;
  let unreadable = 0;

  for (const dir of dirs) {
    const pkgPath = join(PACKAGES_DIR, dir, "package.json");
    if (!existsSync(pkgPath)) continue;

    let pkg;
    try {
      pkg = readJson(pkgPath);
    } catch (err) {
      // Render the broken package inline rather than crashing the whole report.
      unreadable++;
      console.log(`  ${c.yellow(dir.padEnd(20))} ${c.yellow(`(unreadable: ${err.message})`)}`);
      continue;
    }

    const deps = Object.keys(pkg.dependencies ?? {}).length;
    const devDeps = Object.keys(pkg.devDependencies ?? {}).length;
    totalDeps += deps;

    const hasTests = pkg.scripts?.test ? "yes" : "—";
    if (pkg.scripts?.test) packagesWithTests++;

    const name = pkg.name?.replace("@attestia/", "") ?? dir;
    console.log(
      `  ${c.white(name.padEnd(20))} ${c.white((pkg.version ?? "—").padEnd(10))} ${String(deps).padStart(5)} ${String(devDeps).padStart(8)}  ${hasTests}`
    );
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  const readableCount = dirs.length - unreadable;
  const allHaveTests = readableCount > 0 && packagesWithTests === readableCount;

  console.log(`\n  ${c.gray("─".repeat(40))}`);
  console.log(`  Total packages:     ${c.white(String(dirs.length))}`);
  console.log(`  ${marker(allHaveTests)} With tests:        ${c.white(`${packagesWithTests}/${readableCount}`)}`);
  console.log(`  Total runtime deps: ${c.white(String(totalDeps))}`);
  if (unreadable > 0) {
    console.log(`  ${c.yellow("!")} Unreadable:        ${c.yellow(String(unreadable))}`);
  }

  // Security files
  const securityFiles = ["SECURITY.md", "THREAT_MODEL.md", "CONTROL_MATRIX.md", "LICENSE"];
  const present = securityFiles.filter((f) => existsSync(join(ROOT, f)));
  const allSecurityPresent = present.length === securityFiles.length;
  console.log(
    `  ${marker(allSecurityPresent)} Security files:    ${c.white(`${present.length}/${securityFiles.length}`)} present`
  );

  // ── Health verdict ────────────────────────────────────────────────────────
  console.log();
  if (unreadable > 0) {
    console.log(c.yellow(`  ! Health: ${unreadable} package manifest(s) unreadable — investigate before release.`));
  } else if (allHaveTests && allSecurityPresent) {
    console.log(c.green("  ✓ Health: all packages carry tests and security files are complete."));
  } else {
    const gaps = [];
    if (!allHaveTests) gaps.push(`${readableCount - packagesWithTests} package(s) without tests`);
    if (!allSecurityPresent) gaps.push(`${securityFiles.length - present.length} security file(s) missing`);
    console.log(c.yellow(`  ! Health: ${gaps.join("; ")}.`));
  }
  console.log();

  // Explicit, non-zero on unreadable manifests so CI/scripts can detect drift.
  if (unreadable > 0) process.exit(2);
  process.exit(0);
}

main();
