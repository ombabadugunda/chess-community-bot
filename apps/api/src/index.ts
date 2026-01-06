import Fastify from "fastify";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { RegisterPlayerSchema, ReportGameSchema } from "@chess/shared";
import { ConfirmGameSchema, DisputeGameSchema } from "@chess/shared";
import { applyElo } from "./elo.js";

const prisma = new PrismaClient();

const app = Fastify({
  logger: {
    transport: { target: "pino-pretty" }
  }
});

app.get("/health", async () => ({ ok: true }));

app.post("/players/register", async (req, reply) => {
  const body = RegisterPlayerSchema.parse(req.body);

  const player = await prisma.player.upsert({
    where: { telegramId: body.telegramId },
    update: { nickname: body.nickname },
    create: { telegramId: body.telegramId, nickname: body.nickname }
  });

  return reply.send(player);
});

app.get("/players", async (req, reply) => {
  const page = z.coerce.number().int().min(1).default(1).parse((req.query as any)?.page);
  const limit = z.coerce.number().int().min(1).max(20).default(10).parse((req.query as any)?.limit);
  const excludeTelegramId = z
    .string()
    .optional()
    .parse((req.query as any)?.excludeTelegramId);

  const where = excludeTelegramId
    ? { telegramId: { not: excludeTelegramId } }
    : {};

  const [items, total] = await Promise.all([
    prisma.player.findMany({
      where,
      orderBy: { nickname: "asc" },
      skip: (page - 1) * limit,
      take: limit,
      select: { id: true, nickname: true }
    }),
    prisma.player.count({ where })
  ]);

  return reply.send({
    items,
    page,
    limit,
    total,
    pages: Math.max(1, Math.ceil(total / limit))
  });
});

app.get("/players/search", async (req, reply) => {
  const q = z
    .string()
    .min(1)
    .parse((req.query as any)?.q ?? "");

  const players = await prisma.player.findMany({
    where: {
      nickname: { contains: q, mode: "insensitive" }
    },
    orderBy: { nickname: "asc" },
    take: 8,
    select: { id: true, nickname: true }
  });

  return reply.send(players);
});

app.post("/games/report", async (req, reply) => {
  const body = ReportGameSchema.parse(req.body);

  // reporter is always "A" in this minimal model
  const reporter = await prisma.player.findUnique({ where: { telegramId: body.reporterTelegramId } });
  if (!reporter) return reply.code(404).send({ error: "Reporter not found. Register first." });

  const opponent = await prisma.player.findUnique({ where: { id: body.opponentPlayerId } });
  if (!opponent) return reply.code(404).send({ error: "Opponent not found." });

  const game = await prisma.game.create({
  data: {
    playerAId: reporter.id,
    playerBId: opponent.id,
    result: body.result as any,
    status: "PENDING",
    timeControl: body.timeControl as any,
    reportedBy: reporter.telegramId,
    playedAt: body.playedAt ? new Date(body.playedAt) : new Date()
  },
  include: {
    playerA: { select: { telegramId: true, nickname: true } }, // репортер
    playerB: { select: { telegramId: true, nickname: true } }  // опонент
  }
});

return reply.send(game);
});

app.post("/games/:id/confirm", async (req, reply) => {
  const gameId = z.string().uuid().parse((req.params as any).id);
  const body = ConfirmGameSchema.parse(req.body);

  const confirmer = await prisma.player.findUnique({ where: { telegramId: body.telegramId } });
  if (!confirmer) return reply.code(404).send({ error: "Confirmer not found" });

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      playerA: true, // репортер
      playerB: true  // опонент
    }
  });
  if (!game) return reply.code(404).send({ error: "Game not found" });

  if (game.playerBId !== confirmer.id) {
    return reply.code(403).send({ error: "Only opponent can confirm" });
  }
  if (game.status !== "PENDING") {
    return reply.code(409).send({ error: `Game is not pending (status=${game.status})` });
  }

  const calc = applyElo({
    ratingA: game.playerA.currentElo,
    ratingB: game.playerB.currentElo,
    gamesA: game.playerA.gamesPlayed,
    gamesB: game.playerB.gamesPlayed,
    result: game.result as any
  });

  const updated = await prisma.$transaction(async (tx) => {
    // 1) confirm game (щоб не підтвердили двічі паралельно)
    const g = await tx.game.update({
      where: { id: gameId },
      data: { status: "CONFIRMED", confirmedBy: body.telegramId }
    });

    // 2) rating changes (історія)
    await tx.ratingChange.createMany({
      data: [
        {
          gameId,
          playerId: game.playerAId,
          eloBefore: game.playerA.currentElo,
          eloAfter: calc.newA,
          delta: calc.deltaA
        },
        {
          gameId,
          playerId: game.playerBId,
          eloBefore: game.playerB.currentElo,
          eloAfter: calc.newB,
          delta: calc.deltaB
        }
      ]
    });

    // 3) update players current rating + games played
    await tx.player.update({
      where: { id: game.playerAId },
      data: { currentElo: calc.newA, gamesPlayed: { increment: 1 } }
    });
    await tx.player.update({
      where: { id: game.playerBId },
      data: { currentElo: calc.newB, gamesPlayed: { increment: 1 } }
    });

    // 4) повернемо розширену відповідь для бота
    return tx.game.findUnique({
      where: { id: g.id },
      include: {
        playerA: { select: { telegramId: true, nickname: true, currentElo: true } },
        playerB: { select: { telegramId: true, nickname: true, currentElo: true } }
      }
    });
  });

  return reply.send({ game: updated, rating: calc });
});

