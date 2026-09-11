import { createHash, randomBytes, scrypt as derive, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type AvatarContentType = 'image/jpeg' | 'image/png' | 'image/webp';
export type Account = { id: string; masterId: string; role: 'master' | 'buyer'; name: string; email: string; passwordHash: string; active: boolean; avatarKey?: string; avatarContentType?: AvatarContentType; avatarUpdatedAt?: string };
export type Card = { id: string; masterId: string; name: string; dueDay: number };
export type Document = { id: string; masterId: string; cardId: string; dueDate: string; key: string; size: number; sha256: string; createdAt: string };
export type PersonRecord = { id: string; masterId: string; name: string; color: string; monthlyLimitCents?: number; accountId?: string; version: number; createdAt: string; updatedAt: string };
export type AllocationRecord = { personId: string; cents: number };
export type TransactionRecord = { id: string; statementId: string; masterId: string; date: string; merchant: string; cents: number; holder: string; category: string; installment?: { current: number; total: number }; nextCents?: number; kind: 'purchase' | 'service'; allocations: AllocationRecord[]; carryForward: boolean; note?: string; buyerId?: string | null; sharedCost?: boolean; version: number; updatedAt: string };
export type StatementRecord = Document & { fingerprint: string; filename: string; total: number; nextTotal?: number; laterTotal?: number; holderTotals: { name: string; cents: number }[]; warnings: string[]; importedAt: string; version: number; transactionCount: number };
export function text(value: unknown, label: string, max = 100): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new ApiError(400, `${label} inválido.`);
  return value.trim();
}
export function email(value: unknown) {
  const result = text(value, 'E-mail', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new ApiError(400, 'E-mail inválido.');
  return result;
}
export function identifier(value: unknown) {
  const result = text(value, 'Identificador', 80);
  if (!/^[a-zA-Z0-9_-]+$/.test(result)) throw new ApiError(400, 'Identificador inválido.');
  return result;
}
export function dueDate(value: unknown) {
  const result = text(value, 'Vencimento', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0, 10) !== result) throw new ApiError(400, 'Use uma data válida no formato AAAA-MM-DD.');
  return result;
}
export function dueDay(value: unknown) {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 31) throw new ApiError(400, 'Dia de vencimento deve estar entre 1 e 31.');
  return value as number;
}
export function integer(value: unknown, label: string, minimum = -Number.MAX_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new ApiError(400, `${label} inválido.`);
  return value as number;
}
export function authorize(account: Account, masterId: string, write = false) {
  if (!account.active || account.masterId !== masterId || (write && account.role !== 'master')) throw new ApiError(403, 'Acesso não permitido.');
}
export function documentKey(masterId: string, cardId: string, date: string, id: string) {
  return `masters/${identifier(masterId)}/cards/${identifier(cardId)}/due/${dueDate(date)}/${identifier(id)}.pdf`;
}
export function avatarObjectKey(masterId: string, userId: string) {
  return `masters/${identifier(masterId)}/profiles/${identifier(userId)}/avatar`;
}
export const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export const secret = () => randomBytes(32).toString('hex');
const scrypt = promisify(derive);
export async function hashPassword(value: unknown) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) throw new ApiError(400, 'A senha deve ter de 12 a 128 caracteres.');
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(value, salt, 64) as Buffer;
  return `${salt}:${hash.toString('hex')}`;
}
export async function checkPassword(value: unknown, saved: string) {
  if (typeof value !== 'string' || value.length > 128) return false;
  const [salt, hex] = saved.split(':');
  if (!salt || !hex || hex.length !== 128) return false;
  const hash = await scrypt(value, salt, 64) as Buffer;
  return timingSafeEqual(hash, Buffer.from(hex, 'hex'));
}
export function publicAccount(account: Account) {
  const { passwordHash: _, avatarKey: __, ...safe } = account;
  return { ...safe, avatarUrl: account.avatarKey ? `/api/backend/avatars/${account.id}?v=${encodeURIComponent(account.avatarUpdatedAt || '')}` : null };
}
export const MAX_PDF = 15 * 1024 * 1024;
export const MAX_AVATAR = 2 * 1024 * 1024;
export function validatePdf(bytes: Uint8Array) {
  if (bytes.length < 5 || bytes.length > MAX_PDF || Buffer.from(bytes.subarray(0, 5)).toString() !== '%PDF-') throw new ApiError(400, 'Envie um PDF de até 15 MB.');
}
export function validateAvatar(bytes: Uint8Array, requestedType: string | null): AvatarContentType {
  if (bytes.length < 12 || bytes.length > MAX_AVATAR) throw new ApiError(400, 'Envie uma foto de até 2 MB.');
  const header = Buffer.from(bytes.subarray(0, 12));
  const detected: AvatarContentType | undefined = header.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? 'image/jpeg'
    : header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'image/png'
    : header.subarray(0, 4).toString() === 'RIFF' && header.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : undefined;
  const declared = requestedType?.split(';', 1)[0].trim().toLowerCase();
  if (!detected || declared !== detected) throw new ApiError(400, 'Use uma imagem JPEG, PNG ou WebP válida.');
  return detected;
}
