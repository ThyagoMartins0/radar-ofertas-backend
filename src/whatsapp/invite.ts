import type { WASocket } from 'baileys';
import { isJidGroup, isJidNewsletter } from 'baileys';
import type { WhatsAppDestinationKind } from '../accounts/types.js';

export interface ResolvedWhatsAppInvite {
  jid: string;
  kind: WhatsAppDestinationKind;
  label: string | null;
  inviteLink: string | null;
}

function resolveNewsletterName(name: unknown): string | null {
  if (typeof name === 'string') return name;
  if (name && typeof name === 'object' && 'text' in name && typeof name.text === 'string') {
    return name.text;
  }
  return null;
}

export function extractGroupInviteCode(input: string): string | null {
  const trimmed = input.trim();
  const fromUrl = trimmed.match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/)?.[1];
  if (fromUrl) return fromUrl;
  return null;
}

export function extractNewsletterInviteCode(input: string): string | null {
  const trimmed = input.trim();
  const fromUrl = trimmed.match(/channel\/([A-Za-z0-9_-]+)/)?.[1];
  if (fromUrl) return fromUrl;
  return null;
}

export function normalizeWhatsAppInviteLink(
  input: string,
  kind: WhatsAppDestinationKind,
): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('http')) return trimmed;

  const groupCode = extractGroupInviteCode(trimmed);
  if (groupCode) return `https://chat.whatsapp.com/${groupCode}`;

  const channelCode = extractNewsletterInviteCode(trimmed);
  if (channelCode) return `https://whatsapp.com/channel/${channelCode}`;

  if (kind === 'group') return `https://chat.whatsapp.com/${trimmed}`;
  return `https://whatsapp.com/channel/${trimmed}`;
}

export async function joinWhatsAppGroupFromInvite(sock: WASocket, input: string): Promise<boolean> {
  const code = extractGroupInviteCode(input);
  if (!code) return false;

  try {
    await sock.groupAcceptInvite(code);
    return true;
  } catch {
    return false;
  }
}

export async function resolveWhatsAppInvite(
  sock: WASocket,
  input: string,
): Promise<ResolvedWhatsAppInvite> {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Informe um link de convite ou JID');
  }

  if (trimmed.includes('@')) {
    if (isJidNewsletter(trimmed)) {
      const meta = await sock.newsletterMetadata('jid', trimmed);
      if (!meta?.id) throw new Error('Canal não encontrado');
      return {
        jid: meta.id,
        kind: 'newsletter',
        label: resolveNewsletterName(meta.name) ?? resolveNewsletterName(meta.thread_metadata?.name),
        inviteLink: null,
      };
    }

    if (isJidGroup(trimmed)) {
      const meta = await sock.groupMetadata(trimmed);
      if (!meta?.id) throw new Error('Grupo não encontrado');
      return {
        jid: meta.id,
        kind: 'group',
        label: meta.subject ?? null,
        inviteLink: null,
      };
    }

    throw new Error('JID deve terminar com @newsletter (canal) ou @g.us (grupo)');
  }

  const groupCode = extractGroupInviteCode(trimmed);
  if (groupCode) {
    await joinWhatsAppGroupFromInvite(sock, trimmed);
    const meta = await sock.groupGetInviteInfo(groupCode);
    if (!meta?.id) throw new Error('Grupo não encontrado');
    return {
      jid: meta.id,
      kind: 'group',
      label: meta.subject ?? null,
      inviteLink: normalizeWhatsAppInviteLink(trimmed, 'group'),
    };
  }

  const channelCode = extractNewsletterInviteCode(trimmed) ?? trimmed;
  try {
    const meta = await sock.newsletterMetadata('invite', channelCode);
    if (!meta?.id) {
      throw new Error(
        'Link não reconhecido — use chat.whatsapp.com/... para grupo ou whatsapp.com/channel/... para canal',
      );
    }

    return {
      jid: meta.id,
      kind: 'newsletter',
      label: resolveNewsletterName(meta.name) ?? resolveNewsletterName(meta.thread_metadata?.name),
      inviteLink: normalizeWhatsAppInviteLink(trimmed, 'newsletter'),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Link não reconhecido')) throw error;
    if (/graphql|bad request|not found|404/i.test(message)) {
      throw new Error(
        'Não foi possível resolver o link do canal. Confira o link (whatsapp.com/channel/...) e se o WhatsApp está logado.',
      );
    }
    throw error instanceof Error ? error : new Error(message);
  }
}
