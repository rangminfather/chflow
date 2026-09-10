import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { inflateHwpSection } from "./hwp-parse";

describe("HWP section inflation limits", () => {
  it("inflates a normal compressed section", () => {
    const source = Buffer.from("normal HWP section");
    expect(inflateHwpSection(deflateRawSync(source), 1024)).toEqual(source);
  });

  it("rejects compressed output beyond the section limit", () => {
    const compressed = deflateRawSync(Buffer.alloc(1024, 65));
    expect(() => inflateHwpSection(compressed, 128)).toThrowError(
      expect.objectContaining({ code: "archive_entry_too_large" }),
    );
  });
});
