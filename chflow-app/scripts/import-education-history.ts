import { runEducationImport } from "./education-import-cli";

runEducationImport().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

