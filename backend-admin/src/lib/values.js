import { isRecord } from './json.js';

export class InputError extends Error {
  constructor(message, code = 'invalid_payload') {
    super(message);
    this.name = 'InputError';
    this.code = code;
  }
}

export function identifier(value, { field = 'identifier', maxLength = 128, required = false } = {}) {
  const normalized = scalarString(value).trim();
  if (!normalized) {
    if (required) throw new InputError(`${field} is required`);
    return '';
  }
  if (normalized.length > maxLength) throw new InputError(`${field} is too long`);
  return normalized;
}

export function text(value, { maxLength = 200, fallback = '' } = {}) {
  const normalized = scalarString(value).trim();
  if (!normalized) return fallback;
  if (normalized.length > maxLength) return normalized.slice(0, maxLength);
  return normalized;
}

export function nonNegativeInteger(value, { field = 'value', fallback = 0 } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new InputError(`${field} must be numeric`);
  const rounded = Math.round(parsed);
  if (!Number.isSafeInteger(rounded) || rounded < 0) {
    throw new InputError(`${field} must be a non-negative safe integer`);
  }
  return rounded;
}

export function objectBody(value) {
  if (!isRecord(value)) throw new InputError('request body must be a JSON object');
  return value;
}

export function scalarString(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value?.toString === 'function') return value.toString();
  return '';
}
