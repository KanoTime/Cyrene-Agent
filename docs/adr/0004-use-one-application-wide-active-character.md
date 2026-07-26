# Use one application-wide Active Character

The first version has exactly one application-wide Active Character shared by desktop chat, the desktop pet, voice calls, proactive messages, and external messaging channels, and restores that character after restart. Per-window or per-channel character assignment is deferred because simultaneous identities would multiply state ownership, task scheduling, memory routing, and user-facing consistency problems before the single-character switching transaction is proven reliable.
