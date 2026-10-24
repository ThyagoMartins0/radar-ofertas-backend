import {
  getCollectorIntervalMinutes,
  getOperatingHoursStart,
  getOperatingHoursEnd,
  getSenderDelayMinutesFromDb,
  hydrateQueueConfigCache,
  saveCollectorIntervalMinutes,
  saveOperatingHours,
  saveSenderDelayMinutes,
} from '../../src/config/queue-config-store.js';
import { runSave } from './shared/save-result.js';
import {
  describeScoreRules,
  getRuntimeScoreConfigAsync,
  parseScoreConfigFromForm,
  saveScoreConfig,
  type ScoreConfig,
} from '../../src/config/score-config.js';
import {
  getAmazonConfigFromDb,
  hydrateAmazonConfigCache,
  saveAmazonAffiliateConfig,
} from '../../src/config/amazon-config-store.js';
import {
  hydrateCollectionPlatformsCache,
  isAmazonCollectionEnabled,
  saveAmazonCollectionEnabled,
} from '../../src/config/collection-platforms-config.js';
import {
  getCouponsUrlFromDb,
  hydrateCouponsConfigCache,
  saveCouponsUrl,
} from '../../src/config/coupons-config-store.js';
import { env } from '../../src/config/env.js';
import { resolveNovncPort } from '../../src/config/novnc.js';
import { isWithinOperatingHours } from '../../src/utils/datetime.js';
import { isRedisEnabled, rescheduleCollectorJob } from '../../src/queue/index.js';
import {
  getBrandInitial,
  getBrandLogoHref,
  getBrandSettings,
  hydrateBrandCache,
  saveBrandSettings,
} from '../../src/config/brand-config.js';
import { hydrateIntegrationState } from '../../src/channels/integration-state.js';
import {
  getMercadoLivreSessionStatus,
  getTelegramSessionStatus,
  getWhatsAppSessionStatus,
  type SessionStatus,
} from './session-model.js';
import {
  canManagerSpawnWorkers,
  listWorkerStates,
  type WorkerState,
  type AccountWorkerState,
} from './process-model.js';
import { ensureDefaultWhatsAppDestinationFromEnv } from './whatsapp-destinations-model.js';
import { loadTelegramIntegrationView } from './integration-model.js';

export type SettingsSaveType =
  | 'interval'
  | 'brand'
  | 'score'
  | 'hours'
  | 'senderDelay'
  | 'mlSources'
  | 'couponsUrl'
  | 'amazonAffiliate'
  | null;

export interface SettingsData {
  timezone: string;
  operatingHours: { start: number; end: number };
  operatingHoursLabel: string;
  withinOperatingHours: boolean;
  minScore: number;
  scoreConfig: ScoreConfig;
  scoreRulesSummary: string[];
  collectorIntervalMinutes: number;
  senderDelayMinutes: number;
  brandName: string;
  brandSubtitle: string;
  brandLogoHref: string | null;
  brandInitial: string;
  mlSession: SessionStatus;
  waSession: SessionStatus;
  telegramEnabled: boolean;
  telegramChatId: string;
  telegramHasBotToken: boolean;
  tgSession: SessionStatus | null;
  workerState: WorkerState;
  senderWorker: AccountWorkerState;
  canSpawnWorkers: boolean;
  novncPort: number | null;
  mlCouponsUrl: string;
  amazonBaseUrl: string;
  amazonAffiliateLinkPrefix: string;
  amazonAffiliateStoreId: string;
  amazonCollectionEnabled: boolean;
  saved: SettingsSaveType;
  error: string | null;
}

function formatOperatingHours(start: number, end: number): string {
  const endLabel = end === 0 ? '24:00' : `${String(end).padStart(2, '0')}:00`;
  return `${String(start).padStart(2, '0')}:00 – ${endLabel}`;
}

