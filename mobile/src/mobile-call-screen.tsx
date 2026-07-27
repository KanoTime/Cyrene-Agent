import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import {
  formatCallDuration,
  getMobileAvatarKind,
  type MobileCallPresentation,
} from "./call-presentation";
import type { MobileCallTurnMode } from "./call-control-protocol";

const CYRENE_AVATAR = require("../assets/cyrene-avatar.png");
const WAVE_BARS = Array.from({ length: 28 }, (_, index) => ({
  angle: (360 / 28) * index,
  height: 8 + ((index * 7) % 13),
}));
const PARTICLES = [
  { left: "8%", top: "16%", size: 2, opacity: 0.28 },
  { left: "19%", top: "31%", size: 3, opacity: 0.18 },
  { left: "87%", top: "23%", size: 2, opacity: 0.32 },
  { left: "74%", top: "13%", size: 2, opacity: 0.2 },
  { left: "91%", top: "52%", size: 3, opacity: 0.2 },
  { left: "11%", top: "64%", size: 2, opacity: 0.24 },
  { left: "78%", top: "74%", size: 2, opacity: 0.22 },
  { left: "24%", top: "84%", size: 3, opacity: 0.16 },
] as const;

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!cancelled) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);
  return reduceMotion;
}

function useLoopingProgress(active: boolean, reduceMotion: boolean): Animated.Value {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    progress.stopAnimation();
    if (!active || reduceMotion) {
      progress.setValue(active ? 0.45 : 0);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: 820,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: 820,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [active, progress, reduceMotion]);
  return progress;
}

