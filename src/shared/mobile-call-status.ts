export type MobileCallStatusState =
  | "idle"
  | "connecting"
  | "waiting-for-mobile"
  | "connected"
  | "reconnecting"
  | "ended"
  | "error";

export interface MobileCallStatus {
  state: MobileCallStatusState;
  message?: string;
}
