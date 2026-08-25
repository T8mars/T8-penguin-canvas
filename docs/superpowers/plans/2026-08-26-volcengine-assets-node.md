# Volcengine Assets Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an audited built-in Volcengine Assets node that manages Ark asset groups/assets and emits safe typed `asset://` references.

**Architecture:** Add a server-only signed Ark Assets client and a bounded Express route, then register a theme-aware bilingual canvas input node through the shared node schema. Keep temporary previews in UI state, persistent outputs stable, and allow `asset://` pass-through only in the existing Volcengine provider.

**Tech Stack:** Electron 33, Node.js/CommonJS backend, Express, React 19, TypeScript, Zustand, XYFlow, i18next, Node test runner.

---

### Task 1: Lock the server signing and request contract

**Files:**
- Create: `backend/src/providers/volcengineAssets.js`
- Test: `tests/volcengineAssetsProvider.test.ts`

- [ ] Write a failing deterministic signer test that expects canonical URI `/`, sorted `Action`/`Version`, service `ark`, no outbound `Host` header, and a stable authorization signature for a fixed clock and credential fixture.
- [ ] Run `npx tsx --test tests/volcengineAssetsProvider.test.ts` and confirm failure because the provider module is absent.
- [ ] Implement `signVolcengineAssetsRequest`, `findVolcengineAssetsProfile`, strict asset URI parsing, the six-action allow-list, request validation, and `requestVolcengineAssets` with injectable settings/fetch/clock.
- [ ] Add failing tests for missing credentials, non-allow-listed actions, unsafe import URL, upstream error normalization, and response credential redaction; then implement the minimum behavior needed for each test.
- [ ] Re-run the provider test and confirm all cases pass.

### Task 2: Add bounded routes and persistent local tags

**Files:**
- Create: `backend/src/routes/volcengineAssets.js`
- Modify: `backend/src/config.js`
- Modify: `backend/src/server.js`
- Test: `tests/volcengineAssetsRoute.test.ts`

- [ ] Write a failing route test using an ephemeral Express server and injected upstream client. Cover status, group list/create, asset list/get/import, tag write/read, 15/100 item bounds, missing fields, unsafe URL rejection, and absence of credentials/local paths.
- [ ] Run `npx tsx --test tests/volcengineAssetsRoute.test.ts` and confirm the missing route failure.
- [ ] Implement an atomic JSON tag catalog in `config.VOLCENGINE_ASSETS_FILE`, a dependency-injectable router, normalized success/error envelopes, and server registration at `/api/volcengine-assets`.
- [ ] Re-run the route test and confirm all cases pass.

### Task 3: Normalize records and build stable typed outputs

**Files:**
- Create: `src/utils/volcengineAssets.ts`
- Modify: `src/utils/sourceHandleData.ts`
- Test: `tests/volcengineAssetsFrontend.test.ts`

- [ ] Write failing tests for heterogeneous `Result.Items` envelopes, exact asset ID preservation, normalized kinds/status, deduped tags, 15-item selection, Active-only `asset://` outputs, and per-handle `outputs` routing.
- [ ] Run `npx tsx --test tests/volcengineAssetsFrontend.test.ts` and confirm failure because the utility is absent and generic `outputs` routing is unsupported.
- [ ] Implement focused normalizers, `buildVolcengineAssetNodeOutputs`, and generic `outputs` map support in `selectSourceHandleData`.
- [ ] Re-run the frontend utility test and confirm all cases pass.

### Task 4: Register the independent node before writing its UI

**Files:**
- Modify: `backend/src/shared/canvasNodeSchema.json`
- Modify: `src/types/canvas.ts`
- Modify: `src/components/Canvas.tsx`
- Modify: `src/config/nodeRegistry.ts`
- Test: `tests/volcengineAssetsNode.test.ts`

