/**
 * Production mobile entry policy.
 *
 * Legacy cyrene://call links carried a LiveKit token directly and could join
 * without long-term device authorization or a per-call E2EE grant.
 */
export function assertSupportedMobileEntryLink(value: string): void {
  let link: URL;
  try {
    link = new URL(value.trim());
  } catch {
    throw new Error("MOBILE_ENTRY_LINK_INVALID");
  }
  if (link.protocol === "cyrene:" && link.hostname === "call") {
    throw new Error("LEGACY_DIRECT_CALL_DISABLED");
  }
  if (link.protocol !== "cyrene:" || link.hostname !== "pair") {
    throw new Error("MOBILE_ENTRY_LINK_UNSUPPORTED");
  }
}
