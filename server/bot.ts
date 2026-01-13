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
}

const userStates = new Map<number, UserState>();
const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID?.toString() || "";

console.log("Admin ID configured:", ADMIN_ID);

// Format phone number with + prefix for VCF
function formatPhoneNumber(number: string): string {
  if (!number) return number;
  const digits = number.replace(/\D/g, "");
  return digits.startsWith("+") || number.startsWith("+") ? number : `+${digits}`;
}

export function setupBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log("No TELEGRAM_BOT_TOKEN found, skipping bot initialization.");
    return;
  }

  const bot = new TelegramBot(token, { polling: true });
  console.log("Telegram bot initialized!");

  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text?.trim();

    if (!userStates.has(chatId)) {
      userStates.set(chatId, {});
    }

    const state = userStates.get(chatId)!;

    // Start command - show menu with photo and buttons
    if (text === "/start") {
      try {
        const welcomeMessage = `🎉 Bot Konverter VCF Pro

📄 CV TXT to VCF - GRATIS
👥 CV Kontak Admin - GRATIS
🆓 Semua Fitur Gratis!

Developer: FETRUS MEILANO ILHAMSYAH

Pilih fitur di bawah:`;

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
        await bot.sendMessage(chatId, "Halo! Selamat datang di bot konverter. Ketik /start untuk memulai.");
      }

      userStates.set(chatId, {});
      return;
    }

    // Reset command - delete user data and clear state
    if (text === "/reset") {
      try {
        await db.delete(conversions).where(eq(conversions.telegramUserId, chatId));
        userStates.set(chatId, {});
        await bot.sendMessage(chatId, "✅ Data Anda sudah dihapus dari server. Selamat datang kembali!\n\nKetik /start untuk memulai lagi.");
      } catch (err) {
        console.error("Error resetting user data:", err);
        await bot.sendMessage(chatId, "❌ Gagal menghapus data. Silakan coba lagi nanti.");
      }
      return;
    }

    // Admin clear conversions command (hanya untuk admin)
    if (text === "/clear_all") {
      const userIdStr = chatId.toString();
      
      if (userIdStr !== ADMIN_ID) {
        await bot.sendMessage(chatId, `❌ Hanya admin yang bisa menggunakan command ini.\n\nID Anda: ${userIdStr}`);
        return;
      }

      try {
        await db.delete(conversions);
        userStates.clear();
        await bot.sendMessage(chatId, `✅ Semua hasil konversi berhasil dihapus!\n\n🗑️ Data yang dihapus:\n- Conversions (hasil konversi): Dihapus ✅\n- User States: Dihapus ✅\n\nBot siap untuk test baru!`);
        console.log("✅ Admin cleared conversions data from database");
      } catch (err) {
        console.error("Error clearing conversions:", err);
        await bot.sendMessage(chatId, `❌ Gagal menghapus data\n\nError: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
      return;
    }

    // Admin CV mode - sekarang gratis untuk semua!
    if (text === "/admin") {
      state.mode = "ADMIN_CV";
      state.step = 1;
      await bot.sendMessage(chatId, "Berikan nomor admin (ketik satu nomor per baris):");
      return;
    }

    // File upload for TXT to VCF
    if (msg.document && (!state.mode || state.mode === "TXT_TO_VCF")) {
      const fileName = msg.document.file_name || "";
      if (!fileName.endsWith(".txt") && !fileName.endsWith(".xlsx")) {
        await bot.sendMessage(chatId, "⚠️ Silakan kirimkan file .txt atau .xlsx");
        return;
      }

      try {
        const fileLink = await bot.getFileLink(msg.document.file_id);
        const response = await fetch(fileLink);
        const content = await response.text();

        const numbers = content
          .split(/\r?\n/)
          .map(l => l.trim())
          .filter(l => l.length > 0);

        if (numbers.length === 0) {
          await bot.sendMessage(chatId, "⚠️ File kosong. Silakan kirimkan file dengan nomor telepon.");
          return;
        }

        state.mode = "TXT_TO_VCF";
        state.step = 1;
        state.fileNumbers = numbers;
        state.numberCount = numbers.length;

        await bot.sendMessage(chatId, `✅ File diterima.\n\n📊 Otomatis hitung nomor: <b>${state.numberCount}</b> nomor\n\nMasukkan nama kontak:`, { parse_mode: "HTML" });
      } catch (error) {
        console.error("Error processing file:", error);
        await bot.sendMessage(chatId, "❌ Terjadi kesalahan saat memproses file.");
      }
      return;
    }

    // Handle text input based on mode
    if (state.mode === "TXT_TO_VCF") {
      await handleTxtToVcf(bot, chatId, state, text);
      return;
    } else if (state.mode === "ADMIN_CV") {
      await handleAdminCv(bot, chatId, state, text);
      return;
    }
  });

  // Handle callback queries from inline buttons
  bot.on("callback_query", async (query) => {
    const chatId = query.message?.chat.id;
    if (!chatId) return;

    if (!userStates.has(chatId)) {
      userStates.set(chatId, {});
    }

    const state = userStates.get(chatId)!;

    if (query.data === "btn_txt_to_vcf") {
      await bot.answerCallbackQuery(query.id);
      state.mode = "TXT_TO_VCF";
      state.step = 0;
      await bot.sendMessage(chatId, "📤 Silakan kirimkan file .txt atau .xlsx dengan daftar nomor telepon");
      return;
    } else if (query.data === "btn_admin") {
      await bot.answerCallbackQuery(query.id);
      state.mode = "ADMIN_CV";
      state.step = 1;
      await bot.sendMessage(chatId, "Berikan nomor admin (ketik satu nomor per baris):");
      return;
    } else if (query.data === "btn_reset") {
      await bot.answerCallbackQuery(query.id);
      try {
        await db.delete(conversions).where(eq(conversions.telegramUserId, chatId));
        userStates.set(chatId, {});
        await bot.sendMessage(chatId, "✅ Data Anda sudah dihapus dari server. Selamat datang kembali!\n\nKetik /start untuk memulai lagi.");
      } catch (err) {
        console.error("Error resetting user data:", err);
        await bot.sendMessage(chatId, "❌ Gagal menghapus data. Silakan coba lagi nanti.");
      }
      return;
    }
  });
}

async function handleTxtToVcf(bot: TelegramBot, chatId: number, state: UserState, text?: string) {
  if (!text) return;

  if (!state.fileNumbers || state.fileNumbers.length === 0) {
    await bot.sendMessage(chatId, "⚠️ Tidak ada file yang diupload. Silakan upload file terlebih dahulu.");
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
      await bot.sendMessage(chatId, "⚠️ Masukkan nomor yang valid (angka bulat)");
      return;
    }
    state.fileStartNumber = startNum;
    state.step = 4;
    await bot.sendMessage(chatId, "Masukkan jumlah kontak per file (atau ketik 'all'):");
  } else if (state.step === 4) {
    const limit = text.toLowerCase() === "all" ? state.numberCount || 999999 : parseInt(text);
    if (isNaN(limit) || limit < 1) {
      await bot.sendMessage(chatId, "⚠️ Masukkan angka yang valid atau 'all'");
      return;
    }

    state.splitLimit = limit;
    
    await bot.sendMessage(chatId, "⏳ Memproses dan mengirim file...");
    await generateAndSendVcf(bot, chatId, state.fileNumbers!, state.contactName!, state.fileName!, state.fileStartNumber!, state.splitLimit);
    
    try {
      await db.insert(conversions).values({
        telegramUserId: chatId,
        conversionType: "TXT_TO_VCF",
        fileName: state.fileName!,
        contactName: state.contactName!,
        numberCount: state.numberCount
      });
    } catch (err) {
      console.error("Error saving conversion:", err);
    }
    
    userStates.set(chatId, {});
    await bot.sendMessage(chatId, "✅ Selesai! Ketik /start untuk memulai lagi.");
  }
}

async function handleAdminCv(bot: TelegramBot, chatId: number, state: UserState, text?: string) {
  if (!text) return;

  if (state.mode !== "ADMIN_CV") {
    await bot.sendMessage(chatId, "⚠️ Mode tidak valid. Ketik /admin untuk memulai lagi.");
    return;
  }

  if (state.step === 1) {
    state.adminNumbers = text.split(/\r?\n/).map(n => n.trim()).filter(n => n.length > 0);
    state.step = 2;
    await bot.sendMessage(chatId, "Berikan nama admin:");
  } else if (state.step === 2) {
    state.adminName = text;
    state.step = 3;
    await bot.sendMessage(chatId, "Berikan nomor navy (ketik satu nomor per baris):");
  } else if (state.step === 3) {
    state.navyNumbers = text.split(/\r?\n/).map(n => n.trim()).filter(n => n.length > 0);
    state.step = 4;
    await bot.sendMessage(chatId, "Berikan nama navy:");
  } else if (state.step === 4) {
    state.navyName = text;
    
    await bot.sendMessage(chatId, "⏳ Memproses...");
    
    const adminVcards = state.adminNumbers!.map((number, idx) => [
      "BEGIN:VCARD",
      "VERSION:3.0",
      `FN:${state.adminName} ${idx + 1}`,
      `TEL;TYPE=CELL:${formatPhoneNumber(number)}`,
      "END:VCARD"
    ].join("\n"));

    const navyVcards = state.navyNumbers!.map((number, idx) => [
      "BEGIN:VCARD",
      "VERSION:3.0",
      `FN:${state.navyName} ${idx + 1}`,
      `TEL;TYPE=CELL:${formatPhoneNumber(number)}`,
      "END:VCARD"
    ].join("\n"));

    const combinedVcard = [...adminVcards, ...navyVcards].join("\n");

    await bot.sendDocument(chatId, Buffer.from(combinedVcard), {}, {
      filename: `${state.adminName}_${state.navyName}.vcf`,
      contentType: "text/vcard"
    });

    try {
      await db.insert(conversions).values({
        telegramUserId: chatId,
        conversionType: "ADMIN_CV",
        adminName: state.adminName!,
        navyName: state.navyName!,
        numberCount: (state.adminNumbers?.length || 0) + (state.navyNumbers?.length || 0)
      });
    } catch (err) {
      console.error("Error saving conversion:", err);
    }

    userStates.set(chatId, {});
    await bot.sendMessage(chatId, "✅ Selesai! Ketik /start untuk memulai lagi.");
  }
}

async function generateAndSendVcf(
  bot: TelegramBot,
  chatId: number,
  numbers: string[],
  contactName: string,
  fileName: string,
  fileStartNumber: number,
  splitLimit: number
) {
  const chunks: string[][] = [];
  for (let i = 0; i < numbers.length; i += splitLimit) {
    chunks.push(numbers.slice(i, i + splitLimit));
  }

  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index];
    const currentFileNumber = fileStartNumber + index;
    const filePartName = chunks.length > 1
      ? `${fileName}${currentFileNumber}.vcf`
      : `${fileName}${currentFileNumber}.vcf`;

    const vcardContent = chunk.map((number, numIndex) => {
      const globalIndex = index * splitLimit + numIndex + 1;
      return [
        "BEGIN:VCARD",
        "VERSION:3.0",
        `FN:${contactName} ${globalIndex}`,
        `TEL;TYPE=CELL:${formatPhoneNumber(number)}`,
        "END:VCARD"
      ].join("\n");
    }).join("\n");

    await bot.sendDocument(chatId, Buffer.from(vcardContent), {}, {
      filename: filePartName,
      contentType: "text/vcard"
    });
  }
}