# Switch characters only through an idle transaction

The first version changes characters only through a Character Switch Transaction while agent runs, ASR, TTS, voice calls, proactive generation, and character-state writes are idle. The application disables switching while those activities are in progress instead of forcibly cancelling them, then persists and suspends the old character, validates and binds the new package, and rolls back on any failure; this sacrifices instant hot switching to avoid mixed replies, stale audio, partial memory writes, and leaked Live2D resources.
