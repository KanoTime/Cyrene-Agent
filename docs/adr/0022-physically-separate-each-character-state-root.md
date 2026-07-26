# Physically separate each Character State Root

Every Character ID owns a separate Character State Root containing its chats, memory and vector index, relationship, worldbook state, proactive state, and TTS cache, while user profile, imported documents, and user tasks live under global storage. Embedding and reranking runtimes are shared for efficiency, but character index files are not; this costs additional storage management yet makes leakage resistant to missing query filters and makes backup, archive, restore, and permanent deletion auditable by directory boundary.
