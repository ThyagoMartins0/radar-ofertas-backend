import { getEnabledChannels } from '../../src/channels/index.js';
import { CHANNEL_LABELS, type Channel } from '../../src/channels/types.js';
import {
  addCustomAmazonSource,
  buildAmazonSourceRows,
  hydrateAmazonSourcesCache,
  removeCustomAmazonSource,
  saveAmazonSourceChannelsFromForm,
  type AmazonSourceRow,
} from '../../src/config/amazon-sources-config.js';
import {
  addCustomMlSource,
  buildMlCategoryRows,
  hydrateMlSourcesCache,
  removeCustomMlSource,
  saveMlSourceChannelsFromForm,
  type MlCategoryRow,
} from '../../src/config/ml-sources-config.js';

export type SourcesSaveType = 'flags' | 'added' | 'removed' | null;

export interface SourcesPageData {
  channel: Channel;
  channelLabel: string;
  channels: { channel: Channel; label: string; active: boolean }[];
  mlRows: MlCategoryRow[];
  amazonRows: AmazonSourceRow[];
  activeCount: number;
  saved: SourcesSaveType;
  error: string | null;
}

export async function loadSourcesData(
  channel: Channel,
  saved: SourcesSaveType = null,
  error: string | null = null,
): Promise<SourcesPageData> {
  await Promise.all([hydrateMlSourcesCache(), hydrateAmazonSourcesCache()]);
  const mlRows = buildMlCategoryRows();
  const amazonRows = buildAmazonSourceRows();

  const activeCount =
    mlRows.filter((row) => row.channels.includes(channel)).length +
    amazonRows.filter((row) => row.channels.includes(channel)).length;

  return {
    channel,
    channelLabel: CHANNEL_LABELS[channel],
    channels: getEnabledChannels().map((ch) => ({
      channel: ch,
      label: CHANNEL_LABELS[ch],
      active: ch === channel,
    })),
    mlRows,
    amazonRows,
    activeCount,
    saved,
    error,
  };
}

export async function saveSourceFlags(
  channel: Channel,
  form: Record<string, string>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [ml, amazon] = await Promise.all([
    saveMlSourceChannelsFromForm(channel, form),
    saveAmazonSourceChannelsFromForm(channel, form),
  ]);

  if (!ml.ok) return ml;
  if (!amazon.ok) return amazon;
  return { ok: true };
}

export async function addMlSource(
  channel: Channel,
  url: string,
  label?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return addCustomMlSource(url, label, [channel]);
}

export async function addAmazonSource(
  channel: Channel,
  url: string,
  label?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return addCustomAmazonSource(url, label, [channel]);
}

export async function removeMlSource(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return removeCustomMlSource(id);
}

export async function removeAmazonSource(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return removeCustomAmazonSource(id);
}
