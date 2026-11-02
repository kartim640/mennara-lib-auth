---
"@mennara/auth": patch
---

`normalizeStepUpMethods` accepts the bare provider names Identity returns (`google`, `microsoft`, `apple`) as well as the older `oauth:<provider>` form, so provider-only accounts are offered provider step-up. Providers Identity cannot verify with are dropped instead of being offered.
