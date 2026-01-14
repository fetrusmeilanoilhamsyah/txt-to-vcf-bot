import TelegramBot from "node-telegram-bot-api";
import fs from "fs";
import path from "path";
import { db } from "./db";
import { conversions } from "@shared/schema";
import { eq } from "drizzle-orm";

interface UserState {
  mode?: "TXT_TO_VCF" | "ADMIN_CV";
  step?: number;
  fileNumbers?: string[];
  numberCount?: number;
  contactName?: string;
  fileName?: string;
  fileStartNumber?: number;
  splitLimit?: number;
  adminNumbers?: string[];
  adminName?: string;
  navyNumbers?: string[];
  navyName?: string;
  lastActivity?: number;
}

const userStates = new Map<number, UserState>();
const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID?.toString() || "";
const STATE_TTL = 30 * 60 * 1000;

console.log("Admin ID configured:", ADMIN_ID);

function formatPhoneNumber(number: string): string {
  if (!number) {
    return number;
  }
  if (number.startsWith("+")) {
    return number;
  }
  const cleaned = String(number).split("").filter(c => c >= "0" && c <= "9").join("");
  return "+" + cleaned;
}

export function setupBot(): void {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log("No TELEGRAM_BOT_TOKEN found, skipping bot initialization.");
    return;
  }

  const bot = new TelegramBot(token, { polling: true });
  console.log("Telegram bot initialized!");

  setInterval(() => {
    const now = Date.now();
    userStates.forEach((state, userId) => {
      if (state.lastActivity && now - state.lastActivity > STATE_TTL) {
        userStates.delete(userId);
        console.log("Cleaned up inactive user:", userId);
      }
    });
  }, 5 * 60 * 1000);

  const userLastRequest = new Map<number, number>();
  const RATE_LIMIT_MS = 2000;

  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text?.trim();

    const now = Date.now();
    const lastRequest = userLastRequest.get(chatId);
    if (lastRequest && now - lastRequest < RATE_LIMIT_MS) {
      try {
        await bot.sendMessage(chatId, "⏳ Tunggu 2 detik sebelum request berikutnya.");
      } catch (e) {
        console.error("Rate limit message error:", e);
      }
      return;
    }
    userLastRequest.set(chatId, now);

    if (!userStates.has(chatId)) {
      userStates.set(chatId, { lastActivity: now });
    }

    const state = userStates.get(chatId)!;
    state.lastActivity = now;

    if (text === "/start") {
      try {
        const welcomeMessage = "🎉 Bot Konverter VCF Pro\n\n📄 CV TXT to VCF - GRATIS\n👥 CV Kontak Admin - GRATIS\n🆓 Semua Fitur Gratis!\n\nDeveloper: FETRUS MEILANO ILHAMSYAH\n\nPilih fitur di bawah:";

        const inlineKeyboard = {
          inline_keyboard: [
            [
              { text: "📄 CV TXT to VCF", callback_data: "btn_txt_to_vcf" },
              { text: "👥 CV Kontak Admin", callback_data: "btn_admin" }
            ],
            [
              { text: "🔄 Reset Data", callback_data: "btn_reset" }
            ]
          ]
        };

        const photoPath = path.join(process.cwd(), "attached_assets", "IMG_2950_1766914856970.jpeg");
        if (fs.existsSync(photoPath)) {
          await bot.sendPhoto(chatId, photoPath, {
            caption: welcomeMessage,
            parse_mode: "HTML",
            reply_markup: inlineKeyboard
          });
        } else {
          await bot.sendMessage(chatId, welcomeMessage, {
            parse_mode: "HTML",
            reply_markup: inlineKeyboard
          });
        }
      } catch (error) {
        console.error("Error sending welcome message:", error);
        await bot.sendMessage(chatId, "Halo! Ketik /start untuk memulai.");
      }

      userStates.set(chatId, { lastActivity: now });
      return;
    }

    if (text === "/reset") {
      try {
        await db.delete(conversions).where(eq(conversions.telegramUserId, chatId));
        userStates.set(chatId, { lastActivity: now });
        await bot.sendMessage(chatId, "✅ Data dihapus. Ketik /start untuk mulai lagi.");
      } catch (err) {
        console.error("Error resetting user data:", err);
        await bot.sendMessage(chatId, "❌ Gagal menghapus data.");
      }
      return;
    }

    if (text === "/clear_all") {
      const userIdStr = chatId.toString();
      if (userIdStr !== ADMIN_ID) {
        await bot.sendMessage(chatId, "❌ Hanya admin. ID Anda: " + userIdStr);
        return;
      }

      try {
        await db.delete(conversions);
        userStates.clear();
        await bot.sendMessage(chatId, "✅ Semua data dihapus!");
        console.log("Admin cleared conversions");
      } catch (err) {
        console.error("Error clearing conversions:", err);
        const errMsg = err instanceof Error ? err.message : "Unknown";
        await bot.sendMessage(chatId, "❌ Error: " + errMsg);
      }
      return;
    }

    if (text === "/admin") {
      state.mode = "ADMIN_CV";
      state.step = 1;
      await bot.sendMessage(chatId, "Berikan nomor admin (satu per baris):");
      return;
    }

    if (msg.document && (!state.mode || state.mode === "TXT_TO_VCF")) {
      const fileName = msg.document.file_name || "";
      if (!fileName.endsWith(".txt") && !fileName.endsWith(".xlsx")) {
        await bot.sendMessage(chatId, "⚠️ Kirim file .txt atau .xlsx");
        return;
      }

      try {
        const progressMsg = await bot.sendMessage(chatId, "⏳ Memproses file...");
        
        const fileLink = await bot.getFileLink(msg.document.file_id);
        const response = await fetch(fileLink);
        const content = await response.text();

        const numbers = content
          .split(/\r?\n/)
          .map(l => l.trim())
          .filter(l => l.length > 0);

        if (numbers.length === 0) {
          await bot.editMessageText("⚠️ File kosong.", {
            chat_id: chatId,
            message_id: progressMsg.message_id
          });
          return;
        }

        state.mode = "TXT_TO_VCF";
        state.step = 1;
        state.fileNumbers = numbers;
        state.numberCount = numbers.length;

        await bot.editMessageText(
          "✅ File diterima.\n\n📊 Total: <b>" + state.numberCount + "</b> nomor\n\nMasukkan nama kontak:",
          {
            chat_id: chatId,
            message_id: progressMsg.message_id,
            parse_mode: "HTML"
          }
        );
      } catch (error) {
        console.error("Error processing file:", error);
        await bot.sendMessage(chatId, "❌ Error memproses file.");
      }
      return;
    }

    if (state.mode === "TXT_TO_VCF") {
      await handleTxtToVcf(bot, chatId, state, text);
      return;
    } else if (state.mode === "ADMIN_CV") {
      await handleAdminCv(bot, chatId, state, text);
      return;
    }
  });

  bot.on("callback_query", async (query) => {
    const chatId = query.message?.chat.id;
    if (!chatId) return;

    const now = Date.now();
    if (!userStates.has(chatId)) {
      userStates.set(chatId, { lastActivity: now });
    }

    const state = userStates.get(chatId)!;
    state.lastActivity = now;

    try {
      if (query.data === "btn_txt_to_vcf") {
        await bot.answerCallbackQuery(query.id);
        state.mode = "TXT_TO_VCF";
        state.step = 0;
        await bot.sendMessage(chatId, "📤 Kirim file .txt atau .xlsx");
      } else if (query.data === "btn_admin") {
        await bot.answerCallbackQuery(query.id);
        state.mode = "ADMIN_CV";
        state.step = 1;
        await bot.sendMessage(chatId, "Berikan nomor admin (satu per baris):");
      } else if (query.data === "btn_reset") {
        await bot.answerCallbackQuery(query.id);
        try {
          await db.delete(conversions).where(eq(conversions.telegramUserId, chatId));
          userStates.set(chatId, { lastActivity: now });
          await bot.sendMessage(chatId, "✅ Data dihapus.");
        } catch (err) {
          console.error("Error resetting:", err);
          await bot.sendMessage(chatId, "❌ Error.");
        }
      }
    } catch (error) {
      console.error("Callback query error:", error);
    }
  });
}

