import "dotenv/config";
import { Bot, Context, InlineKeyboard, session } from "grammy";
import { conversations, createConversation, ConversationFlavor } from "@grammyjs/conversations";

import {
  registerPlayer,
  listPlayers,
  reportGame,
  confirmGame,
  disputeGame,
  leaderboard,
  getPlayerByTelegram,
  getPlayerHistory,
} from "./api.js";

type SessionData = {};
type MyContext = Context & ConversationFlavor & { session: SessionData };

const token = process.env.BOT_TOKEN;
if (!token) throw new Error("BOT_TOKEN is missing. Set it in apps/bot/.env");

const MOD_CHAT_ID = process.env.MOD_CHAT_ID ? Number(process.env.MOD_CHAT_ID) : null;

const bot = new Bot<MyContext>(token);

bot.use(session({ initial: (): SessionData => ({}) }));
bot.use(conversations());

async function notifyModerator(ctx: MyContext, text: string) {
  if (!MOD_CHAT_ID) return;
  try {
    await ctx.api.sendMessage(MOD_CHAT_ID, text);
  } catch (e) {
    console.warn("Failed to notify moderator:", e);
  }
}

function prettyResult(r: "A_WIN" | "B_WIN" | "DRAW") {
  if (r === "A_WIN") return "1-0 (репортер виграв)";
  if (r === "B_WIN") return "0-1 (репортер програв)";
  return "½-½ (нічия)";
}

function playersKeyboard(
  items: Array<{ id: string; nickname: string }>,
  page: number,
  pages: number
) {
  const kb = new InlineKeyboard();
  for (const p of items) kb.text(p.nickname, `opponent:${p.id}`).row();

  if (page > 1 || page < pages) {
  kb.row(); // новий рядок для навігації
  if (page > 1) kb.text("⬅️ Назад", `players:page:${page - 1}`);
  if (page < pages) kb.text("➡️ Далі", `players:page:${page + 1}`);
}
  return kb;
}

// ---------- /register conversation ----------
async function registerConversation(conversation: any, ctx: MyContext) {
  const telegramId = String(ctx.from?.id ?? "");
  if (!telegramId) return ctx.reply("Не бачу твій Telegram ID.");

  await ctx.reply("Введи свій нік:");
  const m = await conversation.wait();
  const nickname = (m.message?.text ?? "").trim();

  if (nickname.length < 2) {
    await ctx.reply("Нік занадто короткий. Спробуй ще раз: /register");
    return;
  }

  const p = await registerPlayer(telegramId, nickname);

  await ctx.reply(`Готово ✅ Ти зареєстрований як: ${p.nickname}`);

  await notifyModerator(
    ctx,
    `👤 New player registered\n• nickname: ${p.nickname}\n• telegramId: ${telegramId}\n• at: ${new Date().toISOString()}`
  );
}

// ---------- /report conversation ----------
async function reportConversation(conversation: any, ctx: MyContext) {
  const telegramId = String(ctx.from?.id ?? "");
  if (!telegramId) return ctx.reply("Не бачу твій Telegram ID.");

  const limit = 10;
  let page = 1;

  let resp = await listPlayers({ page, limit, excludeTelegramId: telegramId });
  if (!resp.items.length) {
    await ctx.reply("Немає інших гравців. Запроси когось зареєструватись через /register");
    return;
  }

  const msg = await ctx.reply(
    `Обери опонента (сторінка ${resp.page}/${resp.pages}):`,
    { reply_markup: playersKeyboard(resp.items, resp.page, resp.pages) }
  );

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

    opponentId = data.split(":")[1];
  }

  await ctx.reply("Результат для тебе:", {
    reply_markup: new InlineKeyboard()
      .text("Я виграв (1-0)", "result:A_WIN")
      .row()
      .text("Нічия (½-½)", "result:DRAW")
      .row()
      .text("Я програв (0-1)", "result:B_WIN"),
  });

  const cb2 = await conversation.waitForCallbackQuery(/^result:/);
  const result = cb2.callbackQuery.data!.split(":")[1] as "A_WIN" | "B_WIN" | "DRAW";
  await cb2.answerCallbackQuery();

  // create game (PENDING)
  const game = await reportGame({
    reporterTelegramId: telegramId,
    opponentPlayerId: opponentId,
    result,
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
        `Результат (з боку репортера): ${prettyResult(game.result)}\n\n` +
        `Підтверди або запереч:`,
      { reply_markup: confirmKb }
    );
    await ctx.reply("Гру записано ✅ Я відправив опоненту запит на підтвердження в приват.");
  } catch {
    await ctx.reply(
      "Гру записано ✅ але я не зміг написати опоненту в приват.\n" +
        "Нехай опонент відкриє бота і натисне /start (або розблокує бота), після цього повтори /report."
    );
  }
}

