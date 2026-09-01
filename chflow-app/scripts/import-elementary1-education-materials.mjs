import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : "";
}

const source = argument("source");
const deptId = argument("dept-id");
const uploadedBy = argument("uploaded-by");
const dryRun = process.argv.includes("--dry-run");
if (!source || !deptId || !uploadedBy) {
  throw new Error("--source, --dept-id, --uploaded-by 인수가 필요합니다.");
}

const requiredEnvironment = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
for (const name of requiredEnvironment) {
  if (!dryRun && !process.env[name]) throw new Error(`${name} 환경변수가 필요합니다.`);
}

const bucketName = process.env.R2_BUCKET_NAME || "chflow-storage";
const client = dryRun ? null : new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});

function materialId(kind, number) {
  const family = kind === "lesson" ? "00" : "10";
  const padded = String(number).padStart(4, "0");
  return `e1${family}${padded}-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

async function findPdfs(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await findPdfs(fullPath));
    else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".pdf") found.push(fullPath);
  }
  return found;
}

function describe(filePath) {
  const parentName = path.basename(path.dirname(filePath));
  const fileName = path.basename(filePath);
  const lessonMatch = /^(\d+)과$/.exec(parentName);
  if (lessonMatch) {
    const lessonNumber = Number(lessonMatch[1]);
    return {
      kind: "lesson",
      lessonNumber,
      sortOrder: lessonNumber,
      title: path.basename(fileName, path.extname(fileName)),
      id: materialId("lesson", lessonNumber),
    };
  }

  const specialMatch = /^특별절기(\d+)\s*(.*)$/.exec(parentName);
  if (specialMatch) {
    const sequence = Number(specialMatch[1]);
    return {
      kind: "special",
      lessonNumber: null,
      sortOrder: sequence,
      title: specialMatch[2].trim() || path.basename(fileName, path.extname(fileName)),
      id: materialId("special", sequence),
    };
  }
  throw new Error(`과 또는 특별절기 폴더가 아닌 PDF입니다: ${filePath}`);
}

const files = await findPdfs(path.resolve(source));
const described = files.map((filePath) => ({ filePath, ...describe(filePath) }))
  .sort((a, b) => a.kind.localeCompare(b.kind) || a.sortOrder - b.sortOrder);
if (described.length !== 26) {
  throw new Error(`PDF 26개를 예상했으나 ${described.length}개를 찾았습니다.`);
}

const now = new Date().toISOString();
for (const item of described) {
  const bytes = await readFile(item.filePath);
  const objectPath = `${deptId}/${item.id}.pdf`;
  const metadata = {
    id: item.id,
    deptId,
    kind: item.kind,
    lessonNumber: item.lessonNumber,
    title: item.title,
    sortOrder: item.sortOrder,
    filePath: objectPath,
    originalName: path.basename(item.filePath),
    sizeBytes: bytes.length,
    createdAt: now,
    updatedAt: now,
    uploadedBy,
  };

  if (client) {
    await client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: `education-materials/${objectPath}`,
      Body: bytes,
      ContentType: "application/pdf",
    }));
    await client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: `education-materials/${deptId}/${item.id}.json`,
      Body: Buffer.from(JSON.stringify(metadata), "utf8"),
      ContentType: "application/json; charset=utf-8",
    }));
  }
  process.stdout.write(`등록: ${item.kind === "lesson" ? `${item.lessonNumber}과` : item.title}\n`);
}

process.stdout.write(`${dryRun ? "검증" : "등록"} 완료: PDF ${described.length}개\n`);