async function handleTxtToVcf(
  bot: TelegramBot,
  chatId: number,
  state: UserState,
  text?: string
): Promise<void> {
  if (!text) return;

  if (!state.fileNumbers || state.fileNumbers.length === 0) {
    await bot.sendMessage(chatId, "⚠️ Upload file dulu.");
    return;
  }

  if (state.step === 1) {
    state.contactName = text;
    state.step = 2;
    await bot.sendMessage(chatId, "Masukkan nama file:");
  } else if (state.step === 2) {
    state.fileName = text;
    state.step = 3;
    await bot.sendMessage(chatId, "Masukkan nomor ujung file (contoh: 79):");
  } else if (state.step === 3) {
    const startNum = parseInt(text);
    if (isNaN(startNum) || startNum < 0) {
      await bot.sendMessage(chatId, "⚠️ Masukkan nomor valid");
      return;
    }
    state.fileStartNumber = startNum;
    state.step = 4;
    await bot.sendMessage(chatId, "Jumlah kontak per file (atau 'all'):");
  } else if (state.step === 4) {
    const limit = text.toLowerCase() === "all" ? state.numberCount || 999999 : parseInt(text);
    if (isNaN(limit) || limit < 1) {
      await bot.sendMessage(chatId, "⚠️ Angka valid atau 'all'");
      return;
    }

    state.splitLimit = limit;
    
    const progressMsg = await bot.sendMessage(chatId, "⏳ Memproses...");
    
    try {
      await generateAndSendVcf(
        bot,
        chatId,
        state.fileNumbers!,
        state.contactName!,
        state.fileName!,
        state.fileStartNumber!,
        state.splitLimit,
        progressMsg.message_id
      );
      
      await db.insert(conversions).values({
        telegramUserId: chatId,
        conversionType: "TXT_TO_VCF",
        fileName: state.fileName || null,
        contactName: state.contactName || null,
        adminName: null,
        navyName: null,
        numberCount: state.numberCount || null
      });
      
      try {
        await bot.editMessageText("✅ Selesai! /start untuk mulai lagi.", {
          chat_id: chatId,
          message_id: progressMsg.message_id
        });
      } catch (e) {
        console.log("Edit message ignored");
      }
    } catch (err) {
      console.error("Conversion error:", err);
      await bot.sendMessage(chatId, "❌ Error. Coba lagi.");
    }
    
    userStates.set(chatId, { lastActivity: Date.now() });
  }
}

