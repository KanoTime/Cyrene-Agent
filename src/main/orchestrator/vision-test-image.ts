/**
 * 用于“测试视觉模型”的 64×64 纯红本地 PNG。
 *
 * 它的每边大于 10px，且总像素为 4,096，可满足 Qwen-VL 的最小图像约束；
 * 保持为 data URL 的负载部分，避免测试配置依赖网络或本地文件权限。
 */
export const VISION_TEST_IMAGE = {
  base64: "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAb0lEQVR4nO3PAQkAAAyEwO9feoshgnABdLep8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3IPanc8OLDQitxAAAAAElFTkSuQmCC",
  mime: "image/png",
} as const;
