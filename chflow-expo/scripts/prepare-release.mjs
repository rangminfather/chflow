import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [releaseType, ...argumentsList] = process.argv.slice(2);
const apply = argumentsList.includes("--apply");
const notes = argumentsList.flatMap((argument, index) => argument === "--note" ? [argumentsList[index + 1]] : []).filter(Boolean);
const validTypes = new Set(["patch", "minor", "major"]);

if (!releaseType || !validTypes.has(releaseType)) {
  console.log("Usage: npm run release:preview -- <patch|minor|major> --note \"출시 내용\"");
  console.log("Apply: npm run release:patch -- --note \"오류를 수정했습니다.\"");
  process.exit(releaseType ? 1 : 0);
}

const root = process.cwd();
const packagePath = path.join(root, "package.json");
const appPath = path.join(root, "app.json");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const appJson = JSON.parse(await readFile(appPath, "utf8"));

if (packageJson.version !== appJson.expo.version) {
  throw new Error(`package.json (${packageJson.version}) and app.json (${appJson.expo.version}) must match before release.`);
}

const current = packageJson.version.match(/^(\d+)\.(\d+)\.(\d+)$/);
if (!current) throw new Error(`Unsupported version format: ${packageJson.version}`);
let [major, minor, patch] = current.slice(1).map(Number);
if (releaseType === "major") [major, minor, patch] = [major + 1, 0, 0];
if (releaseType === "minor") [minor, patch] = [minor + 1, 0];
if (releaseType === "patch") patch += 1;
const nextVersion = `${major}.${minor}.${patch}`;

const releaseLabel = {
  patch: "안정성 및 성능 개선",
  minor: "기능 및 사용성 개선",
  major: "주요 기능 업데이트",
}[releaseType];
const releaseName = `v${nextVersion} — ${releaseLabel}`;
const noteLines = notes.length > 0 ? notes : ["[출시 노트를 입력해 주세요]"];

console.log(`\n출시 버전: ${nextVersion}`);
console.log(`출시명: ${releaseName}`);
console.log("출시 노트:");
for (const note of noteLines) console.log(`• ${note}`);

if (!apply) {
  console.log("\n위 내용을 확정하려면 release:patch/minor/major 명령을 --note와 함께 실행하세요.");
  process.exit(0);
}
if (notes.length === 0) throw new Error("Release notes are required. Add one or more --note values.");

packageJson.version = nextVersion;
appJson.expo.version = nextVersion;
await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
await writeFile(appPath, `${JSON.stringify(appJson, null, 2)}\n`);

const notesDirectory = path.join(root, "release-notes");
await mkdir(notesDirectory, { recursive: true });
await writeFile(path.join(notesDirectory, `v${nextVersion}.md`), `# ${releaseName}\n\n${noteLines.map((note) => `- ${note}`).join("\n")}\n`);
console.log(`\nPrepared ${nextVersion}. Review release-notes/v${nextVersion}.md, commit the version files, then run npm run release:android.`);
