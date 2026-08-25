import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import MonoformStudio, { MONOFORM_SOURCE_URL } from './MonoformStudio.jsx';
import studioCss from './monoform-studio.css?inline';

export interface PrevisImageExport {
  blob: Blob;
  width: number;
  height: number;
  frame: number;
  fps: number;
  aspectRatio: string;
}

export interface PrevisVideoExport {
  blob: Blob;
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  durationSeconds: number;
  aspectRatio: string;
  codec: 'h264';
  hasAudio: false;
}

export interface PrevisStudioEditorHandle {
  getProject: () => Record<string, unknown> | null;
  exportImage: () => Promise<PrevisImageExport>;
  exportVideo: () => Promise<PrevisVideoExport>;
  cancelExport: () => void;
  saveProject: () => void;
}

interface PrevisStudioEditorProps {
  initialProject?: Record<string, unknown> | null;
  storageKey: string;
  projectTitle: string;
  onProjectChange: (project: Record<string, unknown>) => void;
  onImportAsset: (file: File) => Promise<string>;
  onRequestRun: (kind: 'image' | 'video') => void;
  onReady?: () => void;
  onClose: () => void;
}

const PrevisStudioEditor = forwardRef<PrevisStudioEditorHandle, PrevisStudioEditorProps>((props, forwardedRef) => {
  const { t } = useTranslation('nodes');
  const hostRef = useRef<HTMLDivElement | null>(null);
  const studioRef = useRef<PrevisStudioEditorHandle | null>(null);
  const [shadowRoot, setShadowRoot] = useState<ShadowRoot | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    setShadowRoot(root);
  }, []);

  useEffect(() => {
    if (!shadowRoot) return;
    const onClick = (event: Event) => {
      const path = event.composedPath();
      const anchor = path.find((item): item is HTMLAnchorElement => item instanceof HTMLAnchorElement);
      if (!anchor || anchor.href !== MONOFORM_SOURCE_URL) return;
      event.preventDefault();
      if (window.t8pc?.openExternal) {
        void window.t8pc.openExternal(MONOFORM_SOURCE_URL);
      } else {
        window.open(MONOFORM_SOURCE_URL, '_blank', 'noopener,noreferrer');
      }
    };
    shadowRoot.addEventListener('click', onClick);
    return () => shadowRoot.removeEventListener('click', onClick);
  }, [shadowRoot]);

  useEffect(() => {
    if (!shadowRoot) return;
    let frame = 0;
    const check = () => {
      if (studioRef.current) props.onReady?.();
      else frame = window.requestAnimationFrame(check);
    };
    frame = window.requestAnimationFrame(check);
    return () => window.cancelAnimationFrame(frame);
  }, [shadowRoot, props.onReady]);

  useImperativeHandle(forwardedRef, () => ({
    getProject: () => studioRef.current?.getProject() || null,
    exportImage: async () => {
      if (!studioRef.current) throw new Error(t('previs.notReady'));
      return studioRef.current.exportImage();
    },
    exportVideo: async () => {
      if (!studioRef.current) throw new Error(t('previs.notReady'));
      return studioRef.current.exportVideo();
    },
    cancelExport: () => studioRef.current?.cancelExport(),
    saveProject: () => studioRef.current?.saveProject(),
  }), [t]);

  return (
    <div
      ref={hostRef}
      className="nodrag nowheel"
      style={{ position: 'fixed', inset: 0, zIndex: 10050, background: '#181817' }}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      aria-label={t('previs.fullWorkbenchAria')}
    >
      {shadowRoot && createPortal(
        <>
          <style>{studioCss}</style>
          <MonoformStudio
            ref={studioRef}
            initialProject={props.initialProject}
            storageKey={props.storageKey}
            projectTitle={props.projectTitle}
            onProjectChange={props.onProjectChange}
            onImportAsset={props.onImportAsset}
            onRequestRun={props.onRequestRun}
            onClose={props.onClose}
          />
        </>,
        shadowRoot,
      )}
    </div>
  );
});

PrevisStudioEditor.displayName = 'PrevisStudioEditor';

export default PrevisStudioEditor;
