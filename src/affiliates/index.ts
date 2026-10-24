/** Plataformas de afiliado/coleta — distinto de canais de publicação (WhatsApp/Telegram). */
export const AFFILIATE_PLATFORMS = ['mercado_livre', 'shopee', 'amazon'] as const;

export type AffiliatePlatform = (typeof AFFILIATE_PLATFORMS)[number];

export type AffiliatePlatformStatus = 'active' | 'links_only' | 'coming_soon';

export interface AffiliatePlatformDefinition {
  id: AffiliatePlatform;
  label: string;
  status: AffiliatePlatformStatus;
  description: string;
}

export function isAffiliatePlatform(value: string): value is AffiliatePlatform {
  return (AFFILIATE_PLATFORMS as readonly string[]).includes(value);
}

export function affiliatePlatformLabel(platform: AffiliatePlatform): string {
  if (platform === 'mercado_livre') return 'Mercado Livre';
  if (platform === 'shopee') return 'Shopee';
  return 'Amazon';
}

export const AFFILIATE_PLATFORM_DEFINITIONS: AffiliatePlatformDefinition[] = [
  {
    id: 'mercado_livre',
    label: 'Mercado Livre',
    status: 'active',
    description: 'Coleta de ofertas, links de afiliado e cupons do portal ML.',
  },
  {
    id: 'shopee',
    label: 'Shopee',
    status: 'coming_soon',
    description: 'Coleta e links de afiliado Shopee — em desenvolvimento.',
  },
  {
    id: 'amazon',
    label: 'Amazon',
    status: 'active',
    description:
      'Coleta de ofertas em browse nodes/buscas Amazon e links de afiliado amazon.com.br/dp/{ASIN}?tag=.',
  },
];

export function getAffiliatePlatformDefinition(
  platform: AffiliatePlatformDefinition['id'],
): AffiliatePlatformDefinition {
  const definition = AFFILIATE_PLATFORM_DEFINITIONS.find((item) => item.id === platform);
  if (!definition) {
    throw new Error(`Plataforma de afiliado desconhecida: ${platform}`);
  }
  return definition;
}
