# Separate character uninstall from state deletion

Removing a user-installed Character Package deletes its package resources but preserves its Character-private State as Archived Character State by default, while built-in or currently active packages cannot be removed. Reinstalling the same Character ID can restore that state; permanent deletion is a distinct destructive action that enumerates affected data and requires explicit confirmation, because freeing large model or audio assets should not silently erase irreplaceable conversation history and relationships.
