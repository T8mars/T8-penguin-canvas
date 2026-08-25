import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, Loader2, RefreshCw, RotateCcw, X } from 'lucide-react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

interface AppUpdaterButtonProps {
  isPixel: boolean;
  isDark: boolean;
}

const fallbackStatus: T8UpdaterStatus = {
  status: 'idle',
  currentVersion: '',
  availableVersion: null,
  messageKey: 'updater.labels.check',
  messageParams: {},
  message: null,
  progress: null,
  downloaded: false,
  error: null,
  packaged: false,
  updatedAt: null,
};

type T8DesktopInfo = Awaited<ReturnType<NonNullable<Window['t8pc']>['getInfo']>>;

function isElectronUserAgent(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /\bElectron\//i.test(navigator.userAgent);
}

function bridgeUnavailableStatus(t: TFunction<'electron'>, info?: Partial<T8DesktopInfo> | null): T8UpdaterStatus {
  const packaged = info?.packaged ?? isElectronUserAgent();
  const isPackagedDesktop = packaged !== false;
  const messageKey = isPackagedDesktop ? 'updater.bridgeMissing' : 'updater.disabled';
  return {
    ...fallbackStatus,
    status: isPackagedDesktop ? 'error' : 'disabled',
    currentVersion: info?.version || fallbackStatus.currentVersion,
    packaged: Boolean(packaged),
    messageKey,
    messageParams: {},
    message: t(messageKey),
    error: null,
    updatedAt: new Date().toISOString(),
  };
}

function statusTone(status: T8UpdaterStatusCode): 'idle' | 'busy' | 'good' | 'warn' | 'bad' {
  if (status === 'checking' || status === 'downloading' || status === 'installing') return 'busy';
  if (status === 'available' || status === 'downloaded') return 'warn';
  if (status === 'not-available') return 'good';
  if (status === 'error') return 'bad';
  return 'idle';
}

function statusLabel(status: T8UpdaterStatus, t: TFunction<'electron'>): string {
  if (status.status === 'checking') return t('updater.labels.checking');
  if (status.status === 'available') return t('updater.labels.available');
  if (status.status === 'downloading') {
    const percent = status.progress?.percent ?? 0;
    return `${Math.max(0, Math.min(100, percent)).toFixed(0)}%`;
  }
  if (status.status === 'downloaded') return t('updater.labels.downloaded');
  if (status.status === 'installing') return t('updater.labels.installing');
  if (status.status === 'not-available') return t('updater.labels.update');
  if (status.status === 'error') return t('updater.labels.failed');
  if (status.status === 'disabled') return t('updater.labels.desktop');
  return t('updater.labels.update');
}

function primaryLabel(status: T8UpdaterStatus, t: TFunction<'electron'>): string {
  if (status.status === 'available') return t('updater.labels.download');
  if (status.status === 'downloaded' || status.downloaded) return t('updater.labels.openInstaller');
  if (status.status === 'checking') return t('updater.labels.checking');
  if (status.status === 'downloading') return t('updater.labels.downloading');
  return t('updater.labels.check');
}

function PrimaryIcon({ status, size }: { status: T8UpdaterStatusCode; size: number }) {
  if (status === 'checking' || status === 'downloading' || status === 'installing') {
    return <Loader2 size={size} className="animate-spin" />;
  }
  if (status === 'available') return <Download size={size} />;
  if (status === 'downloaded') return <RotateCcw size={size} />;
  if (status === 'not-available') return <CheckCircle2 size={size} />;
  if (status === 'error') return <AlertTriangle size={size} />;
  return <RefreshCw size={size} />;
}

