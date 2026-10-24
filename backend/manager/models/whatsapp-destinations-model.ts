import {
  createWhatsAppDestinationId,
  listWhatsAppDestinations,
  removeWhatsAppDestination,
  syncLegacyWhatsAppChannelFields,
  toggleWhatsAppDestination,
  upsertWhatsAppDestination,
} from '../../src/accounts/whatsapp-destinations.js';
import { findAccount, saveAccounts, loadAccounts } from '../../src/accounts/repository.js';
import { DEFAULT_ACCOUNT_ID, type WhatsAppAccount, type WhatsAppDestination } from '../../src/accounts/types.js';
import {
  connectWhatsApp,
  setWhatsAppAuthPath,
  WhatsAppOwnedElsewhereError,
} from '../../src/whatsapp/index.js';
import {
  isWhatsAppWorkerActive,
  requestWhatsAppInviteResolve,
} from '../../src/whatsapp/invite-resolve-rpc.js';
import { resolveWhatsAppInvite, normalizeWhatsAppInviteLink } from '../../src/whatsapp/invite.js';
import { resolveAccountAuthPath } from '../../src/accounts/repository.js';
import { hydrateIntegrationState } from '../../src/channels/integration-state.js';
import type { SaveResult } from './shared/save-result.js';

export interface WhatsAppDestinationView {
  id: string;
  jid: string;
  kind: WhatsAppDestination['kind'];
  label: string | null;
  inviteLink: string | null;
  enabled: boolean;
  kindLabel: string;
}

function toView(destination: WhatsAppDestination): WhatsAppDestinationView {
  return {
    id: destination.id,
    jid: destination.jid,
    kind: destination.kind,
    label: destination.label ?? null,
    inviteLink: destination.inviteLink ?? null,
    enabled: destination.enabled,
    kindLabel: destination.kind === 'group' ? 'Grupo' : 'Canal',
  };
}

async function getWhatsAppAccount(accountId: string): Promise<WhatsAppAccount | null> {
  const account = await findAccount(accountId, 'whatsapp');
  if (!account || account.platform !== 'whatsapp') return null;
  return account;
}

async function persistWhatsAppAccount(account: WhatsAppAccount): Promise<void> {
  const accounts = await loadAccounts();
  const index = accounts.findIndex(
    (row) => row.id === account.id && row.platform === 'whatsapp',
  );
  const next = [...accounts];
  if (index >= 0) {
    next[index] = account;
  } else {
    next.push(account);
  }
  await saveAccounts(next);
  await hydrateIntegrationState();
}

export async function loadWhatsAppDestinationViews(
  accountId: string = DEFAULT_ACCOUNT_ID,
): Promise<WhatsAppDestinationView[]> {
  const account = await getWhatsAppAccount(accountId);
  if (!account) return [];
  return listWhatsAppDestinations(account.config).map(toView);
}

export async function addWhatsAppDestination(
  accountId: string,
  inviteInput: string,
): Promise<SaveResult> {
  return saveWhatsAppDestinationFromInvite(accountId, inviteInput, {
    allowGroup: true,
    rejectDuplicate: true,
  });
}

/** Configura o canal principal a partir do link de compartilhamento. */
export async function savePrimaryWhatsAppChannelFromInvite(
  accountId: string,
  inviteLink: string,
): Promise<SaveResult> {
  return saveWhatsAppDestinationFromInvite(accountId, inviteLink, {
    allowGroup: false,
    rejectDuplicate: false,
  });
}

async function resolveInviteForAccount(
  account: WhatsAppAccount,
  inviteInput: string,
): Promise<Awaited<ReturnType<typeof resolveWhatsAppInvite>>> {
  if (await isWhatsAppWorkerActive(account.id)) {
    return requestWhatsAppInviteResolve(account.id, inviteInput);
  }

  const authPath = resolveAccountAuthPath(account.id, 'whatsapp');
  setWhatsAppAuthPath(authPath);
  const sock = await connectWhatsApp({ authPath, accountId: account.id });
  return resolveWhatsAppInvite(sock, inviteInput);
}

