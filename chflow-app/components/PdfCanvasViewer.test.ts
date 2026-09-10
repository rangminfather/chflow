import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

describe("PdfCanvasViewer PDF.js runtime", () => {
  it("keeps the package API and public worker on the exact same version", async () => {
    const worker = await readFile(new URL("../public/pdf.worker.min.mjs", import.meta.url), "utf8");
    expect(pdfjs.version).toBe("6.2.108");
    expect(worker).toContain(`pdfjsVersion = ${pdfjs.version}`);
  });

  it("loads multiple pages and preserves viewport scaling used by the canvas viewer", async () => {
    const source = await PDFDocument.create();
    source.addPage([300, 400]);
    source.addPage([600, 400]);
    const bytes = await source.save();

    const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
    const document = await task.promise;
    try {
      expect(document.numPages).toBe(2);
      const firstPage = await document.getPage(1);
      const secondPage = await document.getPage(2);
      expect(firstPage.getViewport({ scale: 2 }).width).toBe(600);
      expect(secondPage.getViewport({ scale: 0.5 }).width).toBe(300);
      await expect(firstPage.getOperatorList()).resolves.toBeDefined();
      await expect(secondPage.getOperatorList()).resolves.toBeDefined();
    } finally {
      await task.destroy();
    }
  });
});
