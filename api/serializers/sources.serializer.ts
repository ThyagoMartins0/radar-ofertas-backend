import type { SourcesPageData } from '../../manager/models/sources-model.js';

export function serializeSources(data: SourcesPageData) {
  return {
    channel: data.channel,
    channelLabel: data.channelLabel,
    channels: data.channels,
    mlRows: data.mlRows,
    amazonRows: data.amazonRows,
    activeCount: data.activeCount,
  };
}
