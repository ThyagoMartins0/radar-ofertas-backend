import type { SettingsData } from '../../manager/models/settings-model.js';

export function serializeSettings(data: SettingsData) {
  return {
    timezone: data.timezone,
    operatingHours: data.operatingHours,
    operatingHoursLabel: data.operatingHoursLabel,
    withinOperatingHours: data.withinOperatingHours,
    minScore: data.minScore,
    scoreConfig: data.scoreConfig,
    scoreRulesSummary: data.scoreRulesSummary,
    collectorIntervalMinutes: data.collectorIntervalMinutes,
    senderDelayMinutes: data.senderDelayMinutes,
    brand: {
      name: data.brandName,
      subtitle: data.brandSubtitle,
      logoHref: data.brandLogoHref,
      initial: data.brandInitial,
    },
    sessions: {
      mercadoLivre: data.mlSession,
      whatsapp: data.waSession,
      telegram: data.tgSession,
    },
    telegram: {
      enabled: data.telegramEnabled,
      chatId: data.telegramChatId,
      hasBotToken: data.telegramHasBotToken,
    },
    worker: {
      state: data.workerState,
      sender: data.senderWorker,
      canSpawnWorkers: data.canSpawnWorkers,
    },
    novncPort: data.novncPort,
    mlCouponsUrl: data.mlCouponsUrl,
    amazonAffiliate: {
      baseUrl: data.amazonBaseUrl,
      affiliateLinkPrefix: data.amazonAffiliateLinkPrefix,
      storeId: data.amazonAffiliateStoreId,
    },
    amazonCollectionEnabled: data.amazonCollectionEnabled,
  };
}
