import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getAccountsCachedSync, invalidateAccountsCache } from '../accounts/repository.js';
import {
  hydrateCollectionPlatformsCache,
  invalidateCollectionPlatformsCache,
  isAmazonCollectionEnabled,
  isMercadoLivreCollectionEnabled,
} from './collection-platforms-config.js';

describe('collection-platforms-config', () => {
  it('isMercadoLivreCollectionEnabled reflete conta default', () => {
    invalidateAccountsCache();
    const accounts = getAccountsCachedSync();
    const ml = accounts.find((account) => account.platform === 'mercado_livre');
    assert.ok(ml);
    assert.equal(isMercadoLivreCollectionEnabled(), ml.enabled);
  });

  it('isAmazonCollectionEnabled usa true como padrão', async () => {
    invalidateCollectionPlatformsCache();
    await hydrateCollectionPlatformsCache();
    assert.equal(isAmazonCollectionEnabled(), true);
  });
});
