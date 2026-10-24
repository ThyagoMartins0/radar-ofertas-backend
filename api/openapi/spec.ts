type HttpMethod = 'get' | 'post' | 'patch' | 'delete';

type PathOperation = {
  readonly summary: string;
  readonly auth?: boolean;
  readonly tags: readonly string[];
};

type OpenApiSpec = {
  readonly openapi: '3.1.0';
  readonly info: { readonly title: string; readonly version: string; readonly description: string };
  readonly servers: readonly { readonly url: string }[];
  readonly tags: readonly { readonly name: string; readonly description: string }[];
  readonly paths: Record<string, Partial<Record<HttpMethod, PathOperation & { readonly responses: Record<string, { description: string }> }>>>;
  readonly components: {
    readonly securitySchemes: {
      readonly bearerAuth: { readonly type: 'http'; readonly scheme: 'bearer'; readonly bearerFormat: 'JWT' };
    };
    readonly schemas: {
      readonly ApiError: {
        readonly type: 'object';
        readonly properties: {
          readonly error: { readonly type: 'string' };
          readonly code: { readonly type: 'string' };
          readonly details: { readonly type: 'object'; readonly additionalProperties: true };
        };
        readonly required: readonly ['error', 'code'];
      };
    };
  };
};

function op(summary: string, tags: readonly string[], auth = true): PathOperation & { responses: Record<string, { description: string }> } {
  return {
    summary,
    auth,
    tags,
    responses: {
      '200': { description: 'Sucesso' },
      '400': { description: 'Validação inválida' },
      '401': { description: 'Não autenticado' },
      '404': { description: 'Recurso não encontrado' },
      '500': { description: 'Erro interno' },
    },
  };
}

function publicOp(summary: string, tags: readonly string[]) {
  return op(summary, tags, false);
}

