import { describe, expect, it } from "vitest";
import { VISION_TEST_IMAGE } from "./vision-test-image";

function readPngDimensions(base64: string): { width: number; height: number } {
  const png = Buffer.from(base64, "base64");
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

describe("VISION_TEST_IMAGE", () => {
  it("满足视觉模型的最小边长和 Qwen-VL 的最小像素阈值", () => {
    const { width, height } = readPngDimensions(VISION_TEST_IMAGE.base64);

    expect(width).toBeGreaterThan(10);
    expect(height).toBeGreaterThan(10);
    expect(width * height).toBeGreaterThanOrEqual(4096);
  });
});