export async function loadSettingsData(
  saved: SettingsSaveType = null,
  error: string | null = null,
): Promise<SettingsData> {
  await Promise.all([hydrateQueueConfigCache(), hydrateBrandCache(), hydrateCouponsConfigCache(), hydrateAmazonConfigCache(), hydrateCollectionPlatformsCache(), hydrateIntegrationState()]);
  await ensureDefaultWhatsAppDestinationFromEnv();
  const scoreConfig = await getRuntimeScoreConfigAsync();
  const senderDelayMinutes = await getSenderDelayMinutesFromDb();
  const telegramIntegration = await loadTelegramIntegrationView();
  const [mlSession, waSession, tgSession] = await Promise.all([
    getMercadoLivreSessionStatus(),
    getWhatsAppSessionStatus(),
    telegramIntegration.enabled ? getTelegramSessionStatus() : Promise.resolve(null),
  ]);
  const operatingHours = {
    start: getOperatingHoursStart(),
    end: getOperatingHoursEnd(),
  };

  const brand = getBrandSettings();
  const mlCouponsUrl = await getCouponsUrlFromDb();
  const amazonConfig = await getAmazonConfigFromDb();
  const senderWorkers = await listWorkerStates();
  const senderWorker = senderWorkers[0]!;
  const workerState = senderWorker.state;

  return {
    timezone: env.APP_TIMEZONE,
    operatingHours,
    operatingHoursLabel: formatOperatingHours(operatingHours.start, operatingHours.end),
    withinOperatingHours: isWithinOperatingHours(env.APP_TIMEZONE, {
      startHour: operatingHours.start,
      endHour: operatingHours.end,
    }),
    minScore: scoreConfig.minScore,
    scoreConfig,
    scoreRulesSummary: describeScoreRules(scoreConfig),
    collectorIntervalMinutes: getCollectorIntervalMinutes(),
    senderDelayMinutes,
    brandName: brand.name,
    brandSubtitle: brand.subtitle,
    brandLogoHref: getBrandLogoHref(brand),
    brandInitial: getBrandInitial(brand.name),
    mlSession,
    waSession,
    telegramEnabled: telegramIntegration.enabled,
    telegramChatId: telegramIntegration.chatId,
    telegramHasBotToken: telegramIntegration.hasBotToken,
    tgSession,
    workerState,
    senderWorker,
    canSpawnWorkers: canManagerSpawnWorkers(),
    novncPort: resolveNovncPort(),
    mlCouponsUrl,
    amazonBaseUrl: amazonConfig.baseUrl,
    amazonAffiliateLinkPrefix: amazonConfig.affiliateLinkPrefix,
    amazonAffiliateStoreId: amazonConfig.storeId,
    amazonCollectionEnabled: isAmazonCollectionEnabled(),
    saved,
    error,
  };
}

export async function saveSendIntervalMinutes(
  minutes: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return runSave(async () => {
    await saveCollectorIntervalMinutes(minutes);
    if (isRedisEnabled()) {
      await rescheduleCollectorJob();
    }
  }, 'Falha ao salvar intervalo de envio');
}

export async function saveSenderDelay(
  minutes: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return runSave(() => saveSenderDelayMinutes(minutes), 'Falha ao salvar tempo de envio');
}

export async function saveOperatingHoursSettings(
  startRaw: string,
  endRaw: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return runSave(async () => {
    const startHour = Number.parseInt(startRaw, 10);
    const endHour = Number.parseInt(endRaw, 10);
    await saveOperatingHours(startHour, endHour);
  }, 'Falha ao salvar janela operacional');
}

export async function saveBrandIdentity(input: {
  name: string;
  subtitle: string;
  logoData?: string;
  removeLogo?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  return runSave(() => saveBrandSettings(input), 'Falha ao salvar identidade visual');
}

export async function saveCouponsUrlSettings(
  url: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return runSave(() => saveCouponsUrl(url), 'Falha ao salvar URL de cupons');
}

export async function saveAmazonCollectionSettings(
  enabled: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (enabled) {
    const amazonConfig = await getAmazonConfigFromDb();
    if (!amazonConfig.storeId.trim()) {
      return { ok: false, error: 'Configure o ID da loja Amazon antes de habilitar a coleta' };
    }
  }

  return runSave(() => saveAmazonCollectionEnabled(enabled), 'Falha ao salvar coleta Amazon');
}

export async function saveAmazonAffiliateSettings(input: {
  baseUrl: string;
  affiliateLinkPrefix: string;
  storeId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  return runSave(
    () => saveAmazonAffiliateConfig(input),
    'Falha ao salvar configuração Amazon',
  );
}

export async function saveScoreSettings(
  form: Record<string, string>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return runSave(async () => {
    const config = parseScoreConfigFromForm(form);
    await saveScoreConfig(config);
  }, 'Falha ao salvar regras de score');
}
