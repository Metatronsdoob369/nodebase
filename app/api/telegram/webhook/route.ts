import { NextRequest, NextResponse } from "next/server";
import { inngest } from "@/inngest/client";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const SARN_SECTORS = ["racing", "autonomous", "cyberpunk", "ai"];

async function sendMessage(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
}

export async function POST(req: NextRequest) {
  try {
    const update = await req.json();
    const message = update?.message;
    if (!message?.text) return NextResponse.json({ ok: true });

    const chatId: number = message.chat.id;
    const text: string = message.text.trim().toLowerCase();
    const parts = text.split(/\s+/);
    const command = parts[0];

    // /signal [sector] — run the GAT signal pipeline
    if (command === "/signal" || command === "/signal@daems_bot") {
      const sector = SARN_SECTORS.includes(parts[1]) ? parts[1] : "racing";
      await sendMessage(chatId, `🔍 Running SARN signal scan for *${sector}*...`);
      await inngest.send({ name: "sarn/signal.run", data: { chatId, sector } });
      return NextResponse.json({ ok: true });
    }

    // /status — check what's running
    if (command === "/status" || command === "/status@daems_bot") {
      await sendMessage(chatId, "⚡ SARN nodebase is *online*.\nUse `/signal` to run a scan.");
      return NextResponse.json({ ok: true });
    }

    // /help
    if (command === "/help" || command === "/help@daems_bot") {
      await sendMessage(
        chatId,
        "*SARN Commands:*\n`/signal` — run racing signal scan\n`/signal racing` — racing sector\n`/signal ai` — AI sector\n`/status` — system check"
      );
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Telegram webhook]", err);
    return NextResponse.json({ ok: true }); // always 200 to Telegram
  }
}
