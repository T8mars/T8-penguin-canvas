import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { localizeWorkbenchVisibleString } from './LocalizedVisibleTree';
import { localizeNodeDynamicText, NODE_VISIBLE_CATALOG } from './nodeVisibleCatalog';

const TEXT_SOURCES = new WeakMap<Text, string>();
const ATTRIBUTE_SOURCES = new WeakMap<Element, Map<string, string>>();
const LOCALIZED_ATTRIBUTES = ['title', 'placeholder', 'aria-label', 'aria-description', 'aria-valuetext', 'alt'] as const;
const SKIP_SELECTOR = [
  '[data-i18n-skip="true"]',
  '[data-user-content]',
  '[data-provider-content]',
  'script',
  'style',
].join(',');
const FORM_CONTENT_SELECTOR = 'textarea, input, [contenteditable="true"]';

function isSkipped(element: Element | null) {
  return Boolean(element?.closest(SKIP_SELECTOR));
}

function translateValue(value: string) {
  return localizeWorkbenchVisibleString(
    value,
    'nodes',
    NODE_VISIBLE_CATALOG,
    localizeNodeDynamicText,
  );
}

function applyTextNode(node: Text, english: boolean) {
  if (!node.parentElement || isSkipped(node.parentElement) || node.parentElement.closest(FORM_CONTENT_SELECTOR)) return;
  const current = node.nodeValue || '';
  const stored = TEXT_SOURCES.get(node);
  if (!english) {
    if (stored !== undefined && current !== stored) node.nodeValue = stored;
    return;
  }
  let source = stored ?? current;
  if (stored !== undefined) {
    const previousTranslation = translateValue(stored);
    if (current !== stored && current !== previousTranslation) {
      source = current;
      TEXT_SOURCES.set(node, current);
    }
  }
  const translated = translateValue(source);
  if (translated === source) return;
  if (stored === undefined) TEXT_SOURCES.set(node, source);
  if (current !== translated) node.nodeValue = translated;
}

function applyElementAttributes(element: Element, english: boolean) {
  if (isSkipped(element)) return;
  let sources = ATTRIBUTE_SOURCES.get(element);
  for (const attribute of LOCALIZED_ATTRIBUTES) {
    const current = element.getAttribute(attribute);
    if (!current) continue;
    const stored = sources?.get(attribute);
    if (!english) {
      if (stored !== undefined && current !== stored) element.setAttribute(attribute, stored);
      continue;
    }
    let source = stored ?? current;
    if (stored !== undefined) {
      const previousTranslation = translateValue(stored);
      if (current !== stored && current !== previousTranslation) {
        source = current;
        sources?.set(attribute, current);
      }
    }
    const translated = translateValue(source);
    if (translated === source) continue;
    if (!sources) {
      sources = new Map();
      ATTRIBUTE_SOURCES.set(element, sources);
    }
    if (stored === undefined) sources.set(attribute, source);
    if (current !== translated) element.setAttribute(attribute, translated);
  }
}

function applySubtree(root: ParentNode, english: boolean) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    applyTextNode(current as Text, english);
    current = walker.nextNode();
  }
  if (root instanceof Element) applyElementAttributes(root, english);
  root.querySelectorAll('*').forEach((element) => applyElementAttributes(element, english));
}

/**
 * Compatibility boundary for legacy canvas nodes.
 * It translates presentation-only DOM after nested components render while preserving
 * form values, user content, provider output, enum values, model ids, and persisted data.
 */
export default function NodeDomLanguageBoundary() {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language;

  useEffect(() => {
    const english = locale?.toLowerCase().startsWith('en') === true;
    const applyAll = () => {
      document.querySelectorAll('.t8-canvas-shell').forEach((root) => applySubtree(root, english));
    };
    applyAll();

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') {
          const parent = mutation.target.parentElement;
          if (parent?.closest('.t8-canvas-shell')) applyTextNode(mutation.target as Text, english);
          continue;
        }
        if (mutation.type === 'attributes') {
          const element = mutation.target as Element;
          if (element.closest('.t8-canvas-shell')) applyElementAttributes(element, english);
          continue;
        }
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element && node.closest('.t8-canvas-shell')) applySubtree(node, english);
          else if (node instanceof Text && node.parentElement?.closest('.t8-canvas-shell')) applyTextNode(node, english);
        });
      }
    });
    const canvasShell = document.querySelector('.t8-canvas-shell');
    if (!canvasShell) return () => observer.disconnect();
    observer.observe(canvasShell, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...LOCALIZED_ATTRIBUTES],
    });
    return () => observer.disconnect();
  }, [locale]);

  return null;
}
