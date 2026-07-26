export function resolveControlPlaneOrigin(
  controlPlaneOrigin: string | undefined,
): string {
  if (!controlPlaneOrigin) throw new Error("CONTROL_PLANE_ORIGIN_REQUIRED");
  return controlPlaneOrigin;
}
