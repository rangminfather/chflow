import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { extractHwpxPreview, parseHwpxBlocks } from "./hwpx-parse";

async function fixture() {
  const zip = new JSZip();
  zip.file(
    "Contents/section0.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
      <hs:sec xmlns:hs="hs" xmlns:hp="hp">
        <hp:tbl>
          <hp:tr><hp:tc><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="2" rowSpan="1"/><hp:p><hp:run><hp:t>초등2 주보</hp:t></hp:run></hp:p></hp:tc></hp:tr>
          <hp:tr><hp:tc><hp:cellAddr colAddr="0" rowAddr="1"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:p><hp:run><hp:t>광고</hp:t></hp:run></hp:p></hp:tc></hp:tr>
        </hp:tbl>
      </hs:sec>`,
  );
  zip.file("Preview/PrvImage.png", new Uint8Array(128).fill(1));
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

describe("HWPX bulletin parsing", () => {
  it("converts HWPX tables to bulletin blocks", async () => {
    const blocks = await parseHwpxBlocks(await fixture());
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ t: "tbl", rows: 2, cols: 2 });
    if (blocks[0].t === "tbl") {
      expect(blocks[0].cells[0].b).toEqual([{ t: "p", x: "초등2 주보" }]);
    }
  });

  it("extracts the embedded HWPX preview image", async () => {
    const preview = await extractHwpxPreview(await fixture());
    expect(preview?.contentType).toBe("image/png");
    expect(preview?.image).toHaveLength(128);
  });
});
