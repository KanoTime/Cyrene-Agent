# Isolate conversation-derived state by character

Only explicit user-authored identity and operating preferences belong to the Global User Profile. Conversation history, inferred facts, secrets, relationship state, long-term memory, and worldbook activation state are Character-private State by default, because automatically carrying them between characters would leak private context and manufacture relationships that the new character never formed; an explicit cross-character sharing feature may be added later, but implicit sharing is excluded from the first version.
