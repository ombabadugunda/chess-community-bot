import { RegisterPlayerSchema, ReportGameSchema } from "@chess/shared";

// Single source of truth for API base URL
const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3000";

// (Optional) helpful log while debugging
// console.log("BOT API_BASE_URL =", API_BASE_URL);

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE_URL}${path}`, init);
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${await res.text()}`);
  }
  return res;
}

export async function registerPlayer(telegramId: string, nickname: string) {
  const payload = RegisterPlayerSchema.parse({ telegramId, nickname });

  const res = await apiFetch("/players/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  return res.json();
}

export async function searchPlayers(q: string) {
  const res = await apiFetch(`/players/search?q=${encodeURIComponent(q)}`);
  return res.json() as Promise<Array<{ id: string; nickname: string }>>;
}

export async function listPlayers(params: { page?: number; limit?: number; excludeTelegramId?: string }) {
  const page = params.page ?? 1;
  const limit = params.limit ?? 10;

  const qs = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });

  if (params.excludeTelegramId) qs.set("excludeTelegramId", params.excludeTelegramId);

  const res = await apiFetch(`/players?${qs.toString()}`);

  return res.json() as Promise<{
    items: Array<{ id: string; nickname: string }>;
    page: number;
    limit: number;
    total: number;
    pages: number;
  }>;
}

export async function reportGame(params: {
  reporterTelegramId: string;
  opponentPlayerId: string;
  result: "A_WIN" | "B_WIN" | "DRAW";
}) {
  const payload = ReportGameSchema.parse({
    reporterTelegramId: params.reporterTelegramId,
    opponentPlayerId: params.opponentPlayerId,
    result: params.result,
  });

  const res = await apiFetch("/games/report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  return res.json();
}

export async function confirmGame(gameId: string, telegramId: string) {
  const res = await apiFetch(`/games/${gameId}/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ telegramId })
  });
  return res.json();
}

export async function disputeGame(gameId: string, telegramId: string) {
  const res = await apiFetch(`/games/${gameId}/dispute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ telegramId })
  });
  return res.json();
}

export async function leaderboard() {
  const res = await apiFetch("/leaderboard");
  return res.json() as Promise<Array<{ id: string; nickname: string; currentElo: number; gamesPlayed: number }>>;
}

export async function getPlayerByTelegram(telegramId: string) {
  const res = await apiFetch(`/players/by-telegram/${encodeURIComponent(telegramId)}`);
  return res.json() as Promise<{ id: string; nickname: string; currentElo: number; gamesPlayed: number }>;
}

export async function getPlayerHistory(playerId: string, limit = 10) {
  const res = await apiFetch(`/players/${playerId}/history?limit=${limit}`);
  return res.json() as Promise<{
    items: Array<{
      gameId: string;
      playedAt: string;
      opponent: { id: string; nickname: string };
      myScore: "1" | "0" | "½";
      rating: { delta: number; before: number; after: number } | null;
    }>;
  }>;
}