async function saveWhatsAppDestinationFromInvite(
  accountId: string,
  inviteInput: string,
  options: { allowGroup: boolean; rejectDuplicate: boolean },
): Promise<SaveResult> {
  const trimmed = inviteInput.trim();
  if (!trimmed) {
    return { ok: false, error: 'Informe o link de compartilhamento do canal' };
  }

  const account = await getWhatsAppAccount(accountId);
  if (!account) {
    return { ok: false, error: 'Conta WhatsApp não encontrada' };
  }

  setWhatsAppAuthPath(resolveAccountAuthPath(account.id, 'whatsapp'));

  try {
    const resolved = await resolveInviteForAccount(account, trimmed);

    if (!options.allowGroup && resolved.kind !== 'newsletter') {
      return {
        ok: false,
        error:
          'Este link é de grupo — cole o link de compartilhamento do canal (whatsapp.com/channel/...)',
      };
    }

    const destinations = listWhatsAppDestinations(account.config);
    const duplicate = destinations.find((destination) => destination.jid === resolved.jid);
    if (options.rejectDuplicate && duplicate) {
      return { ok: false, error: 'Este destino já está configurado' };
    }

    const inviteLink =
      resolved.inviteLink ??
      normalizeWhatsAppInviteLink(trimmed, resolved.kind === 'group' ? 'group' : 'newsletter');

    const destination: WhatsAppDestination = duplicate
      ? {
          ...duplicate,
          label: resolved.label ?? duplicate.label,
          inviteLink,
          enabled: true,
        }
      : {
          id: createWhatsAppDestinationId(),
          jid: resolved.jid,
          kind: resolved.kind,
          label: resolved.label,
          inviteLink,
          enabled: true,
        };

    const nextConfig = upsertWhatsAppDestination(account.config, destination);
    await persistWhatsAppAccount({ ...account, config: syncLegacyWhatsAppChannelFields(nextConfig) });
    return { ok: true };
  } catch (error) {
    if (error instanceof WhatsAppOwnedElsewhereError) {
      return {
        ok: false,
        error:
          'WhatsApp ativo em outro processo — aguarde o worker responder ou reinicie o serviço worker',
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

export async function removeWhatsAppDestinationById(
  accountId: string,
  destinationId: string,
): Promise<SaveResult> {
  const account = await getWhatsAppAccount(accountId);
  if (!account) {
    return { ok: false, error: 'Conta WhatsApp não encontrada' };
  }

  const nextConfig = removeWhatsAppDestination(account.config, destinationId);
  await persistWhatsAppAccount({ ...account, config: syncLegacyWhatsAppChannelFields(nextConfig) });
  return { ok: true };
}

export async function setWhatsAppDestinationEnabled(
  accountId: string,
  destinationId: string,
  enabled: boolean,
): Promise<SaveResult> {
  const account = await getWhatsAppAccount(accountId);
  if (!account) {
    return { ok: false, error: 'Conta WhatsApp não encontrada' };
  }

  const nextConfig = toggleWhatsAppDestination(account.config, destinationId, enabled);
  await persistWhatsAppAccount({ ...account, config: syncLegacyWhatsAppChannelFields(nextConfig) });
  return { ok: true };
}

export async function ensureDefaultWhatsAppDestinationFromEnv(): Promise<void> {
  const account = await getWhatsAppAccount(DEFAULT_ACCOUNT_ID);
  if (!account) return;

  const destinations = listWhatsAppDestinations(account.config);
  if (destinations.length > 0) return;

  const synced = syncLegacyWhatsAppChannelFields(account.config);
  if (synced.destinations?.length) {
    await persistWhatsAppAccount({ ...account, config: synced });
  }
}
