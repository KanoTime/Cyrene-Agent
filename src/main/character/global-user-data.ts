import path from "path";

export type GlobalUserDataLayout = Readonly<{
  userDataRoot: string;
  profileFile: string;
  avatarFile: string;
  appSettingsFile: string;
  documentRagRoot: string;
  documentCacheFile: string;
  todoFile: string;
  scheduledTasksFile: string;
  scheduledTaskHistoryFile: string;
}>;

/** Explicit user-owned data is global and is never derived from a Character ID. */
export function resolveGlobalUserDataLayout(userDataRoot: string): GlobalUserDataLayout {
  return Object.freeze({
    userDataRoot,
    profileFile: path.join(userDataRoot, "user-profile.json"),
    avatarFile: path.join(userDataRoot, "avatar.png"),
    appSettingsFile: path.join(userDataRoot, "app-settings.json"),
    documentRagRoot: path.join(userDataRoot, "global", "documents", "rag"),
    documentCacheFile: path.join(userDataRoot, "global", "documents", "document-cache.json"),
    todoFile: path.join(userDataRoot, "current-todos.json"),
    scheduledTasksFile: path.join(userDataRoot, "scheduled-tasks.json"),
    scheduledTaskHistoryFile: path.join(userDataRoot, "scheduled-tasks-history.jsonl"),
  });
}
