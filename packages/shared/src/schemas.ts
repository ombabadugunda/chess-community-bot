import { z } from "zod";

export const RegisterPlayerSchema = z.object({
  telegramId: z.string().min(1),
  nickname: z.string().min(2).max(32)
});

export const ReportGameSchema = z.object({
  reporterTelegramId: z.string().min(1),
  opponentPlayerId: z.string().uuid(),
  result: z.enum(["A_WIN", "B_WIN", "DRAW"]),
  timeControl: z.enum(["blitz", "rapid", "classical"]).optional(),
  playedAt: z.string().datetime().optional()
});

export const ConfirmGameSchema = z.object({
  telegramId: z.string().min(1) // хто підтверджує (опонент)
});

export const DisputeGameSchema = z.object({
  telegramId: z.string().min(1),
  reason: z.string().min(1).max(300).optional()
});