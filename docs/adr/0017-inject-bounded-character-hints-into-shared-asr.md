# Inject bounded character hints into shared ASR

The ASR engine, model, language, worker, and operational parameters remain global, while each Character Package may declare a length-limited set of Speech Recognition Hints covering its display name, aliases, and frequent proper nouns. Desktop calls and WeChat voice transcription use the Active Character’s hints through the same shared ASR path, but packages cannot alter inference configuration or provide free-form instructions that compromise faithful transcription.
