import type { PresenceMember } from './types';

export function countMembers(members: PresenceMember[]): number {
  return members.length;
}

export function upsertMember(members: PresenceMember[], member: PresenceMember): PresenceMember[] {
  const exists = members.some((current) => current.presenceId === member.presenceId);
  if (exists) return members;
  return [...members, member];
}

export function removeMember(members: PresenceMember[], presenceId: string): PresenceMember[] {
  return members.filter((member) => member.presenceId !== presenceId);
}

export function formatOnlineCount(count: number): string {
  if (count <= 0) return '—';
  return `~${count.toLocaleString('es-AR')}`;
}
