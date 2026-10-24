import { prisma } from '../database/client.js';

export interface BrandSettings {
  name: string;
  subtitle: string;
  logoBase64: string | null;
}

const DEFAULT_BRAND: BrandSettings = {
  name: 'Radar Ofertas',
  subtitle: 'Painel de controle',
  logoBase64: null,
};

const SETTING_KEY = 'brandSettings';
let brandCache: BrandSettings | null = null;

export function invalidateBrandCache(): void {
  brandCache = null;
}

function parseDataUrl(dataUrl: string): string | null {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  return `data:${match[1]};base64,${match[2]}`;
}

function parseBrandFromJson(raw: string): BrandSettings {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return {
    name:
      typeof parsed.name === 'string' && parsed.name.trim()
        ? parsed.name.trim()
        : DEFAULT_BRAND.name,
    subtitle:
      typeof parsed.subtitle === 'string' && parsed.subtitle.trim()
        ? parsed.subtitle.trim()
        : DEFAULT_BRAND.subtitle,
    logoBase64:
      typeof parsed.logoBase64 === 'string' && parsed.logoBase64.trim()
        ? (parseDataUrl(parsed.logoBase64.trim()) ?? parsed.logoBase64.trim())
        : null,
  };
}

export function getBrandSettings(): BrandSettings {
  return brandCache ?? { ...DEFAULT_BRAND };
}

export async function hydrateBrandCache(): Promise<void> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    if (row) {
      brandCache = parseBrandFromJson(row.value);
    }
  } catch {
    /* fallback to defaults */
  }
}

export function getBrandName(): string {
  return getBrandSettings().name;
}

export function getBrandLogoHref(brand: BrandSettings = getBrandSettings()): string | null {
  return brand.logoBase64;
}

export function getBrandInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : 'R';
}

export async function saveBrandSettings(input: {
  name: string;
  subtitle: string;
  logoData?: string;
  removeLogo?: boolean;
}): Promise<void> {
  const name = input.name.trim();
  if (!name) throw new Error('Informe o nome do painel');

  const subtitle = input.subtitle.trim() || DEFAULT_BRAND.subtitle;
  const current = getBrandSettings();

  let logoBase64: string | null = current.logoBase64;

  if (input.removeLogo) {
    logoBase64 = null;
  }

  const logoData = input.logoData?.trim();
  if (logoData) {
    const normalized = parseDataUrl(logoData);
    if (!normalized) throw new Error('Imagem inválida — envie PNG, JPG ou WEBP');
    logoBase64 = normalized;
  }

  const settings: BrandSettings = { name, subtitle, logoBase64 };
  const json = JSON.stringify(settings);

  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value: json },
    create: { key: SETTING_KEY, value: json },
  });

  brandCache = settings;
  const { notifyConfigCacheChange } = await import('../utils/config-cache-sync.js');
  await notifyConfigCacheChange('brand-config');
}
