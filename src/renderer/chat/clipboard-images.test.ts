import { describe, expect, it } from "vitest";
import { collectPastedImageFiles } from "./clipboard-images";

type ClipboardItemLike = {
  kind: string;
  type: string;
  getAsFile: () => File | null;
};

function item(kind: string, type: string, file: File | null): ClipboardItemLike {
  return { kind, type, getAsFile: () => file };
}

describe("collectPastedImageFiles", () => {
  it("only keeps supported image files from a paste payload", () => {
    const screenshot = { name: "截图.png", type: "image/png" } as File;
    const items = [
      item("string", "text/plain", null),
      item("file", "image/png", screenshot),
      item("file", "application/pdf", { name: "notes.pdf", type: "application/pdf" } as File),
    ];

    expect(collectPastedImageFiles(items)).toEqual([screenshot]);
  });

  it("does not intercept a normal text-only paste", () => {
    expect(collectPastedImageFiles([item("string", "text/plain", null)])).toEqual([]);
  });
});
