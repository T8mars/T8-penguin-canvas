## Change summary

Describe the user-visible outcome and affected capability or node IDs.

## Required checks

- [ ] `npm run feature-sync:check`
- [ ] `npm run i18n:check`
- [ ] `npm run type-check`
- [ ] Relevant focused tests pass
- [ ] Stable node/provider/model/port IDs and saved-canvas compatibility are unchanged, or a migration is documented

## UI and localization (required for user-visible changes)

- [ ] Added stable keys for every new label, field, option, status, error, and help entry
- [ ] Added and reviewed both `zh-CN` and `en-US` copy
- [ ] Verified English layout at the affected narrowest width and at 125%/150%/200% scaling
- [ ] Preserved Chinese and English search aliases where applicable
- [ ] Confirmed UI locale does not change prompt, subtitle, script, or generated-content language
- [ ] Attached both-language screenshots or explained why no visible UI changed

## Runtime safety

- [ ] Background runs, stop/retry/recovery, result write-back, and cross-canvas identity still work
- [ ] Performance changes keep selected/running/error nodes readable and do not unmount run listeners
