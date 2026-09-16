import type { Env } from './types';
import { ApiError } from './services';

export const membershipYear = () => Number(new Intl.DateTimeFormat('en', { timeZone: 'Europe/Stockholm', year: 'numeric' }).format(new Date()));
export const isAdmin = (env: Env, email: string | null) => !!email && (env.ADMIN_EMAILS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
export async function isPaid(env: Env, email: string | null) {
  if (!email) return false;
  return !!await env.DB.prepare('SELECT email FROM memberships WHERE email=? AND paid_through_year>=?').bind(email, membershipYear()).first();
}
export function parseImport(input: unknown, year: unknown) {
  if (typeof input !== 'string' || input.length > 12000 || !Number.isInteger(year) || Number(year) < 2000 || Number(year) > membershipYear() + 1)
    throw new ApiError(400, 'Ange e-postadresser och ett giltigt medlemsår.');
  const entries = input.split(/[\n,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!entries.length || entries.length > 100) throw new ApiError(400, 'Ange 1–100 adresser åt gången.');
  const invalid = [...new Set(entries.filter(s => s.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)))];
  return { emails: [...new Set(entries.filter(s => !invalid.includes(s)))], invalid, duplicates: entries.length - new Set(entries).size, year: Number(year) };
}
