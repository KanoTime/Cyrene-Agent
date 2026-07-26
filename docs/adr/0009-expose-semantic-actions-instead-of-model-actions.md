# Expose Semantic Actions instead of model-specific actions

LLMs, tools, and proactive content address a stable set of Semantic Actions, while each Character Package maps the actions it supports to verified motions, expressions, or composed effects from its own Live2D model. Unsupported actions become neutral or no-op with diagnostic logging, and never use the previous character’s resources; this keeps tool protocols and prompts stable across models and prevents model-specific action names from leaking into other packages.
