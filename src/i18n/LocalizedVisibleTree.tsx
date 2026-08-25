import {
  Children,
  cloneElement,
  Fragment,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  localizeWorkbenchDynamicText,
  type WorkbenchVisibleCatalog,
} from './workbenchVisibleCatalog';

type LocalizedVisibleTreeProps = {
  area: 'videoEdit' | 'creatorAgent' | 'inspiration' | 'nodes';
  catalog: WorkbenchVisibleCatalog;
  dynamicLocalizer?: (value: string) => string;
  children: ReactNode;
};

const LOCALIZED_PROPS = ['title', 'placeholder', 'aria-label', 'aria-description', 'aria-valuetext', 'alt'] as const;

function preserveOuterWhitespace(source: string, translated: string) {
  const leading = source.match(/^\s*/)?.[0] || '';
  const trailing = source.match(/\s*$/)?.[0] || '';
  return `${leading}${translated}${trailing}`;
}

export function localizeWorkbenchVisibleString(
  source: string,
  area: LocalizedVisibleTreeProps['area'],
  catalog: WorkbenchVisibleCatalog,
  dynamicLocalizer?: (value: string) => string,
) {
  const trimmed = source.trim();
  if (!trimmed) return source;
  const exact = catalog.englishByChinese[trimmed];
  const fallback = area === 'nodes' ? trimmed : localizeWorkbenchDynamicText(area, trimmed);
  const translated = exact || dynamicLocalizer?.(trimmed) || fallback;
  return translated === trimmed ? source : preserveOuterWhitespace(source, translated);
}

function localizeNode(
  node: ReactNode,
  area: LocalizedVisibleTreeProps['area'],
  catalog: WorkbenchVisibleCatalog,
  dynamicLocalizer?: (value: string) => string,
): ReactNode {
  if (typeof node === 'string') return localizeWorkbenchVisibleString(node, area, catalog, dynamicLocalizer);
  if (Array.isArray(node)) return node.map((item) => localizeNode(item, area, catalog, dynamicLocalizer));
  if (!isValidElement(node)) return node;

  const element = node as ReactElement<Record<string, unknown>>;
  if (element.props['data-i18n-skip'] === true || element.props['data-i18n-skip'] === 'true') return element;
  const nextProps: Record<string, unknown> = {};
  for (const key of LOCALIZED_PROPS) {
    const value = element.props[key];
    if (typeof value === 'string') nextProps[key] = localizeWorkbenchVisibleString(value, area, catalog, dynamicLocalizer);
  }
  if ('children' in element.props) {
    nextProps.children = Children.map(
      element.props.children as ReactNode,
      (child) => localizeNode(child, area, catalog, dynamicLocalizer),
    );
  }
  return cloneElement(element, nextProps);
}

export default function LocalizedVisibleTree({ area, catalog, dynamicLocalizer, children }: LocalizedVisibleTreeProps) {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language;
  if (!locale?.toLowerCase().startsWith('en')) return <>{children}</>;
  return <Fragment>{localizeNode(children, area, catalog, dynamicLocalizer)}</Fragment>;
}
