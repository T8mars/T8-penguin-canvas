import { useLayoutEffect, useRef, type CSSProperties, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import * as Icons from 'lucide-react';
import { NODE_REGISTRY } from '../config/nodeRegistry';
import type { NodeType } from '../types/canvas';

const COLORS: Record<string, string> = {
  sky: '#7dd3fc', amber: '#fcd34d', rose: '#fda4af', fuchsia: '#f0abfc',
  violet: '#c4b5fd', emerald: '#6ee7b7', cyan: '#67e8f9', indigo: '#a5b4fc',
  orange: '#fdba74', pink: '#f9a8d4', slate: '#cbd5e1', teal: '#5eead4',
};

/** Stay inside both the visible canvas and viewport; the catalog itself scrolls. */
export default function CanvasQuickAddMenu({ point, containerRef, onClose, onAdd }: {
  point: { x: number; y: number };
  containerRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onAdd: (type: NodeType, point: { x: number; y: number }) => void;
}) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const container = containerRef.current;
    if (!menu || !container) return;
    const position = () => {
      const rect = container.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = Math.max(rect.left, viewport?.offsetLeft || 0) + 8;
      const top = Math.max(rect.top, viewport?.offsetTop || 0) + 8;
      const right = Math.min(rect.right, (viewport?.offsetLeft || 0) + (viewport?.width || window.innerWidth)) - 8;
      const bottom = Math.min(rect.bottom, (viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight)) - 8;
      menu.style.width = `${Math.max(1, Math.min(200, right - left))}px`;
      menu.style.maxHeight = `${Math.max(1, bottom - top)}px`;
      const size = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(left, Math.min(point.x, right - size.width))}px`;
      menu.style.top = `${Math.max(top, Math.min(point.y, bottom - size.height))}px`;
    };
    position();
    menu.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    const observer = new ResizeObserver(position);
    observer.observe(container); observer.observe(menu);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    window.visualViewport?.addEventListener('resize', position);
    return () => {
      observer.disconnect(); window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      window.visualViewport?.removeEventListener('resize', position);
    };
  }, [point, containerRef]);
  return <>
    <div data-canvas-floating-ui="pane-menu-backdrop" className="fixed inset-0 z-30"
      onClick={onClose} onContextMenu={event => { event.preventDefault(); onClose(); }} />
    <div ref={menuRef} data-canvas-floating-ui="pane-menu" role="menu" aria-label={t('canvas:quickAddTitle')}
      className="fixed z-40 t8-context-menu t8-context-menu--quick-add nodrag nowheel"
      onWheel={event => event.stopPropagation()}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}>
      <div className="t8-context-menu__header">{t('canvas:quickAddTitle')}</div>
      <div className="t8-context-menu__scroll" data-quick-add-scroll>
        {NODE_REGISTRY.filter(meta => meta.category === 'input' || meta.category === 'core').map(meta => {
          const Icon = (Icons as any)[meta.icon] || Icons.Box;
          return <button type="button" role="menuitem" key={meta.type} className="t8-context-menu__item"
            onClick={() => { onClose(); onAdd(meta.type as NodeType, point); }}>
            <span className="t8-context-menu__node-icon" style={{ '--t8-menu-icon-color': COLORS[meta.color] || COLORS.slate } as CSSProperties}>
              <Icon size={13} />
            </span><span className="flex-1 truncate">{t(meta.labelKey as any, { defaultValue: meta.label })}</span>
          </button>;
        })}
      </div>
    </div>
  </>;
}
