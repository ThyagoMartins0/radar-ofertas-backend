import type { AccountsPageData } from '../../manager/models/accounts-model.js';

export function serializeAccounts(data: AccountsPageData) {
  return {
    integrations: data.integrations,
    marketplaces: data.marketplaces,
    integrationPlatforms: data.integrationPlatforms,
    marketplacePlatforms: data.marketplacePlatforms,
    canSpawnWorkers: data.canSpawnWorkers,
    novncPort: data.novncPort,
  };
}
