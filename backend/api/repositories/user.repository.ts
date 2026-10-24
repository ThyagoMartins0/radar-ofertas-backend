import { prisma } from '../../src/database/client.js';

export type UserRecord = {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
};

function mapUser(row: {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}): UserRecord {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.passwordHash,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function countUsers(): Promise<number> {
  return prisma.user.count();
}

export async function findUserByUsername(username: string): Promise<UserRecord | null> {
  const row = await prisma.user.findUnique({ where: { username } });
  return row ? mapUser(row) : null;
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  const row = await prisma.user.findUnique({ where: { id } });
  return row ? mapUser(row) : null;
}

export async function createUser(input: {
  username: string;
  passwordHash: string;
}): Promise<UserRecord> {
  const row = await prisma.user.create({
    data: {
      username: input.username,
      passwordHash: input.passwordHash,
    },
  });
  return mapUser(row);
}

export type PublicUser = Pick<UserRecord, 'id' | 'username' | 'createdAt' | 'updatedAt'>;

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
