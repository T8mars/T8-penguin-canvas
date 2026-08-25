# Volcengine Assets Node Design

## Decision

Integrate `G:\---\t8-volcengine-assets-plugin-v0.3.0` as one audited, built-in core node named `volcengine-assets` / “火山素材库”. Do not add a general-purpose runtime plugin host. The supplied package is a capability prototype: its frontend imports a core `VolcAssetNode` that does not exist, and its host would execute arbitrary CommonJS from an installed directory.

## User outcome

Creators can use the existing Volcengine advanced-provider profile and its server-only AK/SK to:

- list and create AIGC asset groups;
- list, search, filter, inspect, tag, and select image, video, or audio assets;
- import a public URL into a selected asset group and refresh its processing state;
- select at most 15 assets and expose stable `asset://<asset-id>` references through separate image, video, and audio output handles;
- connect those references directly to existing Volcengine image/video generation without exposing AK/SK in the browser or canvas document.

The node is additive. Existing Ark API-key image, video, and LLM generation behavior and all old canvases remain unchanged.

## Architecture

### Backend boundary

`backend/src/providers/volcengineAssets.js` owns the HMAC-SHA256 signing contract and the six allow-listed Ark Assets actions: `CreateAsset`, `GetAsset`, `ListAssets`, `CreateAssetGroup`, `ListAssetGroups`, and `GetAssetGroup`. It reads AK/SK only from the existing normalized `advancedProviders` settings on the server.

Requests use the official generic OpenAPI shape: `POST https://open.volcengineapi.com/?Action=<action>&Version=2024-01-01`, canonical URI `/`, service `ark`, and region from the profile. The canonical host participates in the signature, but the actual fetch headers omit an explicit `Host` field so Chromium-compatible transports can generate it safely.

`backend/src/routes/volcengineAssets.js` exposes bounded same-origin routes under `/api/volcengine-assets`. It validates project/group/asset IDs, pagination, kinds, names, tags, and public HTTP(S) import URLs. Responses are normalized and never contain credentials, authorization headers, the settings object, or local filesystem paths. Local tags are atomically stored under the app data directory; temporary upstream preview URLs are returned only to the active UI and are not copied into stable node outputs.

### Frontend boundary

`src/components/nodes/VolcengineAssetsNode.tsx` provides a theme-aware, bilingual independent input node. Its default flow is configuration status → group selection → asset list → multi-selection. Group creation and public-URL import are collapsed secondary actions. Destructive remote delete/update operations are deliberately out of scope.

`src/utils/volcengineAssets.ts` normalizes heterogeneous Ark response envelopes and converts selected records into stable node output data. It preserves the exact asset ID while normalizing only the URI scheme to lowercase. The canvas stores bounded metadata and `asset://` references, not AK/SK or temporary preview URLs.

The node exposes `image`, `video`, and `audio` source handles. The generic source-handle router learns to read a node's `outputs` map, so each connection receives only its selected media kind.

### Volcengine-only reference pass-through

`backend/src/providers/volcengine.js` recognizes a strict `asset://<asset-id>` reference only inside the Volcengine provider. It bypasses generic media download/data-URL conversion and forwards the stable URI to Ark. Other providers and general URL resolvers continue to reject or ignore this scheme.

### Registration and capability accounting

The shared canvas node schema is the single authority for registry metadata, port contracts, executability, defaults, and Agent coverage. `NodeType`, lazy component registration, initial data, catalog translations, i18n resources, sidebar grouping, feature accounting, and generated capability artifacts are updated together. The node is executable (Run refreshes the current list/status) but not generatable by itself.

## Error and recovery behavior

- Missing AK/SK: show a settings action hint; never request secrets inside the node.
- Signature or permission failure: preserve current selection and display a normalized upstream code/message.
- Network failure: preserve existing list and selection; allow a single explicit refresh.
- Processing asset: keep it selectable only for inspection, but exclude it from connected output until `Active`.
- Failed asset: preserve metadata and show the upstream error; exclude it from connected output.
- Expired preview URL: refresh the asset/list endpoint; the stable `asset://` output is unaffected.
- Restart/reopen: restore profile, project, group, filters, tags, selection, and stable outputs from persisted node data; fetch fresh previews on demand.

## Security constraints

- No general runtime plugin loader or arbitrary `require()` from user-writable folders.
- No credential fields in frontend APIs, canvas data, logs, features, Skill, tests, or release notes.
- No absolute storage path in health/status responses.
- No explicit outbound `Host` header.
- Only allow-listed actions and bounded request fields reach the upstream API.
- Public import URLs must be HTTP(S); `file:`, loopback, private-network, data, and custom schemes are rejected before upstream submission.

## Verification

Automated verification covers deterministic signing, forbidden-header removal, allow-list and credential handling, route validation and secret/path redaction, response normalization, 15-item selection, active-only typed outputs, source-handle routing, canvas schema/registry/execution accounting, Volcengine-only `asset://` pass-through, theme/i18n catalogs, feature synchronization, TypeScript, public-source checks, production build, encrypted backend packaging, and Electron release gates.

## Release boundary

The feature ships as v3.0.4 from the core directory. Windows and macOS release metadata must describe one fixed source/tag. The user's instruction authorizes publishing before feedback evidence is collected, but technical build, encryption, provenance, automatic-update assets, tag/target, and post-upload download verification remain mandatory. Feedback-user installation and real-account Volcengine acceptance may be recorded later as explicitly deferred evidence; they are not claimed as passed.
