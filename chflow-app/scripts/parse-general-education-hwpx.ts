import { runEducationImport } from "./education-import-cli";

runEducationImport("general_education_history").catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