export default function AppUpdaterButton({ isPixel, isDark }: AppUpdaterButtonProps) {
  const { t } = useTranslation('electron');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<T8UpdaterStatus>(fallbackStatus);
  const hasUpdater = typeof window !== 'undefined' && Boolean(window.t8pc?.updater);
  const desktopShellDetected =
    hasUpdater ||
    (typeof window !== 'undefined' && Boolean(window.t8pc?.getInfo || window.t8pc?.openExternal)) ||
    isElectronUserAgent();

  useEffect(() => {
    if (!hasUpdater || !window.t8pc?.updater) return;
    let mounted = true;
    window.t8pc.updater.getStatus()
      .then((next) => {
        if (mounted && next) setStatus(next);
      })
      .catch(() => {});
    const unsubscribe = window.t8pc.updater.onStatus((next) => {
      setStatus((prev) => ({ ...prev, ...next }));
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [hasUpdater]);

  useEffect(() => {
    if (!desktopShellDetected || hasUpdater) return;
    let mounted = true;
    const getInfo = window.t8pc?.getInfo;
    if (!getInfo) {
      setStatus(bridgeUnavailableStatus(t));
      return () => {
        mounted = false;
      };
    }
    getInfo()
      .then((info) => {
        if (mounted) setStatus(bridgeUnavailableStatus(t, info));
      })
      .catch(() => {
        if (mounted) setStatus(bridgeUnavailableStatus(t));
      });
    return () => {
      mounted = false;
    };
  }, [desktopShellDetected, hasUpdater, t]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current && !rootRef.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const tone = statusTone(status.status);
  const progressPercent = Math.max(0, Math.min(100, status.progress?.percent ?? 0));
  const nextVersion = status.availableVersion ? `v${status.availableVersion}` : null;
  const localizedStatusMessage = status.messageKey
    ? t(status.messageKey as any, status.messageParams || {})
    : status.message;
  const detailText = localizedStatusMessage || t('updater.idle');
  const technicalError = status.error && status.error !== detailText ? status.error : null;
  const updaterUnavailable = desktopShellDetected && !hasUpdater;
  const disabled =
    updaterUnavailable ||
    busy ||
    status.status === 'checking' ||
    status.status === 'downloading' ||
    status.status === 'installing';

  const buttonClass = useMemo(() => {
    if (isPixel) {
      if (tone === 'warn') return 'px-btn px-btn--sm px-btn--yellow';
      if (tone === 'bad') return 'px-btn px-btn--sm px-btn--pink';
      if (tone === 'good') return 'px-btn px-btn--sm px-btn--mint';
      return 'px-btn px-btn--sm px-btn--ghost';
    }
    const base = 'flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors border';
    if (tone === 'warn') {
      return `${base} ${
        isDark
          ? 'bg-sky-500/10 border-sky-500/35 text-sky-200 hover:bg-sky-500/20'
          : 'bg-sky-50 border-sky-300 text-sky-700 hover:bg-sky-100'
      }`;
    }
    if (tone === 'bad') {
      return `${base} ${
        isDark
          ? 'bg-rose-500/10 border-rose-500/35 text-rose-300 hover:bg-rose-500/20'
          : 'bg-rose-50 border-rose-300 text-rose-700 hover:bg-rose-100'
      }`;
    }
    if (tone === 'good') {
      return `${base} ${
        isDark
          ? 'bg-emerald-500/10 border-emerald-500/35 text-emerald-300 hover:bg-emerald-500/20'
          : 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100'
      }`;
    }
    return `${base} ${isDark ? 'border-white/10 text-white/70 hover:bg-white/10' : 'border-black/10 text-zinc-600 hover:bg-black/5'}`;
  }, [isDark, isPixel, tone]);

  if (!desktopShellDetected) return null;

  const callUpdater = async (action: 'check' | 'download' | 'install') => {
    const api = window.t8pc?.updater;
    if (!api) {
      setStatus((prev) => {
        const next = bridgeUnavailableStatus(t, {
          packaged: prev.packaged ?? true,
          version: prev.currentVersion,
        });
        return {
          ...next,
          status: prev.status === 'disabled' ? 'disabled' : next.status,
          message: prev.status === 'disabled' ? prev.message : next.message,
        };
      });
      setOpen(true);
      return;
    }
    setBusy(true);
    try {
      const result = await api[action]();
      if (result?.status) setStatus((prev) => ({ ...prev, ...result.status }));
    } finally {
      setBusy(false);
    }
  };

  const onPrimaryAction = () => {
    if (status.status === 'available') {
      void callUpdater('download');
      return;
    }
    if (status.status === 'downloaded' || status.downloaded) {
      void callUpdater('install');
      return;
    }
    void callUpdater('check');
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={buttonClass}
        title={detailText || t('updater.automatic')}
      >
        <PrimaryIcon status={status.status} size={isPixel ? 12 : 14} />
        <span className="text-[11px]">{statusLabel(status, t)}</span>
      </button>

      {open && (
        <div
          className={
            isPixel
              ? 'absolute right-0 top-full z-[70] mt-2 w-[280px] px-panel rounded-2xl p-3'
              : `absolute right-0 top-full z-[70] mt-2 w-[280px] rounded-xl border p-3 shadow-2xl backdrop-blur-md ${
                  isDark
                    ? 'border-white/10 bg-zinc-950/95 text-white shadow-black/30'
                    : 'border-zinc-200 bg-white/95 text-zinc-900 shadow-zinc-300/50'
                }`
          }
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className={`text-[12px] font-bold ${isPixel ? 'px-title' : ''}`}>{t('updater.panelTitle')}</div>
              <div className={isPixel ? 'mt-1 text-[10px]' : `mt-1 text-[11px] ${isDark ? 'text-white/60' : 'text-zinc-500'}`}>
                {t('updater.currentVersion', { version: status.currentVersion || '...' })}{nextVersion ? ` / ${nextVersion}` : ''}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={isPixel ? 'px-btn px-btn--icon px-btn--ghost' : `rounded-md p-1 ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
              title={t('updater.close')}
            >
              <X size={14} />
            </button>
          </div>

          <div className={isPixel ? 'mt-3 text-[11px]' : `mt-3 text-[12px] leading-relaxed ${isDark ? 'text-white/75' : 'text-zinc-700'}`}>
            {detailText}
          </div>
          {technicalError && (
            <div className={isPixel ? 'mt-2 break-words text-[9px] opacity-60' : `mt-2 break-words text-[10px] ${isDark ? 'text-white/45' : 'text-zinc-400'}`}>
              {technicalError}
            </div>
          )}

          {status.status === 'downloading' && (
            <div className={isPixel ? 'mt-3 h-2 overflow-hidden rounded-full bg-black/20' : `mt-3 h-2 overflow-hidden rounded-full ${isDark ? 'bg-white/10' : 'bg-zinc-100'}`}>
              <div
                className={isPixel ? 'h-full bg-cyan-300' : 'h-full bg-sky-500 transition-[width]'}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          )}

          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => void callUpdater('check')}
              disabled={disabled}
              className={
                isPixel
                  ? 'px-btn px-btn--sm px-btn--ghost'
                  : `rounded-md border px-2.5 py-1.5 text-[11px] font-medium ${
                      isDark
                        ? 'border-white/10 text-white/70 hover:bg-white/10 disabled:opacity-50'
                        : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-50'
                    }`
              }
            >
              {t('updater.labels.check')}
            </button>
            <button
              type="button"
              onClick={onPrimaryAction}
              disabled={disabled}
              className={
                isPixel
                  ? 'px-btn px-btn--sm px-btn--mint'
                  : `inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-semibold ${
                      isDark
                        ? 'bg-sky-500/20 text-sky-100 hover:bg-sky-500/30 disabled:opacity-50'
                        : 'bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50'
                    }`
              }
            >
              <PrimaryIcon status={status.status} size={12} />
              {primaryLabel(status, t)}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
