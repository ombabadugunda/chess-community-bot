export type EloResult = "A_WIN" | "B_WIN" | "DRAW";

function expectedScore(ratingA: number, ratingB: number) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function scoreFromResult(result: EloResult) {
  if (result === "A_WIN") return { a: 1, b: 0 };
  if (result === "B_WIN") return { a: 0, b: 1 };
  return { a: 0.5, b: 0.5 };
}

export function kFactor(gamesPlayed: number) {
  if (gamesPlayed < 30) return 40;
  if (gamesPlayed < 100) return 20;
  return 10;
}

export function applyElo(params: {
  ratingA: number;
  ratingB: number;
  gamesA: number;
  gamesB: number;
  result: EloResult;
}) {
  const { ratingA, ratingB, gamesA, gamesB, result } = params;

  const EA = expectedScore(ratingA, ratingB);
  const EB = 1 - EA;

  const { a: SA, b: SB } = scoreFromResult(result);

  const KA = kFactor(gamesA);
  const KB = kFactor(gamesB);

  const newA = Math.round(ratingA + KA * (SA - EA));
  const newB = Math.round(ratingB + KB * (SB - EB));

  return { newA, newB, deltaA: newA - ratingA, deltaB: newB - ratingB, KA, KB, EA, EB, SA, SB };
}
