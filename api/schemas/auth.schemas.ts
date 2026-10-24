import { z } from 'zod';

export const loginBodySchema = z.object({
  username: z.string().trim().min(1, 'username é obrigatório'),
  password: z.string().min(1, 'password é obrigatório'),
});

export const refreshBodySchema = z.object({
  refreshToken: z.string().trim().min(1, 'refreshToken é obrigatório'),
});

export const logoutBodySchema = refreshBodySchema;

export type LoginBody = z.infer<typeof loginBodySchema>;
export type RefreshBody = z.infer<typeof refreshBodySchema>;
