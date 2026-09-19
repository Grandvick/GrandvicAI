import { describe, expect, it } from "vitest";
import { validateDocumentFile, MAX_DOCUMENT_BYTES, ALLOWED_DOCUMENT_TYPES } from "./documents";

describe("validateDocumentFile", () => {
  it("accepts a valid PDF within the size limit", () => {
    expect(validateDocumentFile({ size: 1024, type: "application/pdf" })).toBeNull();
  });

  it("rejects an empty file", () => {
    expect(validateDocumentFile({ size: 0, type: "application/pdf" })).toMatch(/empty/i);
  });

  it("rejects a file over the size limit", () => {
    expect(validateDocumentFile({ size: MAX_DOCUMENT_BYTES + 1, type: "application/pdf" })).toMatch(
      /8MB/i
    );
  });

  it("rejects a disallowed file type", () => {
    expect(validateDocumentFile({ size: 1024, type: "application/zip" })).toMatch(
      /PDF|JPG|PNG|WEBP/i
    );
    expect(ALLOWED_DOCUMENT_TYPES).not.toContain("application/zip");
  });
});