async function handleAdminCv(
  bot: TelegramBot,
  chatId: number,
  state: UserState,
  text?: string
): Promise<void> {
  if (!text) return;

  if (state.step === 1) {
    state.adminNumbers = text.split(/\r?\n/).map(n => n.trim()).filter(n => n.length > 0);
    state.step = 2;
    await bot.sendMessage(chatId, "Berikan nama admin:");
  } else if (state.step === 2) {
    state.adminName = text;
    state.step = 3;
    await bot.sendMessage(chatId, "Berikan nomor navy (satu per baris):");
  } else if (state.step === 3) {
    state.navyNumbers = text.split(/\r?\n/).map(n => n.trim()).filter(n => n.length > 0);
    state.step = 4;
    await bot.sendMessage(chatId, "Berikan nama navy:");
  } else if (state.step === 4) {
    state.navyName = text;
    
    const progressMsg = await bot.sendMessage(chatId, "⏳ Memproses...");
    
    try {
      const adminVcards = state.adminNumbers!.map((number, idx) => [
        "BEGIN:VCARD",
        "VERSION:3.0",
        "FN:" + state.adminName + " " + (idx + 1),
        "TEL;TYPE=CELL:" + formatPhoneNumber(number),
        "END:VCARD"
      ].join("\n"));

      const navyVcards = state.navyNumbers!.map((number, idx) => [
        "BEGIN:VCARD",
        "VERSION:3.0",
        "FN:" + state.navyName + " " + (idx + 1),
        "TEL;TYPE=CELL:" + formatPhoneNumber(number),
        "END:VCARD"
      ].join("\n"));

      const combinedVcard = [...adminVcards, ...navyVcards].join("\n");

      await bot.sendDocument(chatId, Buffer.from(combinedVcard), {}, {
        filename: state.adminName + "_" + state.navyName + ".vcf",
        contentType: "text/vcard"
      });

      await db.insert(conversions).values({
        telegramUserId: chatId,
        conversionType: "ADMIN_CV",
        fileName: (state.adminName + "_" + state.navyName + ".vcf") || null,
        contactName: null,
        adminName: state.adminName || null,
        navyName: state.navyName || null,
        numberCount: (state.adminNumbers?.length || 0) + (state.navyNumbers?.length || 0)
      });

      try {
        await bot.editMessageText("✅ Selesai! /start untuk mulai lagi.", {
          chat_id: chatId,
          message_id: progressMsg.message_id
        });
      } catch (e) {
        console.log("Edit message ignored");
      }
    } catch (err) {
      console.error("Admin CV error:", err);
      await bot.sendMessage(chatId, "❌ Error.");
    }
    
    userStates.set(chatId, { lastActivity: Date.now() });
  }
}

