# Use Character ID as the permanent state ownership key

A Character ID permanently identifies both a Character Package and its Character-private State, independent of display name or folder name, and built-in IDs are reserved. Importing the same ID at a higher version performs a validated, backed-up, atomic resource upgrade while preserving private state; equal versions are not duplicated, lower versions are rejected by default, and any failed upgrade leaves the previous version active so that package collisions cannot capture or corrupt another character’s data.
