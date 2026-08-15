import { isSafeNumber, parse } from 'lossless-json';

export function parseJson(text) {
  return parse(text, undefined, {
    parseNumber: value => (isSafeNumber(value, { approx: true }) ? Number(value) : value),
  });
}

export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
