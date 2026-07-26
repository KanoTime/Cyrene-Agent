# Switch complete Character Packages

Cyrene Agent treats a Character Package as the atomic unit of character switching rather than switching only a prompt, Live2D model, or voice. This costs more integration work, but prevents mixed-character states in which the text identity has changed while memories, visuals, actions, voice, or proactive content still belong to the previous character; LLM providers, ASR, tools, MCP servers, and the user’s own profile remain global capabilities outside the package.
