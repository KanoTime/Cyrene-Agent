# Separate license-safe fixtures from local character assets

Automated character-switching tests use a minimal license-safe fixture committed to the repository, while real two-character UI acceptance uses a locally installed Hoshino package assembled from the user’s existing voice and BongoCat Live2D assets. Hoshino weights, reference audio, models, and any assets without redistribution permission remain outside Git and are not shipped; this preserves reproducible automated coverage while allowing realistic local validation without publishing restricted material.
