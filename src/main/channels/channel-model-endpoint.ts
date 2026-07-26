export function isLoopbackModelUrl(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}