function useSpeakingRingProgress(
  active: boolean,
  reduceMotion: boolean,
): Animated.Value[] {
  const rings = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;
  useEffect(() => {
    const animations = rings.map((ring, index) => {
      ring.stopAnimation();
      if (!active || reduceMotion) {
        ring.setValue(active ? 0.5 + index * 0.15 : 0);
        return null;
      }
      ring.setValue(0);
      const animation = Animated.loop(
        Animated.sequence([
          Animated.delay(index * 400),
          Animated.timing(ring, {
            toValue: 1,
            duration: 1_200,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(ring, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
          Animated.delay((2 - index) * 400),
        ]),
      );
      animation.start();
      return animation;
    });
    return () => animations.forEach((animation) => animation?.stop());
  }, [active, reduceMotion, rings]);
  return rings;
}

function CallBackdrop({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <LinearGradient
      colors={["#08070f", "#0f0d1f", "#181432"]}
      locations={[0, 0.54, 1]}
      style={styles.backdrop}
    >
      <View pointerEvents="none" style={[styles.ambientGlow, styles.ambientGlowPink]} />
      <View pointerEvents="none" style={[styles.ambientGlow, styles.ambientGlowViolet]} />
      <View pointerEvents="none" style={styles.particles}>
        {PARTICLES.map((particle, index) => (
          <View
            key={index}
            style={[
              styles.particle,
              {
                left: particle.left,
                top: particle.top,
                width: particle.size,
                height: particle.size,
                borderRadius: particle.size / 2,
                opacity: particle.opacity,
              },
            ]}
          />
        ))}
      </View>
      {children}
    </LinearGradient>
  );
}

function AvatarActivity({
  characterName,
  characterId,
  presentation,
  reduceMotion,
  signalActive,
  compact,
}: {
  characterName: string;
  characterId?: string;
  presentation: MobileCallPresentation;
  reduceMotion: boolean;
  signalActive: boolean;
  compact: boolean;
}): React.JSX.Element {
  const progress = useLoopingProgress(
    presentation.showAvatarWaveform
      && (presentation.activity === "thinking" || signalActive),
    reduceMotion,
  );
  const speakingRings = useSpeakingRingProgress(
    presentation.showSpeakingRings,
    reduceMotion,
  );
  const usesCyreneAvatar = getMobileAvatarKind(characterId) === "cyrene";
  const waveScale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.68, 1.25],
  });

  return (
    <View style={[styles.avatarStage, compact && styles.avatarStageCompact]}>
      {presentation.showSpeakingRings
        ? speakingRings.map((ring, index) => (
          <Animated.View
            key={index}
            style={[
              styles.speakingRing,
              {
                opacity: ring.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.75, 0],
                }),
                transform: [{
                  scale: ring.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.85, 1.35],
                  }),
                }],
              },
            ]}
          />
        ))
        : null}
      {presentation.showAvatarWaveform ? (
        <View pointerEvents="none" style={styles.waveRing}>
          {WAVE_BARS.map((bar, index) => (
            <Animated.View
              key={index}
              style={[
                styles.waveBar,
                {
                  height: bar.height,
                  opacity: presentation.activity === "thinking" ? 0.5 : 0.82,
                  transform: [
                    { rotate: `${bar.angle}deg` },
                    { translateY: -96 },
                    { scaleY: waveScale },
                  ],
                },
              ]}
            />
          ))}
        </View>
      ) : null}
      <View style={styles.avatarFrame}>
        {usesCyreneAvatar ? (
          <Image
            accessibilityLabel={`${characterName}的头像`}
            source={CYRENE_AVATAR}
            style={{ height: "100%", width: "100%" }}
          />
        ) : (
          <View
            accessibilityLabel={`${characterName}的头像`}
            style={styles.fallbackAvatar}
          >
            <Text style={styles.fallbackAvatarText}>
              {Array.from(characterName.trim())[0] ?? "C"}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

function MicBars({
  active,
  reduceMotion,
}: {
  active: boolean;
  reduceMotion: boolean;
}): React.JSX.Element {
  const progress = useLoopingProgress(active, reduceMotion);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.micBars}
    >
      {[0, 1, 2, 3].map((index) => {
        const scaleY = progress.interpolate({
          inputRange: [0, 0.5, 1],
          outputRange:
            index % 2 === 0
              ? [0.42, 1, 0.62]
              : [0.78, 0.45, 1],
        });
        return (
          <Animated.View
            key={index}
            style={[
              styles.micBar,
              {
                height: 16 + index * 3,
                opacity: active ? 1 : 0.24,
                transform: [{ scaleY }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

function useCallDuration(active: boolean): string {
  const startedAt = useRef<number | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  useEffect(() => {
    if (!active) return;
    startedAt.current ??= Date.now();
    const update = () => setDurationMs(Date.now() - (startedAt.current ?? Date.now()));
    update();
    const timer = setInterval(update, 1_000);
    return () => clearInterval(timer);
  }, [active]);
  return formatCallDuration(durationMs);
}

export function MobileCallScreen({
  characterName,
  characterId,
  presentation,
  transcript,
  conversationTitle,
  inputMode = "automatic",
  manualTurnOpen = false,
  isMicrophoneEnabled,
  microphoneSignalActive = false,
  showMuteControl = true,
  onToggleMicrophone,
  onChangeInputMode,
  onManualTurnAction,
  onHangUp,
}: {
  characterName: string;
  characterId?: string;
  presentation: MobileCallPresentation;
  transcript: string;
  conversationTitle?: string;
  inputMode?: MobileCallTurnMode;
  manualTurnOpen?: boolean;
  isMicrophoneEnabled: boolean;
  microphoneSignalActive?: boolean;
  showMuteControl?: boolean;
  onToggleMicrophone: () => void;
  onChangeInputMode?: (mode: MobileCallTurnMode) => void;
  onManualTurnAction?: () => void;
  onHangUp: () => void;
}): React.JSX.Element {
  const reduceMotion = useReduceMotion();
  const { height: windowHeight } = useWindowDimensions();
  const compact = windowHeight < 700;
  const duration = useCallDuration(presentation.timerActive);
  const inputControlsEnabled = presentation.activity === "listening";
  const statusStyle =
    presentation.tone === "error"
      ? styles.callStatusError
      : presentation.tone === "thinking"
        ? styles.callStatusThinking
        : styles.callStatusDefault;

  return (
    <CallBackdrop>
      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.callHeader, compact && styles.callHeaderCompact]}>
          <Text maxFontSizeMultiplier={1.5} style={styles.callEyebrow}>语音通话</Text>
          <Text
            accessibilityLiveRegion="polite"
            maxFontSizeMultiplier={1.5}
            numberOfLines={2}
            style={[styles.callStatus, statusStyle]}
          >
            {presentation.label}
          </Text>
          <View style={styles.identityRow}>
            <Text maxFontSizeMultiplier={1.5} numberOfLines={1} style={styles.characterName}>
              {characterName}
            </Text>
            <View style={styles.presenceDot} />
          </View>
          {conversationTitle ? (
            <View style={styles.conversationBadge}>
              <Ionicons color="#cbb6ea" name="chatbubble-ellipses-outline" size={14} />
              <Text numberOfLines={1} style={styles.conversationBadgeText}>
                {conversationTitle}
              </Text>
            </View>
          ) : null}
          {presentation.timerActive ? (
            <Text style={styles.callDuration}>{duration}</Text>
          ) : null}
        </View>

        <View style={[styles.callBody, compact && styles.callBodyCompact]}>
          <AvatarActivity
            characterName={characterName}
            characterId={characterId}
            compact={compact}
            presentation={presentation}
            reduceMotion={reduceMotion}
            signalActive={microphoneSignalActive}
          />
          <View style={[styles.transcriptSlot, compact && styles.transcriptSlotCompact]}>
            <Text
              accessibilityLiveRegion="polite"
              maxFontSizeMultiplier={1.5}
              numberOfLines={4}
              style={[styles.transcript, !transcript && styles.transcriptPlaceholder]}
            >
              {transcript || " "}
            </Text>
          </View>
        </View>

        <View style={[styles.callFooter, compact && styles.callFooterCompact]}>
          <MicBars
            active={
              presentation.showMicBars
              && isMicrophoneEnabled
              && (presentation.activity === "thinking" || microphoneSignalActive)
            }
            reduceMotion={reduceMotion}
          />
          {onChangeInputMode ? (
            <View
              accessibilityLabel="语音输入模式"
              accessibilityRole="tablist"
              style={styles.modeSwitch}
            >
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: inputMode === "automatic" }}
                disabled={!inputControlsEnabled}
                onPress={() => onChangeInputMode("automatic")}
                style={({ pressed }) => [
                  styles.modeOption,
                  inputMode === "automatic" && styles.modeOptionSelected,
                  !inputControlsEnabled && styles.inputControlDisabled,
                  pressed && styles.pressedButton,
                ]}
              >
                <Text style={[
                  styles.modeOptionText,
                  inputMode === "automatic" && styles.modeOptionTextSelected,
                ]}>
                  自动聆听
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: inputMode === "manual" }}
                disabled={!inputControlsEnabled}
                onPress={() => onChangeInputMode("manual")}
                style={({ pressed }) => [
                  styles.modeOption,
                  inputMode === "manual" && styles.modeOptionSelected,
                  !inputControlsEnabled && styles.inputControlDisabled,
                  pressed && styles.pressedButton,
                ]}
              >
                <Text style={[
                  styles.modeOptionText,
                  inputMode === "manual" && styles.modeOptionTextSelected,
                ]}>
                  手动轮次
                </Text>
              </Pressable>
            </View>
          ) : null}
          {inputMode === "manual" && onManualTurnAction ? (
            <Pressable
              accessibilityLabel={manualTurnOpen ? "提交本轮语音" : "开始本轮语音"}
              accessibilityRole="button"
              disabled={!inputControlsEnabled}
              onPress={onManualTurnAction}
              style={({ pressed }) => [
                styles.manualTurnButton,
                manualTurnOpen && styles.manualTurnButtonOpen,
                !inputControlsEnabled && styles.inputControlDisabled,
                pressed && styles.pressedButton,
              ]}
            >
              <Ionicons
                color="#ffffff"
                name={manualTurnOpen ? "arrow-up-circle" : "mic"}
                size={22}
              />
              <Text style={styles.manualTurnButtonText}>
                {manualTurnOpen ? "提交本轮" : "开始说话"}
              </Text>
            </Pressable>
          ) : null}
          <View style={styles.controls}>
            {showMuteControl && inputMode === "automatic" ? (
              <View style={styles.controlGroup}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={isMicrophoneEnabled ? "静音" : "打开麦克风"}
                onPress={onToggleMicrophone}
                style={({ pressed }) => [
                  styles.muteButton,
                  !isMicrophoneEnabled && styles.muteButtonActive,
                  pressed && styles.pressedButton,
                ]}
              >
                <Ionicons
                  color="#fef7ff"
                  name={isMicrophoneEnabled ? "mic" : "mic-off"}
                  size={25}
                />
              </Pressable>
              <Text style={styles.controlLabel}>
                {isMicrophoneEnabled ? "静音" : "开麦"}
              </Text>
              </View>
            ) : null}
            <View style={styles.controlGroup}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="挂断"
                onPress={onHangUp}
                style={({ pressed }) => [
                  styles.hangUpButton,
                  pressed && styles.pressedButton,
                ]}
              >
                <Ionicons
                  color="#ffffff"
                  name="call"
                  size={30}
                  style={styles.hangUpIcon}
                />
              </Pressable>
              <Text style={styles.controlLabel}>挂断</Text>
            </View>
          </View>
        </View>
      </SafeAreaView>
    </CallBackdrop>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  safeArea: { flex: 1 },
  inputControlDisabled: { opacity: 0.45 },
  ambientGlow: {
    position: "absolute",
    width: 330,
    height: 330,
    borderRadius: 165,
  },
  ambientGlowPink: {
    backgroundColor: "#5d173f",
    opacity: 0.2,
    right: -180,
    top: -130,
  },
  ambientGlowViolet: {
    backgroundColor: "#31205f",
    opacity: 0.24,
    bottom: -170,
    left: -150,
  },
  particles: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  particle: {
    position: "absolute",
    backgroundColor: "#f5d0fe",
    shadowColor: "#ec4899",
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
  callHeader: {
    alignItems: "center",
    paddingHorizontal: 28,
    paddingTop: 14,
  },
  callHeaderCompact: { paddingTop: 8 },
  callEyebrow: {
    alignSelf: "flex-start",
    color: "#a094c1",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 1,
  },
  identityRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
    marginTop: 5,
    maxWidth: "86%",
  },
  presenceDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#67e8a5",
    shadowColor: "#67e8a5",
    shadowOpacity: 0.8,
    shadowRadius: 7,
  },
  characterName: {
    color: "#fef7ff",
    fontSize: 26,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  conversationBadge: {
    alignItems: "center",
    backgroundColor: "rgba(183, 148, 244, 0.09)",
    borderRadius: 999,
    flexDirection: "row",
    gap: 6,
    marginTop: 7,
    maxWidth: "82%",
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  conversationBadgeText: {
    color: "#cbbfe0",
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "600",
  },
  callStatus: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 21,
    marginTop: 10,
    minHeight: 22,
    textAlign: "center",
  },
  callStatusDefault: { color: "#ebe5f5" },
  callStatusThinking: { color: "#b794f4" },
  callStatusError: { color: "#ff9eaf" },
  callDuration: {
    color: "#6b6388",
    fontSize: 13,
    fontVariant: ["tabular-nums"],
    letterSpacing: 1.4,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderColor: "rgba(183, 148, 244, 0.13)",
    borderWidth: 1,
  },
  callBody: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    minHeight: 300,
  },
  callBodyCompact: { minHeight: 235 },
  avatarStage: {
    alignItems: "center",
    height: 250,
    justifyContent: "center",
    width: 250,
  },
  avatarStageCompact: {
    height: 210,
    transform: [{ scale: 0.84 }],
  },
  avatarFrame: {
    width: 158,
    height: 158,
    borderRadius: 79,
    borderWidth: 2,
    borderColor: "rgba(244, 185, 255, 0.8)",
    backgroundColor: "#2a2350",
    overflow: "hidden",
    shadowColor: "#ec4899",
    shadowOpacity: 0.42,
    shadowRadius: 22,
    elevation: 12,
  },
  fallbackAvatar: {
    alignItems: "center",
    backgroundColor: "#2a2350",
    flex: 1,
    justifyContent: "center",
  },
  fallbackAvatarText: {
    color: "#fef7ff",
    fontSize: 48,
    fontWeight: "700",
  },
  waveRing: {
    position: "absolute",
    width: 216,
    height: 216,
    left: 17,
    top: 17,
  },
  waveBar: {
    position: "absolute",
    left: 107,
    top: 103,
    width: 3,
    borderRadius: 2,
    backgroundColor: "#d8b4fe",
  },
  speakingRing: {
    position: "absolute",
    width: 158,
    height: 158,
    borderRadius: 79,
    borderWidth: 2,
    borderColor: "#ec4899",
  },
  transcriptSlot: {
    justifyContent: "center",
    minHeight: 88,
    paddingHorizontal: 28,
    width: "100%",
  },
  transcriptSlotCompact: { minHeight: 58 },
  transcript: {
    color: "#ebe5f5",
    fontSize: 17,
    lineHeight: 27,
    textAlign: "center",
  },
  transcriptPlaceholder: { opacity: 0 },
  callFooter: {
    alignItems: "center",
    paddingBottom: 20,
    paddingHorizontal: 28,
  },
  callFooterCompact: { paddingBottom: 8 },
  micBars: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    height: 32,
    justifyContent: "center",
    marginBottom: 16,
  },
  micBar: {
    backgroundColor: "#f7bdd6",
    borderRadius: 5,
    width: 8,
  },
  modeSwitch: {
    backgroundColor: "rgba(27, 22, 47, 0.88)",
    borderColor: "rgba(126, 105, 157, 0.42)",
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: "row",
    marginBottom: 14,
    padding: 3,
  },
  modeOption: {
    alignItems: "center",
    borderRadius: 18,
    justifyContent: "center",
    minHeight: 36,
    minWidth: 100,
    paddingHorizontal: 13,
  },
  modeOptionSelected: {
    backgroundColor: "#5d3b84",
  },
  modeOptionText: {
    color: "#a99dbb",
    fontSize: 13,
    fontWeight: "600",
  },
  modeOptionTextSelected: {
    color: "#fffaff",
  },
  manualTurnButton: {
    alignItems: "center",
    backgroundColor: "#9b4dca",
    borderRadius: 24,
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
    marginBottom: 15,
    minHeight: 48,
    minWidth: 170,
    paddingHorizontal: 20,
  },
  manualTurnButtonOpen: {
    backgroundColor: "#3e9f78",
  },
  manualTurnButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
  controls: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 42,
    justifyContent: "center",
  },
  controlGroup: { alignItems: "center", gap: 8 },
  muteButton: {
    alignItems: "center",
    backgroundColor: "rgba(42, 35, 80, 0.76)",
    borderColor: "rgba(183, 148, 244, 0.35)",
    borderRadius: 31,
    borderWidth: 1,
    height: 62,
    justifyContent: "center",
    width: 62,
  },
  muteButtonActive: {
    backgroundColor: "rgba(236, 72, 153, 0.26)",
    borderColor: "rgba(244, 185, 255, 0.55)",
  },
  hangUpButton: {
    alignItems: "center",
    backgroundColor: "#d9465f",
    borderRadius: 36,
    height: 72,
    justifyContent: "center",
    shadowColor: "#d9465f",
    shadowOpacity: 0.34,
    shadowRadius: 12,
    elevation: 8,
    width: 72,
  },
  hangUpIcon: { transform: [{ rotate: "135deg" }] },
  controlLabel: {
    color: "#a094c1",
    fontSize: 12,
    fontWeight: "600",
  },
  pressedButton: { opacity: 0.72, transform: [{ scale: 0.96 }] },
});
