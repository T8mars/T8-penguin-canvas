import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AlertCircle, AudioLines, CheckCircle2, ChevronDown, CloudUpload, Image as ImageIcon, LibraryBig, Loader2, Plus, RefreshCw, Tags, Trash2, Video, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUpdateNodeData } from './useUpdateNodeData';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import { requestCanvasNodeRun } from '../../utils/canvasRunRequest';
import { PORT_COLOR } from '../../config/portTypes';
import * as api from '../../services/api';
import type { CloudUploadTargetConfig } from '../../types/canvas';
import {
  buildVolcengineAssetsNodeOutput,
  normalizeVolcengineAssetImportJob,
  normalizeVolcengineAssetImportJobs,
  normalizeVolcengineAssetGroups,
  normalizeVolcengineAssetItems,
  normalizePersistedVolcengineAssets,
  type VolcengineAssetImportJob,
  type VolcengineAssetGroup,
  type VolcengineAssetItem,
  type VolcengineAssetKind,
} from '../../utils/volcengineAssets';

const MAX_SELECTION = 15;

function localFileKind(file: File): 'Image' | 'Video' | 'Audio' | null {
  const mime = String(file.type || '').toLowerCase();
  const name = String(file.name || '').toLowerCase();
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif|tiff?)$/.test(name)) return 'Image';
  if (mime.startsWith('video/') || /\.(mp4|mov|webm|mkv|avi|m4v)$/.test(name)) return 'Video';
  if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|flac|aac)$/.test(name)) return 'Audio';
  return null;
}

function iconFor(kind: VolcengineAssetKind) {
  if (kind === 'video') return <Video size={15} />;
  if (kind === 'audio') return <AudioLines size={15} />;
  return <ImageIcon size={15} />;
}

