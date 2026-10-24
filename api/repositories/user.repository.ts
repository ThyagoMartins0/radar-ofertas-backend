import { execute, newId, queryOne } from '../../src/database/client.js';

export type UserRecord = {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
};

const USER_COLUMNS =
  'id, username, password_hash AS passwordHash, created_at AS createdAt, updated_at AS updatedAt';

function mapUser(row: UserRecord): UserRecord {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.passwordHash,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function countUsers(): Promise<number> {
  const row = await queryOne<{ total: number }>('SELECT COUNT(*) AS total FROM users');
  return Number(row?.total ?? 0);
}

export async function findUserByUsername(username: string): Promise<UserRecord | null> {
  const row = await queryOne<UserRecord>(`SELECT ${USER_COLUMNS} FROM users WHERE username = ?`, [
    username,
  ]);
  return row ? mapUser(row) : null;
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  const row = await queryOne<UserRecord>(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, [id]);
  return row ? mapUser(row) : null;
}

export async function createUser(input: {
  username: string;
  passwordHash: string;
}): Promise<UserRecord> {
  const now = new Date();
  const row: UserRecord = {
    id: newId(),
    username: input.username,
    passwordHash: input.passwordHash,
    createdAt: now,
    updatedAt: now,
  };
  await execute(
    'INSERT INTO users (id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [row.id, row.username, row.passwordHash, row.createdAt, row.updatedAt],
  );
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
