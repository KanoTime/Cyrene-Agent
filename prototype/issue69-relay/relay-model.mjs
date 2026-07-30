// Pure state model behind the throwaway TUI.
export function initialPrototypeState() {
  return {
    phase: "IDLE",
    worker: "STOPPED",
    rfcVector: "NOT_RUN",
    desktop: "DISCONNECTED",
    mobile: "DISCONNECTED",
    epoch: 0,
    desktopSequence: 0,
    mobileSequence: 0,
    authoritativeEffects: 0,
    duplicateEffects: 0,
    lastGate: "none",
    lastResult: "not started",
    audit: null,
  };
}

export function reducePrototypeState(state, action) {
  switch (action.type) {
    case "WORKER_READY":
      return { ...state, worker: "READY", phase: "READY", lastResult: action.result };
    case "RFC_VECTOR":
      return {
        ...state,
        rfcVector: action.passed ? "PASS" : "FAIL",
        lastGate: "RFC 9180 vector",
        lastResult: action.result,
      };
    case "CONNECTED":
      return {
        ...state,
        desktop: "CONNECTED",
        mobile: "CONNECTED",
        epoch: state.epoch + 1,
        phase: "CONNECTED",
        lastGate: "one-use tickets",
        lastResult: action.result,
      };
    case "MOBILE_OFFLINE":
      return {
        ...state,
        mobile: "DISCONNECTED",
        phase: "DEGRADED",
        lastGate: "offline",
        lastResult: action.result,
      };
    case "MESSAGE":
      return {
        ...state,
        desktopSequence: action.desktopSequence ?? state.desktopSequence,
        mobileSequence: action.mobileSequence ?? state.mobileSequence,
        authoritativeEffects: action.authoritativeEffects ?? state.authoritativeEffects,
        duplicateEffects: action.duplicateEffects ?? state.duplicateEffects,
        lastGate: action.gate,
        lastResult: action.result,
      };
    case "REVOKED":
      return {
        ...state,
        mobile: "REVOKED",
        phase: "REVOKED",
        lastGate: "revocation",
        lastResult: action.result,
      };
    case "AUDIT":
      return { ...state, audit: action.audit, lastGate: "storage audit", lastResult: action.result };
    case "ERROR":
      return { ...state, phase: "ERROR", lastGate: action.gate, lastResult: action.error };
    default:
      return state;
  }
}
