# Make Character Capabilities explicit and non-inheriting

A Character Package requires a valid manifest, stable identity, display name, core personality prompt, avatar, and private-state namespace, while worldbooks, Live2D, semantic actions, TTS, stickers, and opener packs are explicit optional Character Capabilities. An undeclared capability is clearly unavailable, a declared but invalid capability rejects the switch, and no missing capability ever inherits resources from the previous character; this allows text-first packages without permitting mixed-character fallbacks.
