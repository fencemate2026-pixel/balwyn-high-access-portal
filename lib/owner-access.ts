import { env } from '@/lib/server-env';
import type { PortalUser } from './portal-model';

export function portalEmailAllowed(email: string): boolean {
  const raw = String(env.PORTAL_ALLOWED_EMAILS ?? '').trim();
  if (!raw) return true; // Existing sites retain their provider-specific allowlists.
  const emails = raw.split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  return emails.includes(email.trim().toLowerCase());
}

// Owner status comes from server configuration and a verified login identity.
// Microsoft display-email hints are not proof of ownership.
export function withOwnerAccess(user: PortalUser, provider: 'google' | 'password' | 'microsoft'): PortalUser {
  const { isOwner: _previousOwner, ...identity } = user;
  const owner = String(env.PORTAL_OWNER_EMAIL ?? '').trim().toLowerCase();
  return provider !== 'microsoft' && identity.role === 'administrator' && owner && portalEmailAllowed(identity.email)
    && identity.email.trim().toLowerCase() === owner ? { ...identity, isOwner: true } : identity;
}
