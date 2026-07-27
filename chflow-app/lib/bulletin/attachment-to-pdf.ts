import { PDFDocument } from "pdf-lib";

const A4_PORTRAIT = { width: 595.28, height: 841.89 };

export type BulletinAttachmentKind = "pdf" | "jpeg" | "png" | "unknown";

export function detectBulletinAttachmentKind(bytes: Uint8Array): BulletinAttachmentKind {
  if (
    bytes.byteLength > 1000 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  ) {
    return "pdf";
  }

  if (bytes.byteLength > 1000 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return "jpeg";
  }

  if (
    bytes.byteLength > 1000 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "png";
  }

  return "unknown";
}

export async function normalizeBulletinAttachmentAsPdf(
  bytes: Uint8Array
): Promise<Buffer | null> {
  const kind = detectBulletinAttachmentKind(bytes);
  if (kind === "pdf") return Buffer.from(bytes);
  if (kind !== "jpeg" && kind !== "png") return null;

  const document = await PDFDocument.create();
  const image = kind === "jpeg"
    ? await document.embedJpg(bytes)
    : await document.embedPng(bytes);
  const landscape = image.width > image.height;
  const pageWidth = landscape ? A4_PORTRAIT.height : A4_PORTRAIT.width;
  const pageHeight = landscape ? A4_PORTRAIT.width : A4_PORTRAIT.height;
  const scale = Math.min(pageWidth / image.width, pageHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  const page = document.addPage([pageWidth, pageHeight]);

  page.drawImage(image, {
    x: (pageWidth - width) / 2,
    y: (pageHeight - height) / 2,
    width,
    height,
  });

  return Buffer.from(await document.save());
}
