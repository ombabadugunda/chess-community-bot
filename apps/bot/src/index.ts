import "dotenv/config";
import { Bot, Context, session } from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations";
import { registerPlayer } from "./api.js";
import { ReportGameSchema } from "@chess/shared";
import { Bot, Context, session, InlineKeyboard } from "grammy";
import { registerPlayer, searchPlayers, reportGame } from "./api.js";
import { listPlayers, reportGame, registerPlayer } from "./api.js";
import { confirmGame, disputeGame } from "./api.js";
import { leaderboard, getPlayerByTelegram, getPlayerHistory } from "./api.js";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3000";
console.log("API_BASE_URL:", process.env.API_BASE_URL);

type SessionData = {
  state?: string;
};

type MyContext = Context & { session: SessionData };

const token = process.env.BOT_TOKEN;
if (!token) throw new Error("BOT_TOKEN is missing. Set it in .env");

const bot = new Bot<MyContext>(token);

function prettyResult(r: "A_WIN" | "B_WIN" | "DRAW") {
  if (r === "A_WIN") return "1-0 (репортер виграв)";
  if (r === "B_WIN") return "0-1 (репортер програв)";
  return "½-½ (нічия)";
}

bot.callbackQuery(/^game:confirm:/, async (ctx) => {
  const gameId = ctx.callbackQuery.data!.split(":")[2];
  const telegramId = String(ctx.from?.id ?? "");

  try {
    const updated = await confirmGame(gameId, telegramId);

    await ctx.editMessageText("Гру підтверджено ✅");

    // повідомляємо репортера (playerA)
const reporterTgId = Number(updated.game.playerA.telegramId);
    await ctx.api.sendMessage(
    reporterTgId,
    `✅ ${updated.game.playerB.nickname} підтвердив(ла) гру.\n` +
    `Новий рейтинг:\n` +
    `• ${updated.game.playerA.nickname}: ${updated.rating.newA} (${updated.rating.deltaA >= 0 ? "+" : ""}${updated.rating.deltaA})\n` +
    `• ${updated.game.playerB.nickname}: ${updated.rating.newB} (${updated.rating.deltaB >= 0 ? "+" : ""}${updated.rating.deltaB})`
    );
  } catch (e: any) {
    await ctx.answerCallbackQuery({ text: `Не вийшло: ${e.message}`, show_alert: true });
  }
});

bot.callbackQuery(/^game:dispute:/, async (ctx) => {
  const gameId = ctx.callbackQuery.data!.split(":")[2];
  const telegramId = String(ctx.from?.id ?? "");

  try {
    const updated = await disputeGame(gameId, telegramId);

    await ctx.editMessageText("Гру позначено як спірну ⚠️ (піде на модерацію)");

    const reporterTgId = Number(updated.playerA.telegramId);
    await ctx.api.sendMessage(
      reporterTgId,
      `⚠️ ${updated.playerB.nickname} заперечив(ла) гру.\nID: ${updated.id}\n(Далі: модерація/уточнення)`
    );
  } catch (e: any) {
    await ctx.answerCallbackQuery({ text: `Не вийшло: ${e.message}`, show_alert: true });
  }
});

function playersKeyboard(items: Array<{ id: string; nickname: string }>, page: number, pages: number) {
  const kb = new InlineKeyboard();
  for (const p of items) kb.text(p.nickname, `opponent:${p.id}`).row();

  const nav = new InlineKeyboard();
  if (page > 1) nav.text("⬅️ Назад", `players:page:${page - 1}`);
  if (page < pages) nav.text("➡️ Далі", `players:page:${page + 1}`);
  if (page > 1 || page < pages) kb.row().add(nav);

  return kb;
}

bot.use(session({ initial: (): SessionData => ({}) }));
bot.use(conversations());
bot.use(createConversation(reportConversation));
bot.command("report", async (ctx) => {
  await ctx.conversation.enter("reportConversation");
});

async function registerConversation(conversation: any, ctx: MyContext) {
  await ctx.reply("Вкажи свій нік (2-32 символи):");
  const msg = await conversation.wait();
  const nickname = msg.message?.text?.trim() ?? "";
  if (nickname.length < 2 || nickname.length > 32) {
    await ctx.reply("Нік має бути 2-32 символи. Спробуй ще раз: /register");
    return;
  }

  const telegramId = String(ctx.from?.id ?? "");
  try {
    await registerPlayer(telegramId, nickname);
    await ctx.reply(`Готово ✅ Ти зареєстрований як: ${nickname}`);
  } catch (e: any) {
    await ctx.reply(`Помилка реєстрації: ${e.message}`);
  }
}

