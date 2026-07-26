import type {
  CharacterBlockingActivity,
  CharacterSwitchAdapters,
} from "./character-runtime";

export type CharacterActivitySnapshot = Readonly<{
  agentBusy: boolean;
  callActive: boolean;
  asrBusy: boolean;
  ttsBusy: boolean;
  proactiveBusy: boolean;
  stateWriteBusy: boolean;
}>;

export interface ElectronCharacterSwitchDependencies {
  getActivity(): CharacterActivitySnapshot;
  flushState(): void | Promise<void>;
  stopCall(): void | Promise<void>;
  disposeAsr(): void | Promise<void>;
  stopScheduler(): void | Promise<void>;
  stopOpener(): void | Promise<void>;
  shutdownChannels(): void | Promise<void>;
  relaunch(): void;
  exit(code: number): void;
}

export function hasUncoordinatedAgentActivity(
  activeConversationCount: number,
  coordinatedWechatProcessingCount: number,
): boolean {
  return Math.max(0, activeConversationCount) > Math.max(0, coordinatedWechatProcessingCount);
}

export function collectCharacterBlockingActivities(
  activity: CharacterActivitySnapshot,
): CharacterBlockingActivity[] {
  const blockingActivities: CharacterBlockingActivity[] = [];

  if (activity.agentBusy) {
    blockingActivities.push({ kind: "agent-run", reason: "正在生成回复" });
  }
  if (activity.callActive) {
    blockingActivities.push({ kind: "voice-call", reason: "语音通话正在进行" });
  }
  if (activity.asrBusy) {
    blockingActivities.push({ kind: "asr", reason: "正在识别语音" });
  }
  if (activity.ttsBusy) {
    blockingActivities.push({ kind: "tts", reason: "正在合成或播放语音" });
  }
  if (activity.proactiveBusy) {
    blockingActivities.push({ kind: "proactive-generation", reason: "正在生成主动消息" });
  }
  if (activity.stateWriteBusy) {
    blockingActivities.push({ kind: "state-write", reason: "正在写入角色状态" });
  }

  return blockingActivities;
}

export function createElectronCharacterSwitchAdapters(
  dependencies: ElectronCharacterSwitchDependencies,
): CharacterSwitchAdapters {
  return {
    getBlockingActivities() {
      return collectCharacterBlockingActivities(dependencies.getActivity());
    },
    async persistActiveState() {
      await dependencies.flushState();
    },
    async shutdownActiveResources() {
      await dependencies.stopCall();
      await dependencies.disposeAsr();
      await dependencies.stopScheduler();
      await dependencies.stopOpener();
      await dependencies.shutdownChannels();
    },
    async requestRelaunch() {
      dependencies.relaunch();
      dependencies.exit(0);
    },
  };
}
