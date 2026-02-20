import { RoleId } from '../types/models';

export interface JwtPayload {
  sub: string;
  role_id: RoleId;
  exp: number;
}

const SECRET_MARKER = 'school-israel-mvp';

const encoder = new TextEncoder();

function toBase64Url(input: string): string {
  const bytes = encoder.encode(input);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  const base64 = globalThis.btoa ? globalThis.btoa(binary) : fallbackBtoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(input: string): string {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`;
  const binary = globalThis.atob ? globalThis.atob(padded) : fallbackAtob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder().decode(bytes);
  }

  let ascii = '';
  for (let index = 0; index < bytes.length; index += 1) {
    ascii += String.fromCharCode(bytes[index]);
  }
  return ascii;
}

function fallbackBtoa(binary: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let output = '';
  for (let i = 0; i < binary.length; i += 3) {
    const byte1 = binary.charCodeAt(i);
    const byte2 = binary.charCodeAt(i + 1);
    const byte3 = binary.charCodeAt(i + 2);
    const buffer = (byte1 << 16) | ((byte2 || 0) << 8) | (byte3 || 0);
    output += chars[(buffer >> 18) & 63];
    output += chars[(buffer >> 12) & 63];
    output += i + 1 < binary.length ? chars[(buffer >> 6) & 63] : '=';
    output += i + 2 < binary.length ? chars[buffer & 63] : '=';
  }
  return output;
}

function fallbackAtob(base64: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let output = '';
  let buffer = 0;
  let bitsCollected = 0;
  for (let i = 0; i < base64.length; i += 1) {
    const value = chars.indexOf(base64.charAt(i));
    if (value < 0 || value === 64) {
      continue;
    }
    buffer = (buffer << 6) | value;
    bitsCollected += 6;
    if (bitsCollected >= 8) {
      bitsCollected -= 8;
      output += String.fromCharCode((buffer >> bitsCollected) & 0xff);
    }
  }
  return output;
}

export function hashPassword(rawPassword: string): string {
  let hash = 5381;
  const combined = `${rawPassword}:${SECRET_MARKER}`;
  for (let index = 0; index < combined.length; index += 1) {
    hash = (hash * 33) ^ combined.charCodeAt(index);
  }
  return `pw_${(hash >>> 0).toString(16)}`;
}

export function createJwtToken(payload: JwtPayload): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const partOne = toBase64Url(JSON.stringify(header));
  const partTwo = toBase64Url(JSON.stringify(payload));
  const signature = toBase64Url(`${partOne}.${partTwo}.${SECRET_MARKER}`);
  return `${partOne}.${partTwo}.${signature}`;
}

export function parseJwtToken(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(parts[1])) as JwtPayload;
    if (!payload.exp || Date.now() / 1000 > payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
