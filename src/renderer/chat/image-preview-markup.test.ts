import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(fileURLToPath(new URL("./index.html", import.meta.url)), "utf8");

describe("chat image preview markup", () => {
  it("provides a dedicated native dialog for full-size image previews", () => {
    expect(html).toContain('<dialog class="image-preview-dialog" id="image-preview-dialog"');
    expect(html).toContain('id="image-preview-dialog-image"');
    expect(html).toContain('id="image-preview-dialog-close"');
    expect(html).toContain('id="image-preview-dialog-name"');
  });
});
