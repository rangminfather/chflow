import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile(new URL("../eas.json", import.meta.url), "utf8"));
const submitProfiles = config.submit ?? {};
const production = submitProfiles.production?.android;

if (submitProfiles.internal) {
  throw new Error("Internal submit profile must not exist for a production release.");
}

if (production?.track !== "production") {
  throw new Error("Production Android submit track must be explicitly set to production.");
}

if (production.releaseStatus !== "draft") {
  throw new Error("Production Android releaseStatus must remain draft until Play Console review.");
}

console.log("Production submission preflight passed: track=production, releaseStatus=draft");