// ✅ Helper function untuk batch parallel
async function sendInBatches<T>(
  items: T[],
  batchSize: number,
  delayMs: number,
  processor: (item: T, index: number) => Promise<void>
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map((item, idx) => processor(item, i + idx)));
    if (i + batchSize < items.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

async function generateAndSendVcf(
  bot: TelegramBot,
  chatId: number,
  numbers: string[],
  contactName: string,
  fileName: string,
  fileStartNumber: number,
  splitLimit: number,
  progressMsgId: number
): Promise<void> {
  const chunks: string[][] = [];
  for (let i = 0; i < numbers.length; i += splitLimit) {
    chunks.push(numbers.slice(i, i + splitLimit));
  }

  const totalFiles = chunks.length;
  console.log("Total files to send:", totalFiles);

  try {
    await bot.editMessageText(
      "⚡ Mengirim " + totalFiles + " file secara parallel...",
      { chat_id: chatId, message_id: progressMsgId }
    );
  } catch (e) {
    console.log("Progress ignored");
  }

  let sentCount = 0;
  
  // ✅ SUPER FAST: Kirim 10 file bersamaan per batch, delay 50ms antar batch
  await sendInBatches(chunks, 10, 50, async (chunk, index) => {
    const currentFileNumber = fileStartNumber + index;
    const filePartName = fileName + currentFileNumber + ".vcf";

    const vcardContent = chunk.map((number, numIndex) => {
      const globalIndex = index * splitLimit + numIndex + 1;
      return [
        "BEGIN:VCARD",
        "VERSION:3.0",
        "FN:" + contactName + " " + globalIndex,
        "TEL;TYPE=CELL:" + formatPhoneNumber(number),
        "END:VCARD"
      ].join("\n");
    }).join("\n");

    await bot.sendDocument(chatId, Buffer.from(vcardContent), {}, {
      filename: filePartName,
      contentType: "text/vcard"
    });

    sentCount++;
    
    // Update progress setiap 10 file
    if (sentCount % 10 === 0) {
      try {
        await bot.editMessageText(
          "⚡ Terkirim: " + sentCount + "/" + totalFiles + " (" + Math.round((sentCount / totalFiles) * 100) + "%)",
          { chat_id: chatId, message_id: progressMsgId }
        );
      } catch (e) {
        // Ignore edit errors
      }
    }
  });

  try {
    await bot.editMessageText(
      "✅ Selesai! " + totalFiles + " file terkirim dalam hitungan detik!",
      { chat_id: chatId, message_id: progressMsgId }
    );
  } catch (e) {
    console.log("Final message ignored");
  }
}