async function reportConversation(conversation: any, ctx: MyContext) {
  const telegramId = String(ctx.from?.id ?? "");
  if (!telegramId) {
    await ctx.reply("Не бачу твій Telegram ID. Спробуй ще раз.");
    return;
  }

  const limit = 10;

  // Показуємо першу сторінку
  let page = 1;
  let resp = await listPlayers({ page, limit, excludeTelegramId: telegramId });

  if (!resp.items.length) {
    await ctx.reply("Поки що немає жодного зареєстрованого гравця. Спочатку /register");
    return;
  }

  const msg = await ctx.reply(
    `Обери опонента (сторінка ${resp.page}/${resp.pages}):`,
    { reply_markup: playersKeyboard(resp.items, resp.page, resp.pages) }
  );

  // Чекаємо або вибір опонента, або навігацію сторінками
  let opponentId: string | null = null;

  while (!opponentId) {
    const cb = await conversation.waitForCallbackQuery(/^(opponent:|players:page:)/);
    const data = cb.callbackQuery.data!;
    await cb.answerCallbackQuery();

    if (data.startsWith("players:page:")) {
      page = Number(data.split(":")[2]);
      resp = await listPlayers({ page, limit, excludeTelegramId: telegramId });

      await ctx.api.editMessageText(
        ctx.chat!.id,
        msg.message_id,
        `Обери опонента (сторінка ${resp.page}/${resp.pages}):`,
        { reply_markup: playersKeyboard(resp.items, resp.page, resp.pages) }
      );
      continue;
    }

    if (data.startsWith("opponent:")) {
      opponentId = data.split(":")[1];
    }
  }

  await ctx.reply("Результат для тебе:", {
    reply_markup: new InlineKeyboard()
      .text("Я виграв (1-0)", "result:A_WIN")
      .row()
      .text("Нічия (½-½)", "result:DRAW")
      .row()
      .text("Я програв (0-1)", "result:B_WIN")
  });

  const cb2 = await conversation.waitForCallbackQuery(/^result:/);
  const result = cb2.callbackQuery.data!.split(":")[1] as "A_WIN" | "B_WIN" | "DRAW";
  await cb2.answerCallbackQuery();

  try {
    const game = await reportGame({
      reporterTelegramId: telegramId,
      opponentPlayerId: opponentId,
      result
    });

    const confirmKb = new InlineKeyboard()
  .text("✅ Підтвердити", `game:confirm:${game.id}`)
  .row()
  .text("⚠️ Заперечити", `game:dispute:${game.id}`);

const opponentTgId = Number(game.playerB.telegramId);

try {
  await ctx.api.sendMessage(
    opponentTgId,
    `Привіт, ${game.playerB.nickname}!\n` +
      `${game.playerA.nickname} заніс(ла) гру проти тебе.\n` +
      `Результат (з боку репортера): ${prettyResult(game.result)}`
 +
      `Підтверди або запереч:`,
    { reply_markup: confirmKb }
  );

  await ctx.reply("Гру записано ✅ Попросив опонента підтвердити в приваті.");
} catch (e: any) {
  // Типово: 403 (не стартував бота/заблокував)
  await ctx.reply(
    "Гру записано ✅ але я не зміг написати опоненту в приват.\n" +
      "Нехай опонент відкриє бота і натисне /start, після цього спробуй /report ще раз."
  );
}
  } catch (e: any) {
    await ctx.reply(`Помилка запису гри: ${e.message}`);
  }
  
}

bot.use(createConversation(registerConversation));

bot.command("start", async (ctx) => {
  await ctx.reply("Команди:\n/register\n/report\n/leaderboard\n/history");
});

bot.command("help", async (ctx) => {
  await ctx.reply("Команди:\n/register\n/report\n/leaderboard\n/history");
});

bot.command("register", async (ctx) => {
  await ctx.conversation.enter("registerConversation");
});

bot.catch((err) => {
  console.error("Bot error:", err.error);
});

async function ensurePollingMode() {
  const token = process.env.BOT_TOKEN;
  if (!token) return;

  // Disable webhook so long polling works reliably
  const url = `https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=true`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    console.log("deleteWebhook:", data);
  } catch (e) {
    console.warn("Failed to delete webhook:", e);
  }
}

export async function searchPlayers(q: string) {
  const res = await fetch(`${API_BASE_URL}/players/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`API error: ${res.status} ${await res.text()}`);
  return res.json() as Promise<Array<{ id: string; nickname: string }>>;
}

export async function reportGame(params: {
  reporterTelegramId: string;
  opponentPlayerId: string;
  result: "A_WIN" | "B_WIN" | "DRAW";
}) {
  const payload = ReportGameSchema.parse({
    reporterTelegramId: params.reporterTelegramId,
    opponentPlayerId: params.opponentPlayerId,
    result: params.result
  });

  const res = await fetch(`${API_BASE_URL}/games/report`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) throw new Error(`API error: ${res.status} ${await res.text()}`);
  return res.json();
}

bot.command("leaderboard", async (ctx) => {
  try {
    const top = await leaderboard();
    if (!top.length) return ctx.reply("Поки що немає гравців.");

    const lines = top.map((p, i) =>
      `${String(i + 1).padStart(2, " ")}. ${p.nickname} — ${p.currentElo} (${p.gamesPlayed} ігор)`
    );

    await ctx.reply("🏆 Топ-20:\n" + lines.join("\n"));
  } catch (e: any) {
    await ctx.reply(`Помилка: ${e.message}`);
  }
});

bot.command("history", async (ctx) => {
  const telegramId = String(ctx.from?.id ?? "");
  if (!telegramId) return ctx.reply("Не бачу твій Telegram ID.");

  try {
    const me = await getPlayerByTelegram(telegramId);
    const hist = await getPlayerHistory(me.id, 10);

    if (!hist.items.length) {
      return ctx.reply(`У тебе поки немає підтверджених ігор. Рейтинг: ${me.currentElo}`);
    }

    const lines = hist.items.map((it) => {
      const d = it.rating
        ? `${it.rating.after} (${it.rating.delta >= 0 ? "+" : ""}${it.rating.delta})`
        : "—";
      return `• vs ${it.opponent.nickname}: ${it.myScore} | рейтинг: ${d}`;
    });

    await ctx.reply(
      `📜 ${me.nickname}\nРейтинг: ${me.currentElo} | Ігор: ${me.gamesPlayed}\n\nОстанні ігри:\n` +
      lines.join("\n")
    );
  } catch (e: any) {
    await ctx.reply(`Помилка: ${e.message}\nПорада: спочатку /register`);
  }
});

await ensurePollingMode();
bot.start();
console.log("Bot started");
