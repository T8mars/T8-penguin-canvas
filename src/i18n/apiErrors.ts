import i18n from './index';
import { ApiRequestError, parseApiErrorEnvelope, type ApiErrorEnvelope } from '../services/api';

interface LocalizeApiErrorOptions {
  fallback?: string;
  fallbackKey?: string;
  status?: number;
}

function runtimeI18nKey(key: string) {
  if (key.includes(':')) return key;
  const separator = key.indexOf('.');
  return separator > 0 ? `${key.slice(0, separator)}:${key.slice(separator + 1)}` : key;
}

function envelopeFromUnknown(error: unknown, status?: number): ApiErrorEnvelope {
  if (error instanceof ApiRequestError) {
    return {
      code: error.code,
      messageKey: error.messageKey,
      params: error.params,
      error: error.message,
    };
  }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    return parseApiErrorEnvelope(record.data && typeof record.data === 'object' ? { ...record, ...(record.data as object) } : record, status || Number(record.status) || 500);
  }
  return parseApiErrorEnvelope({ error: error instanceof Error ? error.message : String(error || '') }, status || 500);
}

export function localizeApiError(error: unknown, options: LocalizeApiErrorOptions = {}) {
  const envelope = envelopeFromUnknown(error, options.status);
  const messageKey = envelope.messageKey ? runtimeI18nKey(envelope.messageKey) : null;
  if (messageKey && i18n.exists(messageKey)) {
    return String(i18n.t(messageKey, envelope.params));
  }
  const language = String(i18n.resolvedLanguage || i18n.language || 'zh-CN').toLowerCase();
  if (language.startsWith('zh') && envelope.error.trim()) return envelope.error;
  const fallbackKey = options.fallbackKey ? runtimeI18nKey(options.fallbackKey) : null;
  if (fallbackKey && i18n.exists(fallbackKey)) return String(i18n.t(fallbackKey));
  if (options.fallback) return options.fallback;
  return String(i18n.t('errors:api.requestFailed', { status: envelope.params.status || options.status || 500 }));
}

export function apiErrorTechnicalDetails(error: unknown) {
  const envelope = envelopeFromUnknown(error);
  return { code: envelope.code, status: envelope.params.status, legacyMessage: envelope.error };
}