- [ ] Write a failing source/schema test requiring `volcengine-assets`, input category metadata, three typed source handles, executable/non-generatable flags, bounded defaults, lazy component registration, and initial data.
- [ ] Run `npx tsx --test tests/volcengineAssetsNode.test.ts` and confirm the node is missing.
- [ ] Add the schema entry and connection-port authority, `NodeType`, lazy registration, `SPECIFIC_NODES` entry, and initial data.
- [ ] Run `npm run feature-sync:generate`, inspect generated capability diffs, and re-run the node test.

### Task 5: Implement the theme-aware bilingual node UI

**Files:**
- Create: `src/components/nodes/VolcengineAssetsNode.tsx`
- Modify: `src/services/api.ts`
- Modify: `src/i18n/nodeCatalog.ts`
- Modify: `src/i18n/nodeVisibleCatalog.ts`
- Modify: `src/i18n/resources.ts`
- Test: `tests/volcengineAssetsNode.test.ts`
- Test: `tests/i18n.test.ts`

- [ ] Extend the failing node test to require status/load/create/import/tag API bindings, `useRunTrigger`, image/video/audio handles, CSS theme variables, English translation keys, no credential inputs, no hard-coded dark node surface, and no persisted preview URL in output data.
- [ ] Run the targeted test and confirm those UI contracts fail.
- [ ] Implement the compact node: settings status, project/profile, group selection and creation, filters, refresh, paged asset cards, 15-item multi-select, local tags, collapsed public-URL import, preserved selection, status/error feedback, and stable output updates.
- [ ] Add typed `safeRequest` wrappers and full Chinese/English labels/descriptions/messages.
- [ ] Run the node and i18n tests and confirm they pass.

### Task 6: Enable Volcengine-only asset references

**Files:**
- Modify: `backend/src/providers/volcengine.js`
- Test: `tests/volcengineProvider.test.ts`

- [ ] Add a failing provider test proving `asset://` references pass unchanged to Volcengine image/video bodies while malformed asset references fail and ordinary HTTP/data references keep their existing resolver path.
- [ ] Run `npx tsx --test tests/volcengineProvider.test.ts` and confirm failure on the new expectation.
- [ ] Add the strict provider-local pass-through in `resolveRefs` and `resolveMediaItems` without changing the generic media resolver or other providers.
- [ ] Re-run the provider test and adjacent external-provider tests.

### Task 7: Synchronize product facts and release metadata

**Files:**
- Modify: `features.json`
- Modify (local/ignored by policy): `SKILL.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Create: `release-notes/v3.0.4.md`

- [ ] Add a v3.0.4 feature record describing provenance, core-only integration, actions, security boundaries, typed outputs, tests, and deferred real-account/user evidence.
- [ ] Update the private project Skill with the same release scope and low-resource release gates.
- [ ] Bump package/lock/README/release note versions to 3.0.4 without changing earlier immutable release records.
- [ ] Run JSON parsing, `npm run feature-sync:check`, and `npm run i18n:check`.

### Task 8: Verify, review, package, and publish

**Files:**
- Verify all files above and generated artifacts.

- [ ] Run the targeted Volcengine tests, full schema/registry/provider/i18n adjacency set, `npm run type-check`, `npm run public:check`, `npm run rh-toolbox:check`, `npm run music3-resources:check`, `npm run build`, and `git diff --check`.
- [ ] Review the full diff against the design for security, credentials, paths, theme, i18n, persistence, old-canvas compatibility, and release scope; fix every critical/important issue and re-run affected checks.
- [ ] Stage only intended files, commit on a `codex/` release branch, push, and bind the exact source commit/tag `v3.0.4` according to the project release Skill.
- [ ] Run the low-resource Windows `dist:release` path with the required release approval environment, verify encrypted backend/runtime/provenance/NSIS outputs, upload the three automatic-update assets without overwrite, and fully re-download/verify them.
- [ ] Trigger the real macOS arm64 workflow from the same fixed source/tag, verify its DMG/ZIP/`latest-mac.yml`, and attach them to the same non-draft, non-prerelease Latest Release.
- [ ] Record only completed technical evidence; mark feedback-user installation, real-account Volcengine acceptance, and cross-device checks as owner-authorized deferred evidence rather than passed.