// register conversations
bot.use(createConversation(registerConversation));
bot.use(createConversation(reportConversation));

// commands
bot.command("start", async (ctx) => {
  await ctx.reply("Привіт! Вітаю в спільноті SISCA! Ми тут в Сквоті постійно граємо в шахи один з одним і вирішили об'єднати всіх одним ком'юніті та одним рейтингом. Правила прості: граєш гру в Сквоті, заносиш результат за допомогою /report.\nОбидва гравці мають бути зареєстровані через /register.\n Також можна подивитись /leaderboard та /history\n За всіма питаннями звертайся до @ombabadugunda");
});

bot.command("help", async (ctx) => {
  await ctx.reply("Команди:\n/register\n/report\n/leaderboard\n/history\n/myid");
});

bot.command("myid", async (ctx) => {
  await ctx.reply(`chat_id: ${ctx.chat?.id}\nuser_id: ${ctx.from?.id}`);
});

bot.command("register", async (ctx) => {
  await ctx.conversation.enter("registerConversation");
});

bot.command("report", async (ctx) => {
  await ctx.conversation.enter("reportConversation");
});

bot.command("leaderboard", async (ctx) => {
  try {
    const top = await leaderboard();
    if (!top.length) return ctx.reply("Поки що немає гравців.");

    const lines = top.map(
      (p, i) => `${String(i + 1).padStart(2, " ")}. ${p.nickname} — ${p.currentElo} (${p.gamesPlayed} ігор)`
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

// callbacks: confirm/dispute
bot.callbackQuery(/^game:confirm:/, async (ctx) => {
  const gameId = ctx.callbackQuery.data!.split(":")[2];
  const telegramId = String(ctx.from?.id ?? "");

  try {
    const updated = await confirmGame(gameId, telegramId); // { game, rating }

    await ctx.editMessageText("Гру підтверджено ✅");

    await notifyModerator(
      ctx,
      `♟️ Game confirmed\n• ${updated.game.playerA.nickname} vs ${updated.game.playerB.nickname}\n• result: ${updated.game.result}\n• id: ${updated.game.id}\n• at: ${new Date().toISOString()}`
    );

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
    const updated = await disputeGame(gameId, telegramId); // { game, ... }

    await ctx.editMessageText("Гру позначено як спірну ⚠️ (піде на модерацію)");

    await notifyModerator(
      ctx,
      `⚠️ Game disputed\n• ${updated.game.playerA.nickname} vs ${updated.game.playerB.nickname}\n• id: ${updated.game.id}\n• at: ${new Date().toISOString()}`
    );

    const reporterTgId = Number(updated.game.playerA.telegramId);
    await ctx.api.sendMessage(
      reporterTgId,
      `⚠️ ${updated.game.playerB.nickname} заперечив(ла) гру.\nID: ${updated.game.id}\n(Далі: модерація/уточнення)`
    );
  } catch (e: any) {
    await ctx.answerCallbackQuery({ text: `Не вийшло: ${e.message}`, show_alert: true });
  }
});

async function ensurePollingMode() {
  try {
    await bot.api.deleteWebhook({ drop_pending_updates: true });
  } catch (e) {
    console.warn("deleteWebhook failed:", e);
  }
}

await ensurePollingMode();
bot.start();