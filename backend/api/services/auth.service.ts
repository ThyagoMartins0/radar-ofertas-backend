import { compare, hash } from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';

import { env } from '../../src/config/env.js';
import { UnauthorizedError } from '../errors/api-errors.js';
import {
  countUsers,
  createUser,
  findUserById,
  findUserByUsername,
  toPublicUser,
  type PublicUser,
} from '../repositories/user.repository.js';
import {
  consumeRefreshToken,
  generateRefreshTokenValue,
  getRefreshTokenTtlSeconds,
  revokeRefreshToken,
  storeRefreshToken,
} from './refresh-token-store.js';

const BCRYPT_ROUNDS = 12;
const ACCESS_TOKEN_TYPE = 'access';

export type AccessTokenPayload = {
  sub: string;
  username: string;
  type: typeof ACCESS_TOKEN_TYPE;
};

export type AuthTokensResponse = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  refreshExpiresIn: number;
};

function getJwtSecret(): Uint8Array {
  const secret = env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET é obrigatório para subir a API REST');
  }
  return new TextEncoder().encode(secret);
}

function parseAccessExpiresInSeconds(): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/i.exec(env.JWT_ACCESS_EXPIRES_IN.trim());
  if (!match) {
    throw new Error(`JWT_ACCESS_EXPIRES_IN inválido: ${env.JWT_ACCESS_EXPIRES_IN}`);
  }
  const amount = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();
  const multipliers: Record<string, number> = {
    ms: 0.001,
    s: 1,
    m: 60,
    h: 3600,
    d: 86_400,
  };
  const multiplier = multipliers[unit];
  if (multiplier === undefined) {
    throw new Error(`Unidade JWT_ACCESS_EXPIRES_IN inválida: ${unit}`);
  }
  return Math.max(1, Math.round(amount * multiplier));
}

async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  const expiresInSeconds = parseAccessExpiresInSeconds();
  return new SignJWT({ username: payload.username, type: ACCESS_TOKEN_TYPE })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${expiresInSeconds}s`)
    .sign(getJwtSecret());
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      algorithms: ['HS256'],
    });

    const sub = payload.sub;
    const username = payload.username;
    const type = payload.type;

    if (typeof sub !== 'string' || typeof username !== 'string' || type !== ACCESS_TOKEN_TYPE) {
      throw new UnauthorizedError('Token de acesso inválido');
    }

    return { sub, username, type: ACCESS_TOKEN_TYPE };
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    throw new UnauthorizedError('Token de acesso inválido ou expirado');
  }
}

async function issueTokenPair(userId: string, username: string): Promise<AuthTokensResponse> {
  const accessToken = await signAccessToken({
    sub: userId,
    username,
    type: ACCESS_TOKEN_TYPE,
  });
  const refreshToken = generateRefreshTokenValue();
  const refreshExpiresIn = getRefreshTokenTtlSeconds();

  await storeRefreshToken(refreshToken, userId, refreshExpiresIn);

  return {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    expiresIn: parseAccessExpiresInSeconds(),
    refreshExpiresIn,
  };
}

export async function login(username: string, password: string): Promise<AuthTokensResponse> {
  const user = await findUserByUsername(username.trim());
  if (!user) {
    throw new UnauthorizedError('Credenciais inválidas');
  }

  const valid = await compare(password, user.passwordHash);
  if (!valid) {
    throw new UnauthorizedError('Credenciais inválidas');
  }

  return issueTokenPair(user.id, user.username);
}

export async function refresh(refreshToken: string): Promise<AuthTokensResponse> {
  const userId = await consumeRefreshToken(refreshToken.trim());
  if (!userId) {
    throw new UnauthorizedError('Refresh token inválido ou expirado');
  }

  const user = await findUserById(userId);
  if (!user) {
    throw new UnauthorizedError('Usuário não encontrado');
  }

  return issueTokenPair(user.id, user.username);
}

export async function logout(refreshToken: string): Promise<void> {
  await revokeRefreshToken(refreshToken.trim());
}

export async function getAuthenticatedUser(userId: string): Promise<PublicUser> {
  const user = await findUserById(userId);
  if (!user) {
    throw new UnauthorizedError('Usuário não encontrado');
  }
  return toPublicUser(user);
}

export async function ensureDefaultAdmin(): Promise<void> {
  const total = await countUsers();
  if (total > 0) return;

  const username = env.API_ADMIN_USERNAME.trim();
  const password = env.API_ADMIN_PASSWORD;

  if (!username || !password) {
    throw new Error(
      'Nenhum usuário cadastrado — defina API_ADMIN_USERNAME e API_ADMIN_PASSWORD para bootstrap',
    );
  }

  const passwordHash = await hash(password, BCRYPT_ROUNDS);
  await createUser({ username, passwordHash });
}
