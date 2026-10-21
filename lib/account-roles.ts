import type { PortalUser } from './portal-model';
export type PortalRole = PortalUser['role'];
export function configuredRole(value: unknown): PortalRole {
  // Retain existing administrator access for legacy, unannotated accounts.
  if (value === undefined || value === null || value === '') return 'administrator';
  if (value === 'viewer' || value === 'operator' || value === 'administrator') return value;
  throw new Error('Invalid account role configuration.');
}
export function parseAccountRoles(raw: string, validIdentity: (identity: string) => boolean): Map<string, PortalRole> {
  const roles = new Map<string, PortalRole>();
  for (const entry of raw.split(',').map(s => s.trim()).filter(Boolean)) {
    const parts = entry.split('|');
    const identity = parts[0].trim().toLowerCase();
    if (parts.length > 2 || !validIdentity(identity) || roles.has(identity) || (parts.length === 2 && !parts[1].trim())) throw new Error('Invalid or duplicate approved account.');
    roles.set(identity, configuredRole(parts[1]?.trim()));
  }
  return roles;
}
