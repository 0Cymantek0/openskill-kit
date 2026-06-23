# Security Model

Threats:

- prompt injection inside generated skills
- instructions to hide behavior or override higher-priority instructions
- credential access or exfiltration
- destructive shell commands
- unsafe global install behavior
- obfuscated script execution

Generated skills are untrusted until audited. Critical findings block install
unless explicitly overridden.

The scanner is a first-pass filter, not a proof of safety. Users must review
generated skills before trusting them.
