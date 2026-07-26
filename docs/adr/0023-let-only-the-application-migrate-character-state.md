# Let only the application migrate character state

Character Package upgrades replace validated Character Content and media but cannot include scripts or declarative transformations for Character-private State. The application alone owns versioned, tested, idempotent state schemas and migrations; packages declare compatible application and package-schema versions, and an incompatible upgrade is rejected while the prior package remains installed, preventing third-party content updates from silently rewriting relationships, memories, or user history.
