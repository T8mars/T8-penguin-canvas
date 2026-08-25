export interface VisibleI18nAuditFinding {
  kind: 'text' | 'attribute';
  value: string;
  attribute?: string;
  selector: string;
}

export interface VisibleI18nAuditSnapshot {
  capturedAt: string;
  locale: string;
  scannedTextNodes: number;
  scannedAttributes: number;
  truncated: boolean;
  findings: VisibleI18nAuditFinding[];
}

interface VisibleI18nAuditApi {
  snapshot: () => VisibleI18nAuditSnapshot;
  publish: () => VisibleI18nAuditSnapshot;
}

const CJK_RE = /[\u3400-\u9fff]/;
const ATTRIBUTE_NAMES = ['title', 'placeholder', 'aria-label', 'aria-description', 'aria-valuetext', 'alt'] as const;
const SKIP_SELECTOR = [
  '[data-i18n-skip]',
  '[data-user-content]',
  '[data-provider-content]',
  '[data-runtime-diagnostic]',
  'script',
  'style',
  'code',
  'pre',
].join(',');

function boundedVisibleText(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

function elementSelector(element: Element) {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && parts.length < 5) {
    let part = current.tagName.toLowerCase();
    if (current.id) {
      part += `#${CSS.escape(current.id)}`;
      parts.unshift(part);
      break;
    }
    const testId = current.getAttribute('data-testid');
    const nodeId = current.getAttribute('data-id');
    if (testId) part += `[data-testid="${CSS.escape(testId)}"]`;
    else if (nodeId) part += `[data-id="${CSS.escape(nodeId)}"]`;
    else if (current.classList.length) part += `.${CSS.escape(current.classList.item(0) || '')}`;
    parts.unshift(part);
    current = current.parentElement;
  }
  return parts.join(' > ');
}

function shouldSkip(element: Element) {
  return Boolean(element.closest(SKIP_SELECTOR));
}

function isElementVisible(element: Element) {
  if (!(element instanceof HTMLElement)) return true;
  if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

export function auditVisibleI18n(root: ParentNode = document, maxFindings = 500): VisibleI18nAuditSnapshot {
  const findings: VisibleI18nAuditFinding[] = [];
  let scannedTextNodes = 0;
  let scannedAttributes = 0;
  const add = (finding: VisibleI18nAuditFinding) => {
    if (findings.length < maxFindings) findings.push(finding);
  };
  const ownerDocument = root instanceof Document ? root : root.ownerDocument || document;
  const walker = ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode();
  while (textNode) {
    const parent = textNode.parentElement;
    const value = boundedVisibleText(textNode.nodeValue);
    if (parent && value) {
      scannedTextNodes += 1;
      const isFormValue = Boolean(parent.closest('textarea, input, [contenteditable="true"]'));
      if (CJK_RE.test(value) && !isFormValue && !shouldSkip(parent) && isElementVisible(parent)) {
        add({ kind: 'text', value, selector: elementSelector(parent) });
      }
    }
    textNode = walker.nextNode();
  }
  const elements = root instanceof Element ? [root, ...Array.from(root.querySelectorAll('*'))] : Array.from(root.querySelectorAll('*'));
  elements.forEach((element) => {
    if (shouldSkip(element) || !isElementVisible(element)) return;
    ATTRIBUTE_NAMES.forEach((attribute) => {
      const value = boundedVisibleText(element.getAttribute(attribute));
      if (!value) return;
      scannedAttributes += 1;
      if (CJK_RE.test(value)) add({ kind: 'attribute', value, attribute, selector: elementSelector(element) });
    });
  });
  return {
    capturedAt: new Date().toISOString(),
    locale: document.documentElement.lang || '',
    scannedTextNodes,
    scannedAttributes,
    truncated: findings.length >= maxFindings,
    findings,
  };
}

function publishVisibleI18nAuditSnapshot() {
  const snapshot = auditVisibleI18n(document);
  document.documentElement.dataset.t8I18nAudit = 'enabled';
  document.documentElement.dataset.t8I18nAuditFindings = String(snapshot.findings.length);
  document.documentElement.dataset.t8I18nAuditTruncated = String(snapshot.truncated);
  let output = document.querySelector<HTMLScriptElement>('#t8-i18n-visible-audit-result');
  if (!output) {
    output = document.createElement('script');
    output.id = 't8-i18n-visible-audit-result';
    output.type = 'application/json';
    document.body.appendChild(output);
  }
  output.textContent = JSON.stringify(snapshot);
  return snapshot;
}

export function installVisibleI18nAudit(): VisibleI18nAuditApi | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const enabled = params.get('i18nAudit') === '1' || window.localStorage.getItem('t8-i18n-visible-audit') === '1';
  if (!enabled) return null;
  const api: VisibleI18nAuditApi = {
    snapshot: () => auditVisibleI18n(document),
    publish: publishVisibleI18nAuditSnapshot,
  };
  (window as Window & { __T8_I18N_AUDIT__?: VisibleI18nAuditApi }).__T8_I18N_AUDIT__ = api;
  document.documentElement.dataset.t8I18nAudit = 'enabled';
  window.setTimeout(publishVisibleI18nAuditSnapshot, 1800);
  return api;
}