const ROUTES: Array<{ path: string; method: HttpMethod; operation: ReturnType<typeof op> | ReturnType<typeof publicOp> }> = [
  { path: '/health', method: 'get', operation: publicOp('Health check (DB + processos)', ['Sistema']) },
  { path: '/health/collector', method: 'get', operation: publicOp('Health check do collector (Redis heartbeat)', ['Sistema']) },
  { path: '/health/worker', method: 'get', operation: publicOp('Health check do worker (Redis heartbeat)', ['Sistema']) },
  { path: '/auth/login', method: 'post', operation: publicOp('Login JWT', ['Auth']) },
  { path: '/auth/refresh', method: 'post', operation: publicOp('Renovar access token', ['Auth']) },
  { path: '/auth/logout', method: 'post', operation: publicOp('Encerrar sessão (refresh token)', ['Auth']) },
  { path: '/auth/me', method: 'get', operation: op('Usuário autenticado', ['Auth']) },
  { path: '/dashboard', method: 'get', operation: op('Status geral do sistema', ['Dashboard']) },
  { path: '/metrics', method: 'get', operation: op('Métricas de envio', ['Dashboard']) },
  { path: '/offers/collect', method: 'post', operation: op('Enfileirar coleta manual', ['Dashboard']) },
  { path: '/offers', method: 'get', operation: op('Listar ofertas', ['Ofertas']) },
  { path: '/offers/{id}', method: 'get', operation: op('Detalhe da oferta', ['Ofertas']) },
  { path: '/offers/{id}', method: 'delete', operation: op('Remover oferta', ['Ofertas']) },
  { path: '/offers/{id}/send-now', method: 'post', operation: op('Enviar oferta imediatamente', ['Ofertas']) },
  { path: '/offers/pending', method: 'delete', operation: op('Remover ofertas pendentes', ['Ofertas']) },
  { path: '/offers/settings/search-limit', method: 'patch', operation: op('Atualizar limite de busca', ['Ofertas']) },
  { path: '/offers/settings/affiliate-delay', method: 'patch', operation: op('Atualizar delay de links afiliado', ['Ofertas']) },
  { path: '/settings', method: 'get', operation: op('Snapshot de configurações', ['Settings']) },
  { path: '/settings/score', method: 'patch', operation: op('Regras de pontuação', ['Settings']) },
  { path: '/settings/brand', method: 'patch', operation: op('Marca do painel', ['Settings']) },
  { path: '/settings/operating-hours', method: 'patch', operation: op('Janela operacional', ['Settings']) },
  { path: '/settings/send-interval', method: 'patch', operation: op('Intervalo de coleta', ['Settings']) },
  { path: '/settings/sender-delay', method: 'patch', operation: op('Delay entre envios', ['Settings']) },
  { path: '/settings/coupons-url', method: 'patch', operation: op('URL da página de cupons ML', ['Settings']) },
  { path: '/settings/amazon-affiliate', method: 'patch', operation: op('Config afiliado Amazon', ['Settings']) },
  { path: '/template', method: 'get', operation: op('Templates e auto-messages', ['Template']) },
  { path: '/template/offer', method: 'patch', operation: op('Template de ofertas', ['Template']) },
  { path: '/template/coupon', method: 'patch', operation: op('Template de cupons', ['Template']) },
  { path: '/auto-messages', method: 'post', operation: op('Criar auto-message', ['Template']) },
  { path: '/auto-messages/{id}', method: 'patch', operation: op('Editar auto-message', ['Template']) },
  { path: '/auto-messages/{id}', method: 'delete', operation: op('Remover auto-message', ['Template']) },
  { path: '/auto-messages/{id}/send', method: 'post', operation: op('Enviar auto-message manualmente', ['Template']) },
  { path: '/coupons', method: 'get', operation: op('Listar cupons ML', ['Cupons']) },
  { path: '/coupons/refresh', method: 'post', operation: op('Atualizar cupons', ['Cupons']) },
  { path: '/coupons/{id}/send', method: 'post', operation: op('Enviar cupom', ['Cupons']) },
  { path: '/coupons/{id}/store-link', method: 'patch', operation: op('Link da loja do cupom', ['Cupons']) },
  { path: '/sources/{channel}', method: 'get', operation: op('Fontes ML/Amazon do canal', ['Fontes']) },
  { path: '/sources/{channel}', method: 'patch', operation: op('Salvar toggles de fontes', ['Fontes']) },
  { path: '/sources/{channel}/ml', method: 'post', operation: op('Adicionar fonte ML', ['Fontes']) },
  { path: '/sources/{channel}/ml/{sourceId}', method: 'delete', operation: op('Remover fonte ML', ['Fontes']) },
  { path: '/sources/{channel}/amazon', method: 'post', operation: op('Adicionar fonte Amazon', ['Fontes']) },
  { path: '/sources/{channel}/amazon/{sourceId}', method: 'delete', operation: op('Remover fonte Amazon', ['Fontes']) },
  { path: '/accounts', method: 'get', operation: op('Listar contas', ['Contas']) },
  { path: '/accounts', method: 'post', operation: op('Adicionar conta', ['Contas']) },
  { path: '/accounts/{accountId}/{platform}/toggle', method: 'patch', operation: op('Habilitar/desabilitar conta', ['Contas']) },
  { path: '/accounts/{accountId}/{platform}', method: 'delete', operation: op('Remover conta', ['Contas']) },
  { path: '/accounts/{accountId}/whatsapp-channel', method: 'patch', operation: op('Canal WhatsApp', ['Contas']) },
  { path: '/accounts/{accountId}/whatsapp-destinations', method: 'post', operation: op('Adicionar destino WhatsApp', ['Contas']) },
  { path: '/accounts/{accountId}/whatsapp-destinations', method: 'delete', operation: op('Remover destino WhatsApp', ['Contas']) },
  { path: '/accounts/{accountId}/whatsapp-destinations/toggle', method: 'patch', operation: op('Toggle destino WhatsApp', ['Contas']) },
  { path: '/accounts/{accountId}/telegram', method: 'patch', operation: op('Config Telegram', ['Contas']) },
  { path: '/accounts/{accountId}/mercado-livre', method: 'patch', operation: op('Config Mercado Livre', ['Contas']) },
  { path: '/accounts/{accountId}/connect/whatsapp/start', method: 'post', operation: op('Iniciar pareamento WhatsApp', ['Conexões']) },
  { path: '/accounts/{accountId}/connect/whatsapp/status', method: 'get', operation: op('Status/QR WhatsApp', ['Conexões']) },
  { path: '/accounts/{accountId}/connect/mercado-livre/start', method: 'post', operation: op('Iniciar login ML', ['Conexões']) },
  { path: '/accounts/{accountId}/connect/mercado-livre/finish', method: 'post', operation: op('Finalizar login ML', ['Conexões']) },
  { path: '/accounts/{accountId}/connect/mercado-livre/cancel', method: 'post', operation: op('Cancelar login ML', ['Conexões']) },
  { path: '/accounts/{accountId}/connect/mercado-livre/status', method: 'get', operation: op('Status login ML', ['Conexões']) },
  { path: '/accounts/{accountId}/connect/telegram/verify', method: 'get', operation: op('Verificar Telegram', ['Conexões']) },
  { path: '/worker/status', method: 'get', operation: op('Status do worker', ['Workers']) },
  { path: '/worker/start', method: 'post', operation: op('Iniciar worker local', ['Workers']) },
  { path: '/worker/stop', method: 'post', operation: op('Parar worker local', ['Workers']) },
  { path: '/worker/restart', method: 'post', operation: op('Reiniciar worker local', ['Workers']) },
  { path: '/prisma/status', method: 'get', operation: op('Status Prisma generate', ['Workers']) },
  { path: '/prisma/generate', method: 'post', operation: op('Executar prisma generate', ['Workers']) },
  { path: '/logs', method: 'get', operation: op('Logs paginados/filtrados', ['Logs']) },
  { path: '/logs/stream', method: 'get', operation: op('Stream SSE de logs em tempo real', ['Logs']) },
];

export function buildOpenApiSpec(): OpenApiSpec {
  const paths: OpenApiSpec['paths'] = {};

  for (const route of ROUTES) {
    const existing = paths[route.path] ?? {};
    const { auth, ...operation } = route.operation;
    const security = auth ? [{ bearerAuth: [] }] : undefined;
    paths[route.path] = {
      ...existing,
      [route.method]: {
        ...operation,
        ...(security ? { security } : {}),
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Radar Ofertas API',
      version: '1.0.0',
      description:
        'API REST do painel admin. Autenticação via JWT Bearer (header Authorization). Prefixo base: /api/v1.',
    },
    servers: [{ url: '/api/v1' }],
    tags: [
      { name: 'Sistema', description: 'Health e metadados' },
      { name: 'Auth', description: 'Login JWT' },
      { name: 'Dashboard', description: 'Status e métricas' },
      { name: 'Ofertas', description: 'CRUD e envio de ofertas' },
      { name: 'Settings', description: 'Configurações runtime' },
      { name: 'Template', description: 'Templates e auto-messages' },
      { name: 'Cupons', description: 'Cupons ML' },
      { name: 'Fontes', description: 'Fontes de coleta por canal' },
      { name: 'Contas', description: 'Multi-conta' },
      { name: 'Conexões', description: 'WhatsApp, ML, Telegram' },
      { name: 'Workers', description: 'Worker e Prisma' },
      { name: 'Logs', description: 'Auditoria e scrape ML' },
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        ApiError: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
            details: { type: 'object', additionalProperties: true },
          },
          required: ['error', 'code'],
        },
      },
    },
  };
}