const VolcengineAssetsNode = ({ id, data, selected }: NodeProps) => {
  const { t } = useTranslation('nodes');
  const update = useUpdateNodeData(id);
  const d = (data as any) || {};
  const profileId = String(d.volcengineAssetsProfileId || 'volcengine');
  const projectName = String(d.volcengineAssetsProjectName || '');
  const groupId = String(d.volcengineAssetsGroupId || '');
  const pageNumber = Math.max(1, Number(d.volcengineAssetsPageNumber) || 1);
  const relayTargetId = String(d.volcengineAssetsRelayTargetId || '');
  const [groups, setGroups] = useState<VolcengineAssetGroup[]>([]);
  const [assets, setAssets] = useState<VolcengineAssetItem[]>([]);
  const [previewById, setPreviewById] = useState<Record<string, string>>({});
  const [relayTargets, setRelayTargets] = useState<CloudUploadTargetConfig[]>([]);
  const [configured, setConfigured] = useState(false);
  const [resolvedProject, setResolvedProject] = useState('default');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importName, setImportName] = useState('');
  const [importKind, setImportKind] = useState<'Image' | 'Video' | 'Audio'>('Image');
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [localImportBusy, setLocalImportBusy] = useState(false);
  const [localImportProgress, setLocalImportProgress] = useState<number | null>(null);
  const [localImportStage, setLocalImportStage] = useState<'idle' | 'upload' | 'relay' | 'volcengine'>('idle');
  const localFileInputRef = useRef<HTMLInputElement>(null);
  const [importJobs, setImportJobs] = useState<VolcengineAssetImportJob[]>([]);
  const importJobAttempts = useRef(new Map<string, number>());
  const [tagDrafts, setTagDrafts] = useState<Record<string, string>>({});

  const selectedAssets = useMemo(() => normalizePersistedVolcengineAssets(d.selectedAssets), [d.selectedAssets]);
  const selectedIds = useMemo(() => new Set(selectedAssets.map((item) => item.id)), [selectedAssets]);

  const loadStatus = useCallback(async () => {
    const response = await api.getVolcengineAssetsStatus(profileId);
    if (!response.success) throw new Error(response.error || t('volcengineAssets.errors.status'));
    setConfigured(response.data.configured);
    setResolvedProject(response.data.project || 'default');
    update({
      volcengineAssetsConfigured: response.data.configured,
      volcengineAssetsResolvedProject: response.data.project,
      volcengineAssetsRegion: response.data.region,
    });
    return response.data;
  }, [profileId, t, update]);

  const loadGroups = useCallback(async () => {
    const response = await api.listVolcengineAssetGroups({ profileId, projectName });
    if (!response.success) throw new Error(response.error || t('volcengineAssets.errors.groups'));
    const normalized = normalizeVolcengineAssetGroups(response.data);
    setGroups(normalized);
    if (groupId && !normalized.some((group) => group.id === groupId)) update({ volcengineAssetsGroupId: '' });
    return normalized;
  }, [groupId, profileId, projectName, t, update]);

  const loadAssets = useCallback(async () => {
    const response = await api.listVolcengineAssets({ profileId, projectName, groupId, pageNumber, pageSize: 20 });
    if (!response.success) throw new Error(response.error || t('volcengineAssets.errors.assets'));
    let normalized = normalizeVolcengineAssetItems(response.data);
    if (normalized.length) {
      const tags = await api.getVolcengineAssetTags(normalized.map((item) => item.id));
      if (tags.success) normalized = normalizeVolcengineAssetItems(response.data, tags.data.assets);
    }
    setAssets(normalized);
    setPreviewById((current) => {
      const merged = { ...current };
      for (const item of normalized) {
        if (item.previewUrl) merged[item.id] = item.previewUrl;
      }
      const entries = Object.entries(merged);
      return entries.length > 120 ? Object.fromEntries(entries.slice(entries.length - 120)) : merged;
    });
    setTagDrafts(Object.fromEntries(normalized.map((item) => [item.id, item.tags.join(', ')])));
    return normalized;
  }, [groupId, pageNumber, profileId, projectName, t]);

  const loadRelayTargets = useCallback(async () => {
    const response = await api.getCloudUploadStatus();
    if (!response.success) throw new Error(response.error || t('volcengineAssets.errors.relayTargets'));
    const enabled = (response.data.targets || []).filter((target) => target.enabled);
    setRelayTargets(enabled);
    const preferred = enabled.some((target) => target.id === relayTargetId)
      ? relayTargetId
      : enabled.find((target) => target.id === response.data.summary?.defaultTargetId)?.id || enabled[0]?.id || '';
    if (preferred !== relayTargetId) update({ volcengineAssetsRelayTargetId: preferred });
    return enabled;
  }, [relayTargetId, t, update]);

  const loadImportJobs = useCallback(async (projectOverride?: string) => {
    const response = await api.listVolcengineAssetImportJobs({
      profileId,
      projectName: projectOverride || projectName || resolvedProject,
    });
    if (!response.success) throw new Error(response.error || t('volcengineAssets.errors.jobs'));
    const normalized = normalizeVolcengineAssetImportJobs(response.data);
    setImportJobs(normalized);
    return normalized;
  }, [profileId, projectName, resolvedProject, t]);

  const refreshImportJobs = useCallback(async (targets?: VolcengineAssetImportJob[]) => {
    const pending = (targets || importJobs).filter((job) => job.status === 'submitted' || job.status === 'processing');
    if (pending.length === 0) return importJobs;
    const responses = await Promise.all(pending.map(async (job) => ({
      job,
      response: await api.refreshVolcengineAssetImportJob(job.id, { profileId, projectName: job.projectName }),
    })));
    const updates = new Map<string, VolcengineAssetImportJob>();
    for (const { job, response } of responses) {
      importJobAttempts.current.set(job.id, (importJobAttempts.current.get(job.id) || 0) + 1);
      if (response.success) {
        const normalized = normalizeVolcengineAssetImportJob(response.data);
        if (normalized) updates.set(job.id, normalized);
      }
    }
    const activated = [...updates.values()].some((job) => job.status === 'active');
    setImportJobs((current) => current.map((job) => {
      const updated = updates.get(job.id);
      return updated || job;
    }));
    if (activated) await loadAssets();
    return [...updates.values()];
  }, [importJobs, loadAssets, profileId]);

  const refreshAll = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const status = await loadStatus();
      if (!status.configured) throw new Error(t('volcengineAssets.errors.notConfigured'));
      await loadGroups();
      await loadAssets();
      await loadImportJobs(projectName || status.project);
      update({ volcengineAssetsStatus: 'ready', status: 'success', error: '' });
    } catch (reason: any) {
      const message = reason?.message || t('volcengineAssets.errors.refresh');
      setError(message);
      update({ volcengineAssetsStatus: 'error', status: 'error', error: message });
      throw reason;
    } finally {
      setBusy(false);
    }
  }, [loadAssets, loadGroups, loadImportJobs, loadStatus, projectName, t, update]);

  useEffect(() => {
    void loadStatus().catch((reason) => setError(reason?.message || t('volcengineAssets.errors.status')));
  }, [loadStatus, t]);

  useEffect(() => {
    void loadRelayTargets().catch((reason) => setError(reason?.message || t('volcengineAssets.errors.relayTargets')));
  }, [loadRelayTargets, t]);

  useEffect(() => {
    const pending = importJobs.filter((job) => (
      (job.status === 'submitted' || job.status === 'processing')
      && (importJobAttempts.current.get(job.id) || 0) < 20
    ));
    if (pending.length === 0) return undefined;
    const timer = window.setTimeout(() => {
      void refreshImportJobs(pending).catch((reason) => setError(reason?.message || t('volcengineAssets.errors.jobs')));
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [importJobs, refreshImportJobs, t]);

  useRunTrigger(id, refreshAll, 'volcengine-assets', { lifecycleAware: true });

  const commitSelection = useCallback((next: VolcengineAssetItem[]) => {
    const output = buildVolcengineAssetsNodeOutput(next);
    update({
      ...output,
      volcengineAssetsStatus: 'ready',
      status: 'success',
      error: '',
    });
  }, [update]);

  const toggleAsset = useCallback((asset: VolcengineAssetItem) => {
    if (asset.status !== 'active') return;
    const current = normalizePersistedVolcengineAssets(d.selectedAssets);
    if (current.some((item) => item.id === asset.id)) {
      commitSelection(current.filter((item) => item.id !== asset.id));
      return;
    }
    if (current.length >= MAX_SELECTION) {
      setError(t('volcengineAssets.errors.maxSelection', { count: MAX_SELECTION }));
      return;
    }
    commitSelection([...current, asset]);
  }, [commitSelection, d, t]);

  const removeSelectedAsset = useCallback((assetId: string) => {
    const current = normalizePersistedVolcengineAssets(d.selectedAssets);
    commitSelection(current.filter((item) => item.id !== assetId));
  }, [commitSelection, d.selectedAssets]);

  const clearSelectedAssets = useCallback(() => {
    commitSelection([]);
  }, [commitSelection]);

  const createGroup = useCallback(async () => {
    if (!newGroupName.trim()) return;
    setBusy(true);
    setError('');
    const response = await api.createVolcengineAssetGroup({ profileId, projectName, name: newGroupName.trim() });
    setBusy(false);
    if (!response.success) return setError(response.error || t('volcengineAssets.errors.createGroup'));
    setNewGroupName('');
    await loadGroups().catch((reason) => setError(reason?.message || t('volcengineAssets.errors.groups')));
  }, [loadGroups, newGroupName, profileId, projectName, t]);

  const importAsset = useCallback(async () => {
    if (!groupId || !importUrl.trim()) {
      setError(t('volcengineAssets.errors.importFields'));
      return;
    }
    setBusy(true);
    setError('');
    const response = await api.importVolcengineAsset({
      profileId, projectName, groupId, kind: importKind, url: importUrl.trim(), name: importName.trim() || undefined,
    });
    setBusy(false);
    if (!response.success) return setError(response.error || t('volcengineAssets.errors.import'));
    const job = normalizeVolcengineAssetImportJob(response.data);
    if (job) {
      importJobAttempts.current.set(job.id, 0);
      setImportJobs((current) => [job, ...current.filter((item) => item.id !== job.id)].slice(0, 100));
    }
    setImportUrl('');
    setImportName('');
    if (job?.status === 'active') await loadAssets().catch((reason) => setError(reason?.message || t('volcengineAssets.errors.assets')));
  }, [groupId, importKind, importName, importUrl, loadAssets, profileId, projectName, t]);

  const importLocalAsset = useCallback(async () => {
    const kind = localFile ? localFileKind(localFile) : null;
    if (!groupId || !localFile || !kind || !relayTargetId) {
      setError(t('volcengineAssets.errors.localImportFields'));
      return;
    }
    setLocalImportBusy(true);
    setLocalImportProgress(0);
    setLocalImportStage('upload');
    setError('');
    try {
      const local = await api.uploadResourceLocalFile(localFile, {
        sourceNodeId: id,
        sourceNodeType: 'volcengine-assets',
      }, {
        onProgress: (progress) => setLocalImportProgress(progress.percent),
      });
      setLocalImportStage('relay');
      setLocalImportProgress(null);
      const relayed = await api.uploadCloudAsset({
        targetId: relayTargetId,
        url: local.url,
        kind: kind.toLowerCase(),
        filename: localFile.name,
        title: importName.trim() || localFile.name,
        sourceNodeId: id,
      });
      if (!relayed.success) throw new Error(relayed.error || t('volcengineAssets.errors.relayUpload'));
      if (!relayed.data?.url) throw new Error(t('volcengineAssets.errors.relayUpload'));
      setLocalImportStage('volcengine');
      const response = await api.importVolcengineAsset({
        profileId,
        projectName,
        groupId,
        kind,
        url: relayed.data.url,
        name: importName.trim() || localFile.name,
      });
      if (!response.success) throw new Error(response.error || t('volcengineAssets.errors.import'));
      const job = normalizeVolcengineAssetImportJob(response.data);
      if (job) {
        importJobAttempts.current.set(job.id, 0);
        setImportJobs((current) => [job, ...current.filter((item) => item.id !== job.id)].slice(0, 100));
      }
      setLocalFile(null);
      setImportName('');
      if (localFileInputRef.current) localFileInputRef.current.value = '';
      if (job?.status === 'active') await loadAssets();
    } catch (reason: any) {
      setError(reason?.message || t('volcengineAssets.errors.localImport'));
    } finally {
      setLocalImportBusy(false);
      setLocalImportProgress(null);
      setLocalImportStage('idle');
    }
  }, [groupId, id, importName, loadAssets, localFile, profileId, projectName, relayTargetId, t]);

  const saveTags = useCallback(async (assetId: string) => {
    const tags = String(tagDrafts[assetId] || '').split(/[,，\n]/).map((value) => value.trim()).filter(Boolean);
    const response = await api.saveVolcengineAssetTags(assetId, tags);
    if (!response.success) return setError(response.error || t('volcengineAssets.errors.tags'));
    setAssets((current) => current.map((item) => item.id === assetId ? { ...item, tags: response.data.tags } : item));
    const current = normalizePersistedVolcengineAssets(d.selectedAssets).map((item) => item.id === assetId ? { ...item, tags: response.data.tags } : item);
    commitSelection(current);
  }, [commitSelection, d, t, tagDrafts]);

  const effectiveProject = projectName || resolvedProject;

  return (
    <div
      className="t8-node w-[620px] overflow-hidden"
      data-volcengine-assets-node
      style={{
        borderColor: selected ? '#f97316' : 'var(--t8-border-strong)',
        boxShadow: selected ? '0 0 0 2px rgba(249,115,22,.24)' : undefined,
      }}
    >
      <Handle type="source" position={Position.Right} id="image" style={{ top: '42%', background: PORT_COLOR.image, border: '1px solid var(--t8-bg-node)' }} />
      <Handle type="source" position={Position.Right} id="video" style={{ top: '54%', background: PORT_COLOR.video, border: '1px solid var(--t8-bg-node)' }} />
      <Handle type="source" position={Position.Right} id="audio" style={{ top: '66%', background: PORT_COLOR.audio, border: '1px solid var(--t8-bg-node)' }} />

      <div className="t8-node-header flex items-center gap-2 px-3 py-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: '#ffedd5', color: '#c2410c' }}><LibraryBig size={19} /></div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold">{t('volcengineAssets.title')}</div>
          <div className="truncate text-[10px]" style={{ color: 'var(--t8-text-muted)' }}>{t('volcengineAssets.subtitle', { project: effectiveProject })}</div>
        </div>
        <div className="flex items-center gap-1 text-[10px]" style={{ color: configured ? '#16a34a' : '#f59e0b' }}>
          {configured ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
          {configured ? t('volcengineAssets.configured') : t('volcengineAssets.notConfigured')}
        </div>
      </div>

      <div className="nodrag nowheel space-y-2 p-3" onPointerDown={(event) => event.stopPropagation()} onWheelCapture={(event) => event.stopPropagation()}>
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <input className="t8-input px-2 py-1.5 text-xs" value={projectName} onChange={(event) => update({ volcengineAssetsProjectName: event.target.value, volcengineAssetsPageNumber: 1 })} placeholder={t('volcengineAssets.projectPlaceholder')} />
          <select className="t8-select px-2 py-1.5 text-xs" value={groupId} onChange={(event) => update({ volcengineAssetsGroupId: event.target.value, volcengineAssetsPageNumber: 1 })}>
            <option value="">{t('volcengineAssets.allGroups')}</option>
            {groups.map((group) => <option key={group.id} value={group.id}>{group.name || group.id}</option>)}
          </select>
          <button type="button" className="t8-btn min-h-8 px-2 text-xs" onClick={() => requestCanvasNodeRun(id)} disabled={busy} title={t('volcengineAssets.refresh')}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input className="t8-input px-2 py-1.5 text-xs" value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} placeholder={t('volcengineAssets.newGroupPlaceholder')} />
          <button type="button" className="t8-btn min-h-8 px-3 text-xs" onClick={() => void createGroup()} disabled={busy || !newGroupName.trim()}><Plus size={13} />{t('volcengineAssets.createGroup')}</button>
        </div>

        <button type="button" className="t8-btn flex min-h-8 w-full items-center justify-between px-2 text-xs" onClick={() => setImportOpen((value) => !value)}>
          <span>{t('volcengineAssets.importPublicUrl')}</span><ChevronDown size={14} style={{ transform: importOpen ? 'rotate(180deg)' : undefined }} />
        </button>
        {importOpen && (
          <div className="space-y-2 rounded-lg border p-2" style={{ borderColor: 'var(--t8-border)', background: 'var(--t8-bg-soft)' }}>
            <input className="t8-input w-full px-2 py-1.5 text-xs" value={importUrl} onChange={(event) => setImportUrl(event.target.value)} placeholder={t('volcengineAssets.publicUrlPlaceholder')} />
            <div className="grid grid-cols-[1fr_110px_auto] gap-2">
              <input className="t8-input px-2 py-1.5 text-xs" value={importName} onChange={(event) => setImportName(event.target.value)} placeholder={t('volcengineAssets.nameOptional')} />
              <select className="t8-select px-2 py-1.5 text-xs" value={importKind} onChange={(event) => setImportKind(event.target.value as any)}>
                <option value="Image">{t('volcengineAssets.kinds.image')}</option><option value="Video">{t('volcengineAssets.kinds.video')}</option><option value="Audio">{t('volcengineAssets.kinds.audio')}</option>
              </select>
              <button type="button" className="t8-btn t8-btn-primary min-h-8 px-3 text-xs" onClick={() => void importAsset()} disabled={busy}>{t('volcengineAssets.import')}</button>
            </div>
            <div className="text-[10px]" style={{ color: 'var(--t8-text-muted)' }}>{t('volcengineAssets.importHint')}</div>
            <div className="border-t pt-2" style={{ borderColor: 'var(--t8-border)' }}>
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold">
                <CloudUpload size={13} />
                <span>{t('volcengineAssets.localRelayTitle')}</span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <select
                  className="t8-select min-w-0 px-2 py-1.5 text-xs"
                  value={relayTargetId}
                  onChange={(event) => update({ volcengineAssetsRelayTargetId: event.target.value })}
                  disabled={localImportBusy || relayTargets.length === 0}
                  aria-label={t('volcengineAssets.relayTarget')}
                >
                  <option value="">{relayTargets.length ? t('volcengineAssets.selectRelayTarget') : t('volcengineAssets.noRelayTargets')}</option>
                  {relayTargets.map((target) => (
                    <option key={target.id} value={target.id}>{target.label || target.id}</option>
                  ))}
                </select>
                <button type="button" className="t8-btn min-h-8 px-3 text-xs" onClick={() => localFileInputRef.current?.click()} disabled={localImportBusy}>
                  <Plus size={13} />{t('volcengineAssets.chooseLocalFile')}
                </button>
                <input
                  ref={localFileInputRef}
                  type="file"
                  className="hidden"
                  accept="image/*,video/*,audio/*,.mkv,.m4v,.flac,.aac"
                  onChange={(event) => {
                    const file = event.target.files?.[0] || null;
                    const kind = file ? localFileKind(file) : null;
                    if (file && !kind) {
                      setLocalFile(null);
                      setError(t('volcengineAssets.errors.unsupportedLocalFile'));
                      event.target.value = '';
                      return;
                    }
                    setLocalFile(file);
                    if (kind) setImportKind(kind);
                    setError('');
                  }}
                />
              </div>
              {localFile && (
                <div className="mt-2 flex items-center gap-2 rounded-md border px-2 py-1.5 text-[10px]" style={{ borderColor: 'var(--t8-border)', background: 'var(--t8-bg-node)' }}>
                  <span className="min-w-0 flex-1 truncate">{localFile.name}</span>
                  <span style={{ color: 'var(--t8-text-muted)' }}>{t(`volcengineAssets.kinds.${String(localFileKind(localFile) || 'Image').toLowerCase()}`)}</span>
                  <button
                    type="button"
                    className="t8-btn min-h-6 px-1.5"
                    onClick={() => {
                      setLocalFile(null);
                      if (localFileInputRef.current) localFileInputRef.current.value = '';
                    }}
                    disabled={localImportBusy}
                    aria-label={t('volcengineAssets.removeLocalFile')}
                  ><X size={11} /></button>
                </div>
              )}
              <button
                type="button"
                className="t8-btn t8-btn-primary mt-2 min-h-8 w-full px-3 text-xs"
                onClick={() => void importLocalAsset()}
                disabled={localImportBusy || !groupId || !relayTargetId || !localFile}
              >
                {localImportBusy ? <Loader2 size={13} className="animate-spin" /> : <CloudUpload size={13} />}
                {localImportBusy
                  ? t(`volcengineAssets.localStages.${localImportStage}`, { progress: localImportProgress ?? 0 })
                  : t('volcengineAssets.importLocal')}
              </button>
              <div className="mt-1.5 text-[10px]" style={{ color: 'var(--t8-text-muted)' }}>
                {relayTargets.length === 0 ? t('volcengineAssets.relaySetupHint') : t('volcengineAssets.localRelayHint')}
              </div>
            </div>
            {importJobs.length > 0 && (
              <div className="space-y-1 rounded-md border p-2" style={{ borderColor: 'var(--t8-border)', background: 'var(--t8-bg-node)' }}>
                <div className="flex items-center justify-between text-[10px] font-bold">
                  <span>{t('volcengineAssets.importJobs')}</span>
                  <button type="button" className="t8-btn min-h-6 px-2 text-[9px]" onClick={() => void refreshImportJobs()}>{t('volcengineAssets.refreshJobs')}</button>
                </div>
                {importJobs.slice(0, 3).map((job) => (
                  <div key={job.id} className="flex items-center gap-2 text-[10px]" style={{ color: job.status === 'failed' ? '#ef4444' : job.status === 'active' ? '#16a34a' : 'var(--t8-text-muted)' }}>
                    <span className="min-w-0 flex-1 truncate">{job.name || job.assetId || t('volcengineAssets.unnamedImport')}</span>
                    <span>{t(`volcengineAssets.jobStatus.${job.status}`)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between text-[10px]" style={{ color: 'var(--t8-text-muted)' }}>
          <span>{t('volcengineAssets.selection', { selected: selectedAssets.length, max: MAX_SELECTION })}</span>
          <span>{t('volcengineAssets.page', { page: pageNumber })}</span>
        </div>
        <div
          className="rounded-lg border p-2"
          data-volcengine-selected-assets
          style={{ borderColor: 'var(--t8-border)', background: 'var(--t8-bg-soft)' }}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-[11px] font-bold">{t('volcengineAssets.selectedTray', { count: selectedAssets.length })}</div>
            <button
              type="button"
              className="t8-btn min-h-7 px-2 text-[10px]"
              onClick={clearSelectedAssets}
              disabled={selectedAssets.length === 0}
            ><Trash2 size={11} />{t('volcengineAssets.clearSelection')}</button>
          </div>
          {selectedAssets.length === 0 ? (
            <div className="rounded-md border border-dashed px-3 py-5 text-center text-[10px]" style={{ borderColor: 'var(--t8-border)', color: 'var(--t8-text-dim)' }}>
              {t('volcengineAssets.selectedTrayEmpty')}
            </div>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {selectedAssets.map((asset) => {
                const previewUrl = previewById[asset.id] || '';
                return (
                  <div key={asset.id} className="relative w-24 shrink-0 overflow-hidden rounded-md border" style={{ borderColor: 'var(--t8-border)', background: 'var(--t8-bg-node)' }}>
                    <div className="flex h-16 items-center justify-center overflow-hidden">
                      {asset.kind === 'image' && previewUrl
                        ? <img src={previewUrl} alt={asset.name} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                        : asset.kind === 'video' && previewUrl
                          ? <video src={previewUrl} className="h-full w-full object-cover" muted preload="metadata" />
                          : <div className="flex flex-col items-center gap-1 text-[9px]" style={{ color: 'var(--t8-text-muted)' }}>{iconFor(asset.kind)}{t(`volcengineAssets.kinds.${asset.kind}`)}</div>}
                    </div>
                    <div className="truncate border-t px-1.5 py-1 text-[9px]" style={{ borderColor: 'var(--t8-border)' }} title={asset.name}>{asset.name}</div>
                    <button
                      type="button"
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full border"
                      style={{ borderColor: 'var(--t8-border-strong)', background: 'var(--t8-bg-node)', color: 'var(--t8-text)' }}
                      onClick={() => removeSelectedAsset(asset.id)}
                      aria-label={t('volcengineAssets.removeSelected', { name: asset.name })}
                    ><X size={11} /></button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="grid max-h-[360px] grid-cols-2 gap-2 overflow-auto pr-1">
          {assets.length === 0 ? (
            <div className="col-span-2 rounded-lg border border-dashed px-3 py-10 text-center text-xs" style={{ borderColor: 'var(--t8-border)', color: 'var(--t8-text-dim)' }}>{t('volcengineAssets.empty')}</div>
          ) : assets.map((asset) => {
            const active = selectedIds.has(asset.id);
            return (
              <div key={asset.id} className="overflow-hidden rounded-lg border" style={{ borderColor: active ? '#f97316' : 'var(--t8-border)', background: active ? 'rgba(249,115,22,.08)' : 'var(--t8-bg-soft)' }}>
                <button type="button" className="w-full text-left" onClick={() => toggleAsset(asset)} disabled={asset.status !== 'active'}>
                  <div className="flex h-24 items-center justify-center overflow-hidden" style={{ background: 'var(--t8-bg-node)' }}>
                    {asset.kind === 'image' && asset.previewUrl
                      ? <img src={asset.previewUrl} alt={asset.name} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                      : <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--t8-text-muted)' }}>{iconFor(asset.kind)}{t(`volcengineAssets.kinds.${asset.kind}`)}</div>}
                  </div>
                  <div className="space-y-1 p-2">
                    <div className="flex items-center gap-1 text-xs font-bold"><span className="min-w-0 flex-1 truncate">{asset.name}</span><span className="text-[9px]" style={{ color: asset.status === 'active' ? '#16a34a' : asset.status === 'failed' ? '#ef4444' : '#f59e0b' }}>{t(`volcengineAssets.status.${asset.status}`)}</span></div>
                    <div className="truncate text-[9px]" style={{ color: 'var(--t8-text-dim)' }}>{asset.assetUri}</div>
                  </div>
                </button>
                <div className="flex gap-1 border-t p-1.5" style={{ borderColor: 'var(--t8-border)' }}>
                  <input className="t8-input min-w-0 flex-1 px-1.5 py-1 text-[10px]" value={tagDrafts[asset.id] || ''} onChange={(event) => setTagDrafts((current) => ({ ...current, [asset.id]: event.target.value }))} placeholder={t('volcengineAssets.tagsPlaceholder')} />
                  <button type="button" className="t8-btn min-h-7 px-2" onClick={() => void saveTags(asset.id)} title={t('volcengineAssets.saveTags')}><Tags size={12} /></button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="t8-btn min-h-8 text-xs" disabled={busy || pageNumber <= 1} onClick={() => update({ volcengineAssetsPageNumber: pageNumber - 1 })}>{t('volcengineAssets.previous')}</button>
          <button type="button" className="t8-btn min-h-8 text-xs" disabled={busy || assets.length < 20} onClick={() => update({ volcengineAssetsPageNumber: pageNumber + 1 })}>{t('volcengineAssets.next')}</button>
        </div>

        {(error || d.error) && <div className="rounded-lg border px-2 py-1.5 text-[11px]" style={{ borderColor: '#ef444466', color: '#ef4444' }}>{error || d.error}</div>}
        <div className="text-[10px]" style={{ color: 'var(--t8-text-muted)' }}>{t('volcengineAssets.securityHint')}</div>
      </div>
    </div>
  );
};

export default memo(VolcengineAssetsNode);
