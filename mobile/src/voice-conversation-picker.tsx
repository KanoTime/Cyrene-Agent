import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useMemo, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { MobileVoiceConversationMeta } from "./call-control-protocol";

export function VoiceConversationPicker({
  characterName,
  conversations,
  busy,
  catalogReady,
  errorMessage,
  onCreate,
  onSelect,
  onRename,
  hasMore,
  onLoadMore,
  onHangUp,
}: {
  characterName: string;
  conversations: MobileVoiceConversationMeta[];
  busy: boolean;
  catalogReady: boolean;
  errorMessage?: string;
  onCreate: (title: string) => void;
  onSelect: (conversationId: string) => void;
  onRename: (conversationId: string, title: string) => void;
  hasMore: boolean;
  onLoadMore: () => void;
  onHangUp: () => void;
}): React.JSX.Element {
  const [newTitle, setNewTitle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const normalizedNewTitle = newTitle.replace(/\s+/g, " ").trim();
  const canCreate = normalizedNewTitle.length > 0
    && Array.from(normalizedNewTitle).length <= 80
    && !busy;
  const listEmpty = useMemo(() => (
    catalogReady ? (
      <View style={styles.emptyState}>
        <Ionicons color="#bda9d8" name="chatbubbles-outline" size={30} />
        <Text style={styles.emptyTitle}>还没有语音对话</Text>
        <Text style={styles.emptyBody}>
          给第一段对话起个名字。以后重新呼叫时，可以从这里继续。
        </Text>
      </View>
    ) : (
      <View accessibilityLabel="正在读取语音对话" style={styles.skeletonList}>
        {[0, 1, 2].map((item) => (
          <View key={item} style={styles.skeletonRow}>
            <View style={styles.skeletonTitle} />
            <View style={styles.skeletonLine} />
            <View style={styles.skeletonShortLine} />
          </View>
        ))}
      </View>
    )
  ), [catalogReady]);

  return (
    <LinearGradient
      colors={["#08070f", "#0f0d1f", "#181432"]}
      locations={[0, 0.54, 1]}
      style={styles.backdrop}
    >
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.flex}
        >
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>语音对话</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.title}>
                想从哪里继续？
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.subtitle}>
                选择一段与{characterName}的历史，或创建新对话。选择完成前不会收音。
              </Text>
            </View>
            <Pressable
              accessibilityLabel="结束通话"
              accessibilityRole="button"
              onPress={onHangUp}
              style={({ pressed }) => [
                styles.closeButton,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons color="#f8f2ff" name="close" size={24} />
            </Pressable>
          </View>

          <View style={styles.createRow}>
            {errorMessage ? (
              <View accessibilityLiveRegion="polite" style={styles.errorBanner}>
                <Ionicons color="#ff9eaf" name="alert-circle-outline" size={18} />
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            ) : null}
            <TextInput
              accessibilityLabel="新语音对话名称"
              editable={!busy}
              maxLength={80}
              onChangeText={setNewTitle}
              onSubmitEditing={() => {
                if (!canCreate) return;
                onCreate(normalizedNewTitle);
                setNewTitle("");
              }}
              placeholder="例如：每天睡前聊聊"
              placeholderTextColor="#8f82a7"
              returnKeyType="done"
              style={styles.titleInput}
              value={newTitle}
            />
            <Pressable
              accessibilityRole="button"
              disabled={!canCreate}
              onPress={() => {
                onCreate(normalizedNewTitle);
                setNewTitle("");
              }}
              style={({ pressed }) => [
                styles.createButton,
                !canCreate && styles.buttonDisabled,
                pressed && canCreate && styles.pressed,
              ]}
            >
              <Ionicons color="#ffffff" name="add" size={20} />
              <Text style={styles.createButtonText}>创建对话</Text>
            </Pressable>
          </View>

          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>已保存</Text>
            <Text style={styles.listCount}>{conversations.length} 段</Text>
          </View>

          <FlatList
            contentContainerStyle={[
              styles.listContent,
              conversations.length === 0 && styles.listContentEmpty,
            ]}
            data={conversations}
            keyExtractor={(conversation) => conversation.id}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={listEmpty}
            ListFooterComponent={hasMore ? (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={onLoadMore}
                style={({ pressed }) => [
                  styles.loadMoreButton,
                  busy && styles.buttonDisabled,
                  pressed && !busy && styles.pressed,
                ]}
              >
                <Text style={styles.loadMoreText}>
                  {busy ? "正在读取…" : "加载更早的对话"}
                </Text>
              </Pressable>
            ) : null}
            renderItem={({ item }) => {
              const editing = editingId === item.id;
              return (
                <View style={styles.conversationRow}>
                  {editing ? (
                    <View style={styles.renameRow}>
                      <TextInput
                        accessibilityLabel="修改语音对话名称"
                        autoFocus
                        maxLength={80}
                        onChangeText={setEditingTitle}
                        placeholderTextColor="#8f82a7"
                        style={styles.renameInput}
                        value={editingTitle}
                      />
                      <Pressable
                        accessibilityLabel="保存名称"
                        disabled={!editingTitle.trim() || busy}
                        onPress={() => {
                          onRename(item.id, editingTitle);
                          setEditingId(null);
                        }}
                        style={({ pressed }) => [
                          styles.iconAction,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Ionicons color="#9ff1c8" name="checkmark" size={22} />
                      </Pressable>
                      <Pressable
                        accessibilityLabel="取消修改"
                        onPress={() => setEditingId(null)}
                        style={({ pressed }) => [
                          styles.iconAction,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Ionicons color="#c9bfd8" name="close" size={21} />
                      </Pressable>
                    </View>
                  ) : (
                    <>
                      <Pressable
                        accessibilityHint="载入这段历史并开始语音聊天"
                        accessibilityRole="button"
                        disabled={busy}
                        onPress={() => onSelect(item.id)}
                        style={({ pressed }) => [
                          styles.conversationMain,
                          pressed && styles.rowPressed,
                        ]}
                      >
                        <View style={styles.conversationCopy}>
                          <Text numberOfLines={1} style={styles.conversationTitle}>
                            {item.title}
                          </Text>
                          <Text numberOfLines={2} style={styles.preview}>
                            {item.preview || "还没有内容，选择后开始第一轮对话。"}
                          </Text>
                          <Text style={styles.meta}>
                            {item.turnCount} 轮 · {formatUpdatedAt(item.updatedAt)}
                          </Text>
                        </View>
                        <Ionicons color="#d6c3f4" name="chevron-forward" size={21} />
                      </Pressable>
                      <Pressable
                        accessibilityLabel={`重命名${item.title}`}
                        disabled={busy}
                        onPress={() => {
                          setEditingId(item.id);
                          setEditingTitle(item.title);
                        }}
                        style={({ pressed }) => [
                          styles.renameButton,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Ionicons color="#bda9d8" name="pencil-outline" size={18} />
                      </Pressable>
                    </>
                  )}
                </View>
              );
            }}
            showsVerticalScrollIndicator={false}
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

function formatUpdatedAt(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  loadMoreButton: {
    alignItems: "center",
    borderColor: "#675a80",
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 4,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  loadMoreText: {
    color: "#d9ccef",
    fontSize: 14,
    fontWeight: "600",
  },
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 14,
    paddingHorizontal: 24,
    paddingBottom: 20,
    paddingTop: 24,
  },
  headerCopy: { flex: 1 },
  eyebrow: {
    color: "#be9be8",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  title: {
    color: "#fffaff",
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  subtitle: {
    color: "#c3b8d4",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  closeButton: {
    alignItems: "center",
    borderColor: "#675a80",
    borderRadius: 22,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  createRow: {
    gap: 10,
    paddingHorizontal: 24,
  },
  titleInput: {
    backgroundColor: "#171329",
    borderColor: "#5e5278",
    borderRadius: 14,
    borderWidth: 1,
    color: "#fffaff",
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: 16,
  },
  errorBanner: {
    alignItems: "flex-start",
    backgroundColor: "rgba(217, 70, 95, 0.12)",
    borderRadius: 12,
    flexDirection: "row",
    gap: 9,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorText: {
    color: "#ffb1bf",
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  createButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#a34bd2",
    borderRadius: 22,
    flexDirection: "row",
    gap: 7,
    minHeight: 44,
    paddingHorizontal: 17,
  },
  createButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
  buttonDisabled: { opacity: 0.4 },
  pressed: { opacity: 0.72 },
  listHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 10,
    paddingHorizontal: 24,
    paddingTop: 25,
  },
  listTitle: {
    color: "#f4edfc",
    fontSize: 17,
    fontWeight: "700",
  },
  listCount: {
    color: "#a99dbb",
    fontSize: 13,
  },
  listContent: {
    gap: 10,
    paddingBottom: 30,
    paddingHorizontal: 24,
  },
  listContentEmpty: { flexGrow: 1 },
  conversationRow: {
    alignItems: "stretch",
    backgroundColor: "#171329",
    borderColor: "#423955",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 104,
    overflow: "hidden",
  },
  conversationMain: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowPressed: { backgroundColor: "#211a38" },
  conversationCopy: { flex: 1 },
  conversationTitle: {
    color: "#fffaff",
    fontSize: 16,
    fontWeight: "700",
  },
  preview: {
    color: "#bbb0cb",
    fontSize: 14,
    lineHeight: 19,
    marginTop: 5,
  },
  meta: {
    color: "#8f83a2",
    fontSize: 12,
    marginTop: 8,
  },
  renameButton: {
    alignItems: "center",
    borderColor: "#423955",
    borderLeftWidth: 1,
    justifyContent: "center",
    width: 48,
  },
  renameRow: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 7,
    padding: 12,
  },
  renameInput: {
    backgroundColor: "#0f0c1d",
    borderColor: "#74628f",
    borderRadius: 12,
    borderWidth: 1,
    color: "#fffaff",
    flex: 1,
    fontSize: 15,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  iconAction: {
    alignItems: "center",
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  emptyState: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    minHeight: 220,
    paddingHorizontal: 28,
  },
  emptyTitle: {
    color: "#f4edfc",
    fontSize: 17,
    fontWeight: "700",
    marginTop: 13,
  },
  emptyBody: {
    color: "#a99dbb",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 7,
    textAlign: "center",
  },
  skeletonList: {
    gap: 10,
    paddingTop: 2,
  },
  skeletonRow: {
    backgroundColor: "#171329",
    borderRadius: 14,
    gap: 10,
    minHeight: 104,
    padding: 16,
  },
  skeletonTitle: {
    backgroundColor: "#2a233b",
    borderRadius: 4,
    height: 16,
    width: "45%",
  },
  skeletonLine: {
    backgroundColor: "#242033",
    borderRadius: 4,
    height: 12,
    width: "82%",
  },
  skeletonShortLine: {
    backgroundColor: "#211c2f",
    borderRadius: 4,
    height: 10,
    width: "34%",
  },
});
