import { runEducationImport } from "./education-import-cli";

runEducationImport("lmtc_history").catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

