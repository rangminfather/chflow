import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  detectBulletinAttachmentKind,
  normalizeBulletinAttachmentAsPdf,
} from "./attachment-to-pdf";
import { fileKindOf } from "./samusil-board";

describe("supported bulletin attachment regressions", () => {
  it("keeps JPG normalization working", async () => {
    const jpeg = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 255, g: 255, b: 255 } },
    }).jpeg().toBuffer();
    const source = Buffer.concat([jpeg, Buffer.alloc(1_100)]);

    const bytes = new Uint8Array(source);
    expect(detectBulletinAttachmentKind(bytes)).toBe("jpeg");
    const pdf = await normalizeBulletinAttachmentAsPdf(bytes);
    expect(pdf?.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });

  it("keeps PPTX and HWP/HWPX routing unchanged", () => {
    expect(fileKindOf("weekly.pptx")).toBe("pptx");
    expect(fileKindOf("weekly.hwp")).toBe("hwp");
    expect(fileKindOf("weekly.hwpx")).toBe("hwp");
    expect(fileKindOf("weekly.jpg")).toBe("image");
  });
});
