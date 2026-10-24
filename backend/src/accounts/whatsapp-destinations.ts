import { randomBytes } from 'node:crypto';
import { isPlaceholderChannelId } from '../whatsapp/index.js';
import type { WhatsAppAccountConfig, WhatsAppDestination, WhatsAppDestinationKind } from './types.js';

function detectKindFromJid(jid: string): WhatsAppDestinationKind {
  if (jid.endsWith('@g.us')) return 'group';
  return 'newsletter';
}

/** Lista destinos configurados; faz fallback para channelId legado. */
export function listWhatsAppDestinations(config: WhatsAppAccountConfig): WhatsAppDestination[] {
  if (config.destinations?.length) {
    return config.destinations.map((destination) => ({ ...destination }));
  }

  const jid = config.channelId.trim();
  if (!jid || isPlaceholderChannelId(jid)) return [];

  return [
    {
      id: 'default',
      jid,
      kind: detectKindFromJid(jid),
      label: config.channelName ?? null,
      inviteLink: config.inviteLink ?? null,
      enabled: true,
    },
  ];
}

export function getEnabledWhatsAppDestinations(
  config: WhatsAppAccountConfig,
): WhatsAppDestination[] {
  return listWhatsAppDestinations(config).filter((destination) => destination.enabled);
}

export function createWhatsAppDestinationId(): string {
  return `dest-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
}

export function syncLegacyWhatsAppChannelFields(
  config: WhatsAppAccountConfig,
): WhatsAppAccountConfig {
  const destinations = listWhatsAppDestinations(config);
  const primary = destinations.find((destination) => destination.enabled) ?? destinations[0];
  if (!primary) return { ...config, destinations };

  return {
    ...config,
    destinations,
    channelId: primary.jid,
    channelName: primary.label ?? config.channelName ?? null,
    inviteLink: primary.inviteLink ?? config.inviteLink ?? null,
  };
}

export function upsertWhatsAppDestination(
  config: WhatsAppAccountConfig,
  destination: WhatsAppDestination,
): WhatsAppAccountConfig {
  const destinations = listWhatsAppDestinations(config);
  const index = destinations.findIndex((item) => item.id === destination.id);
  if (index >= 0) {
    destinations[index] = destination;
  } else {
    destinations.push(destination);
  }

  return syncLegacyWhatsAppChannelFields({ ...config, destinations });
}

export function removeWhatsAppDestination(
  config: WhatsAppAccountConfig,
  destinationId: string,
): WhatsAppAccountConfig {
  const destinations = listWhatsAppDestinations(config).filter(
    (destination) => destination.id !== destinationId,
  );
  return syncLegacyWhatsAppChannelFields({ ...config, destinations });
}

export function toggleWhatsAppDestination(
  config: WhatsAppAccountConfig,
  destinationId: string,
  enabled: boolean,
): WhatsAppAccountConfig {
  const destinations = listWhatsAppDestinations(config).map((destination) =>
    destination.id === destinationId ? { ...destination, enabled } : destination,
  );
  return syncLegacyWhatsAppChannelFields({ ...config, destinations });
}
