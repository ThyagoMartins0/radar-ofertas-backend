import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isPlaceholderChannelId } from './index.js';

describe('isPlaceholderChannelId', () => {
  it('detecta placeholder padrão do Baileys', () => {
    assert.equal(isPlaceholderChannelId('120363000000000000@newsletter'), true);
  });

  it('rejeita canal real', () => {
    assert.equal(isPlaceholderChannelId('120363120768375741@newsletter'), false);
  });
});
