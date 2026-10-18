import type { PortalUser } from './portal-model';
export type PortalRole = PortalUser['role'];
export function configuredRole(value: unknown): PortalRole {
  // Fail closed, not open (AUDIT_SECURITY P2, 18 Oct 2026): an allow-listed
  // identity with no explicit "|role" suffix gets the LEAST-privileged role,
  // not administrator. Omitting the suffix used to silently grant full
  // administrator access - a configuration mistake (forgetting "|viewer")
  // must never widen access on its own. Every account that actually needs
  // elevated access must be annotated explicitly (e.g. "name@school|operator"
  // or "name@school|administrator").
  if (value === undefined || value === null || value === '') return 'viewer';
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
