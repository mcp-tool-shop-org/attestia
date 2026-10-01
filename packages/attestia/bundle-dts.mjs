/**
 * Write self-contained .d.ts files for the published package.
 * Workspace @attestia/* packages stay private, so their types are bundled in.
 */
import { Extractor, ExtractorConfig } from "@microsoft/api-extractor";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const outDir = path.join(here, "dist");

const bundledPackages = [
  "@attestia/types",
  "@attestia/ledger",
  "@attestia/registrum",
  "@attestia/event-store",
  "@attestia/proof",
  "@attestia/vault",
  "@attestia/treasury",
  "@attestia/reconciler",
  "@attestia/chain-observer",
  "@attestia/witness",
  "@attestia/verify",
  "@attestia/sdk",
];

const entries = {
  types: "types",
  ledger: "ledger",
  registrum: "registrum",
  "event-store": "event-store",
  proof: "proof",
  vault: "vault",
  treasury: "treasury",
  reconciler: "reconciler",
  "chain-observer": "chain-observer",
  witness: "witness",
  verify: "verify",
  sdk: "sdk",
};

mkdirSync(outDir, { recursive: true });

function rollup(entryName, packageDir) {
  const mainEntryPointFilePath = path.join(repo, "packages", packageDir, "dist", "index.d.ts");
  const untrimmedFilePath = path.join(outDir, `${entryName}.d.ts`);
  const extractorConfig = ExtractorConfig.prepare({
    configObject: {
      mainEntryPointFilePath,
      bundledPackages,
      projectFolder: repo,
      compiler: {
        tsconfigFilePath: path.join(repo, "packages", packageDir, "tsconfig.json"),
      },
      dtsRollup: {
        enabled: true,
        untrimmedFilePath,
      },
      apiReport: { enabled: false, reportFileName: "unused.api.md" },
      docModel: { enabled: false },
      tsdocMetadata: { enabled: false },
      newlineKind: "lf",
    },
    configObjectFullPath: undefined,
    packageJsonFullPath: path.join(repo, "packages", packageDir, "package.json"),
  });
  const result = Extractor.invoke(extractorConfig, {
    localBuild: true,
    showVerboseMessages: false,
  });
  if (!result.succeeded) {
    throw new Error(
      `${entryName}: API Extractor reported ${result.errorCount} errors and ${result.warningCount} warnings`,
    );
  }
  process.stdout.write(`bundled ${entryName}\n`);
}

for (const [entryName, packageDir] of Object.entries(entries)) {
  rollup(entryName, packageDir);
}

const index = `export * as types from "./types.js";
export * as ledger from "./ledger.js";
export * as registrum from "./registrum.js";
export * as eventStore from "./event-store.js";
export * as proof from "./proof.js";
export * as vault from "./vault.js";
export * as treasury from "./treasury.js";
export * as reconciler from "./reconciler.js";
export * as chainObserver from "./chain-observer.js";
export * as witness from "./witness.js";
export * as verify from "./verify.js";
export * as sdk from "./sdk.js";
`;
mkdirSync(outDir, { recursive: true });
await import("node:fs").then((fs) => fs.writeFileSync(path.join(outDir, "index.d.ts"), index));
process.stdout.write("wrote index.d.ts\n");