app.post("/games/:id/dispute", async (req, reply) => {
  const gameId = z.string().uuid().parse((req.params as any).id);
  const body = DisputeGameSchema.parse(req.body);

  const disputer = await prisma.player.findUnique({ where: { telegramId: body.telegramId } });
  if (!disputer) return reply.code(404).send({ error: "Disputer not found" });

  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) return reply.code(404).send({ error: "Game not found" });

  if (game.playerBId !== disputer.id) {
    return reply.code(403).send({ error: "Only opponent can dispute" });
  }
  if (game.status !== "PENDING") {
    return reply.code(409).send({ error: `Game is not pending (status=${game.status})` });
  }

  const updated = await prisma.game.update({
  where: { id: gameId },
  data: { status: "DISPUTED", confirmedBy: body.telegramId },
  include: {
    playerA: { select: { telegramId: true, nickname: true } },
    playerB: { select: { telegramId: true, nickname: true } }
  }
});
return reply.send(updated);
});

app.get("/leaderboard", async () => {
  return prisma.player.findMany({
    orderBy: { currentElo: "desc" },
    take: 20,
    select: { id: true, nickname: true, currentElo: true, gamesPlayed: true }
  });
});

app.get("/players/by-telegram/:telegramId", async (req, reply) => {
  const telegramId = z.string().min(1).parse((req.params as any).telegramId);

  const player = await prisma.player.findUnique({
    where: { telegramId },
    select: { id: true, nickname: true, currentElo: true, gamesPlayed: true }
  });

  if (!player) return reply.code(404).send({ error: "Player not found" });
  return reply.send(player);
});

app.get("/players/:id/history", async (req, reply) => {
  const playerId = z.string().uuid().parse((req.params as any).id);
  const limit = z.coerce.number().int().min(1).max(30).default(10).parse((req.query as any)?.limit);

  const games = await prisma.game.findMany({
    where: {
      status: "CONFIRMED",
      OR: [{ playerAId: playerId }, { playerBId: playerId }]
    },
    orderBy: { playedAt: "desc" },
    take: limit,
    include: {
      playerA: { select: { id: true, nickname: true } },
      playerB: { select: { id: true, nickname: true } },
      ratingChanges: {
        where: { playerId },
        select: { delta: true, eloBefore: true, eloAfter: true }
      }
    }
  });

  // Нормалізуємо відповідь для UI
  const items = games.map((g) => {
    const isA = g.playerAId === playerId;
    const me = isA ? g.playerA : g.playerB;
    const opp = isA ? g.playerB : g.playerA;

    // результат з точки зору гравця
    const myScore =
      g.result === "DRAW" ? "½" :
      (g.result === "A_WIN" && isA) || (g.result === "B_WIN" && !isA) ? "1" : "0";

    const rc = g.ratingChanges[0] ?? null;

    return {
      gameId: g.id,
      playedAt: g.playedAt,
      opponent: { id: opp.id, nickname: opp.nickname },
      result: g.result,
      myScore,
      rating: rc ? { delta: rc.delta, before: rc.eloBefore, after: rc.eloAfter } : null
    };
  });

  return reply.send({ items });
});

const port = Number(process.env.API_PORT ?? 3000);
app.listen({ port, host: "0.0.0.0" }).then(() => {
  app.log.info(`API listening on :${port}`);
});
