import { env } from '../config/env.js';
import { prisma } from '../database/client.js';
import { normalizeWhatsAppInviteLink } from './invite.js';

export interface WhatsAppChannelCache {
  channelId: string;
  channelName: string;
  inviteLink: string | null;
  updatedAt: string;
}

const SETTING_KEY = 'whatsappChannelCache';
let channelCache: WhatsAppChannelCache | null = null;

async function writeCache(payload: WhatsAppChannelCache): Promise<void> {
  const json = JSON.stringify(payload);
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value: json },
    create: { key: SETTING_KEY, value: json },
  });
  channelCache = payload;
}

export async function saveWhatsAppChannelCache(
  channelId: string,
  channelName: string,
  inviteLink?: string | null,
): Promise<void> {
  const existing = await loadWhatsAppChannelCache();

  const payload: WhatsAppChannelCache = {
    channelId,
    channelName,
    inviteLink:
      inviteLink !== undefined ? inviteLink?.trim() || null : (existing?.inviteLink ?? null),
    updatedAt: new Date().toISOString(),
  };

  await writeCache(payload);
}

export async function saveWhatsAppChannelInviteLink(inviteLink: string): Promise<void> {
  const normalized = normalizeWhatsAppInviteLink(inviteLink, 'newsletter');
  if (!normalized) {
    throw new Error('Informe um link de compartilhamento válido');
  }

  const existing = await loadWhatsAppChannelCache();
  if (existing) {
    await saveWhatsAppChannelCache(existing.channelId, existing.channelName, normalized);
    return;
  }

  const channelId = env.WHATSAPP_CHANNEL_ID.trim();
  if (!channelId) {
    throw new Error('Canal ainda não configurado — defina o ID em Configuração › Integrador no painel');
  }

  await saveWhatsAppChannelCache(channelId, 'Canal WhatsApp', normalized);
}

export async function loadWhatsAppChannelCache(): Promise<WhatsAppChannelCache | null> {
  if (channelCache) return channelCache;
  try {
    const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    if (!row) return null;
    const parsed = JSON.parse(row.value) as WhatsAppChannelCache;
    if (!parsed.channelId || !parsed.channelName) return null;
    channelCache = {
      channelId: parsed.channelId,
      channelName: parsed.channelName,
      inviteLink: parsed.inviteLink ?? null,
      updatedAt: parsed.updatedAt,
    };
    return channelCache;
  } catch {
    return null;
  }
}

export async function resolveWhatsAppChannelName(channelId: string): Promise<string | null> {
  if (!channelId) return null;

  const cache = await loadWhatsAppChannelCache();
  if (cache?.channelId === channelId && cache.channelName) {
    return cache.channelName;
  }

  return null;
}

export async function resolveWhatsAppChannelInviteLink(channelId: string): Promise<string | null> {
  if (!channelId) return null;

  const cache = await loadWhatsAppChannelCache();
  if (cache?.channelId === channelId && cache.inviteLink) {
    return cache.inviteLink;
  }

  return null;
}
