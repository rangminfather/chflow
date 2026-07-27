import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const currentDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(currentDir, "..");
const eslintCli = resolve(appDir, "node_modules/eslint/bin/eslint.js");

// This is intentionally a temporary ratchet, not a permanent allowance.
// Reduce the number as warning categories are fixed; do not raise it.
const WARNING_BASELINE = 128;

const result = spawnSync(process.execPath, [eslintCli, "-f", "json"], {
  cwd: appDir,
  encoding: "utf8",
  shell: false,
  maxBuffer: 20 * 1024 * 1024,
});

if (!result.stdout) {
  process.stderr.write(result.stderr || "ESLint did not produce a report.\n");
  process.exit(1);
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  process.stderr.write("Could not parse the ESLint JSON report.\n");
  process.exit(1);
}

const totals = report.reduce((summary, file) => ({
  errors: summary.errors + file.errorCount,
  warnings: summary.warnings + file.warningCount,
}), { errors: 0, warnings: 0 });

if (totals.errors > 0) {
  process.stderr.write(`ESLint found ${totals.errors} error(s).\n`);
  process.exit(1);
}

if (totals.warnings > WARNING_BASELINE) {
  process.stderr.write(
    `ESLint warnings increased from the baseline (${WARNING_BASELINE}) to ${totals.warnings}. `
    + "Fix the new warning instead of increasing the baseline.\n",
  );
  process.exit(1);
}

process.stdout.write(
  `Lint baseline passed: ${totals.warnings}/${WARNING_BASELINE} warnings, ${totals.errors} errors.\n`,
);
