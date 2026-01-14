import TelegramBot from "node-telegram-bot-api";
import fs from "fs";
import path from "path";
import { db } from "./db";
import { conversions } from "@shared/schema";
import { eq } from "drizzle-orm";

interface UserState {
  mode?: "TXT_TO_VCF" | "ADMIN_CV" | "VCF_TO_TXT" | "MERGE_VCF";
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
  vcfContent?: string;
  mergeFiles?: Buffer[];
  mergeFileNames?: string[];
}

const userStates = new Map<number, UserState>();
const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID?.toString() || "";
const OWNER_ID = "6404822546"; // ID Telegram Fetrus Meilano
const OWNER_USERNAME = "@FEE999888"; // Username Telegram
const WEBSITE_URL = "https://fetrusmeilanoilhamsyah.github.io"; // Website Portfolio
const STATE_TTL = 30 * 60 * 1000;

console.log("🔥 Bot VCF Converter aktif!");
console.log(`👑 Pemilik: ${OWNER_ID} (${OWNER_USERNAME})`);
console.log(`🆔 Admin: ${ADMIN_ID || "Belum diatur"}`);
console.log("==================================");

function formatPhoneNumber(number: string): string {
  if (!number) return number;
  if (number.startsWith("+")) return number;
  const cleaned = number.replace(/\D/g, '');
  return "+" + cleaned;
}

function extractNumbersFromVcf(vcfContent: string): string[] {
  const numbers: string[] = [];
  const lines = vcfContent.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('TEL;') || line.startsWith('TEL:')) {
      const telLine = line.includes(':') ? line.split(':')[1] : line;
      const numberMatch = telLine.match(/\d+/g);
      if (numberMatch) {
        const number = numberMatch.join('');
        if (number.length >= 10) {
          numbers.push(number);
        }
      }
    }
  }
  
  const uniqueNumbers: string[] = [];
  const seen = new Set<string>();
  
  for (const num of numbers) {
    if (!seen.has(num)) {
      seen.add(num);
      uniqueNumbers.push(num);
    }
  }
  
  return uniqueNumbers;
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

  await bot.editMessageText(
    `⏳ Mengirim ${totalFiles} file...`,
    { chat_id: chatId, message_id: progressMsgId }
  ).catch(() => {});

  let sentCount = 0;
  const BATCH_SIZE = 5;
  const DELAY_MS = 50;
  
  for (let batchStart = 0; batchStart < chunks.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, chunks.length);
    
    const batchPromises = [];
    for (let i = batchStart; i < batchEnd; i++) {
      const chunk = chunks[i];
      const fileNum = fileStartNumber + i;
      const filePartName = `${fileName}${String(fileNum).padStart(3, '0')}.vcf`;

      const vcardContent = chunk.map((number, idx) => {
        const globalIndex = i * splitLimit + idx + 1;
        return [
          "BEGIN:VCARD",
          "VERSION:3.0",
          `FN:${contactName} ${globalIndex}`,
          `TEL;TYPE=CELL:${formatPhoneNumber(number)}`,
          "END:VCARD"
        ].join("\n");
      }).join("\n");

      batchPromises.push(
        bot.sendDocument(chatId, Buffer.from(vcardContent), {}, {
          filename: filePartName,
          contentType: "text/vcard"
        }).catch(() => null)
      );
    }
    
    await Promise.all(batchPromises);
    sentCount += batchEnd - batchStart;
    
    if (sentCount % 10 === 0 || sentCount === totalFiles) {
      const percent = Math.round((sentCount / totalFiles) * 100);
      await bot.editMessageText(
        `⏳ ${sentCount}/${totalFiles} file (${percent}%)`,
        { chat_id: chatId, message_id: progressMsgId }
      ).catch(() => {});
    }
    
    if (batchEnd < chunks.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  }

  console.log(`📤 ${totalFiles} file dikirim ke ${chatId}`);

  await bot.deleteMessage(chatId, progressMsgId).catch(() => {});
}

async function handleTxtToVcf(
  bot: TelegramBot,
  chatId: number,
  state: UserState,
  text?: string
): Promise<void> {
  if (!text) return;

  if (!state.fileNumbers || state.fileNumbers.length === 0) {
    await bot.sendMessage(chatId, "⚠️ Upload file terlebih dahulu");
    return;
  }

  switch (state.step) {
    case 1:
      state.contactName = text;
      state.step = 2;
      await bot.sendMessage(chatId, `Nama kontak: ${text}\n\nMasukkan nama file:`);
      break;
    
    case 2:
      state.fileName = text;
      state.step = 3;
      await bot.sendMessage(chatId, `Nama file: ${text}\n\nMasukkan nomor awal file (contoh: 1):`);
      break;
    
    case 3:
      const startNum = parseInt(text);
      if (isNaN(startNum) || startNum < 0) {
        await bot.sendMessage(chatId, "⚠️ Masukkan angka valid");
        return;
      }
      state.fileStartNumber = startNum;
      state.step = 4;
      await bot.sendMessage(chatId, `Nomor awal: ${startNum}\n\nMasukkan jumlah kontak per file (atau "all"):`);
      break;
    
    case 4:
      const limit = text.toLowerCase() === "all" ? state.numberCount || 999999 : parseInt(text);
      if (isNaN(limit) || limit < 1) {
        await bot.sendMessage(chatId, "⚠️ Masukkan angka valid atau 'all'");
        return;
      }

      state.splitLimit = limit;
      
      const fileCount = limit === state.numberCount ? 1 : Math.ceil(state.numberCount! / limit);
      const progressMsg = await bot.sendMessage(chatId, 
        `⏳ Memproses ${state.numberCount} nomor ke ${fileCount} file...`
      );
      
      try {
        await generateAndSendVcf(
          bot,
          chatId,
          state.fileNumbers!,
          state.contactName!,
          state.fileName!,
          state.fileStartNumber!,
          state.splitLimit!,
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
        
        console.log(`✅ ${state.numberCount} nomor dikonversi oleh ${chatId}`);
        
        const askAgainKeyboard = {
          inline_keyboard: [
            [
              { text: "🔄 Konversi Lagi", callback_data: "btn_txt_to_vcf" },
              { text: "📋 Menu Utama", callback_data: "btn_back" }
            ],
            [
              { text: "👥 Buat Admin CV", callback_data: "btn_admin" },
              { text: "🔗 Merge VCF", callback_data: "btn_merge" }
            ]
          ]
        };
        
        await bot.sendMessage(
          chatId,
          `✅ *Selesai!* ${state.numberCount} nomor telah dikonversi ke ${fileCount} file.\n\n` +
          `📁 *Detail:*\n` +
          `• Nama kontak: ${state.contactName}\n` +
          `• Nama file: ${state.fileName}\n` +
          `• File dibuat: ${fileCount}\n\n` +
          `Mau melakukan apa selanjutnya?`,
          {
            parse_mode: "Markdown",
            reply_markup: askAgainKeyboard
          }
        );
        
      } catch (err: any) {
        console.error("Conversion error:", err);
        await bot.sendMessage(chatId, "❌ Error saat konversi");
      }
      
      userStates.set(chatId, { lastActivity: Date.now() });
      break;
  }
}

async function handleAdminCv(
  bot: TelegramBot,
  chatId: number,
  state: UserState,
  text?: string
): Promise<void> {
  if (!text) return;

  switch (state.step) {
    case 1:
      const adminNumbers = text.split(/\r?\n/).map(n => n.trim()).filter(n => n.length > 0);
      if (adminNumbers.length === 0) {
        await bot.sendMessage(chatId, "⚠️ Masukkan minimal 1 nomor");
        return;
      }
      state.adminNumbers = adminNumbers;
      state.step = 2;
      await bot.sendMessage(chatId, `${adminNumbers.length} nomor admin\n\nMasukkan nama admin:`);
      break;
    
    case 2:
      state.adminName = text;
      state.step = 3;
      await bot.sendMessage(chatId, `Nama admin: ${text}\n\nMasukkan nomor navy (satu per baris):`);
      break;
    
    case 3:
      const navyNumbers = text.split(/\r?\n/).map(n => n.trim()).filter(n => n.length > 0);
      if (navyNumbers.length === 0) {
        await bot.sendMessage(chatId, "⚠️ Masukkan minimal 1 nomor");
        return;
      }
      state.navyNumbers = navyNumbers;
      state.step = 4;
      await bot.sendMessage(chatId, `${navyNumbers.length} nomor navy\n\nMasukkan nama navy:`);
      break;
    
    case 4:
      state.navyName = text;
      
      const totalContacts = (state.adminNumbers?.length || 0) + (state.navyNumbers?.length || 0);
      const progressMsg = await bot.sendMessage(chatId, `⏳ Memproses ${totalContacts} kontak...`);
      
      try {
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

        await db.insert(conversions).values({
          telegramUserId: chatId,
          conversionType: "ADMIN_CV",
          fileName: `${state.adminName}_${state.navyName}.vcf`,
          contactName: null,
          adminName: state.adminName || null,
          navyName: state.navyName || null,
          numberCount: totalContacts
        });

        console.log(`✅ Kontak admin dibuat oleh ${chatId}: ${totalContacts} kontak`);

        const askAgainKeyboard = {
          inline_keyboard: [
            [
              { text: "🔄 Buat Lagi", callback_data: "btn_admin" },
              { text: "📋 Menu Utama", callback_data: "btn_back" }
            ],
            [
              { text: "📄 TXT ke VCF", callback_data: "btn_txt_to_vcf" },
              { text: "🔗 Merge VCF", callback_data: "btn_merge" }
            ]
          ]
        };
        
        await bot.deleteMessage(chatId, progressMsg.message_id).catch(() => {});
        
        await bot.sendMessage(
          chatId,
          `✅ *Selesai!* ${totalContacts} kontak telah digabung dalam 1 file.\n\n` +
          `📁 *Detail:*\n` +
          `• Admin: ${state.adminName} (${state.adminNumbers?.length} nomor)\n` +
          `• Navy: ${state.navyName} (${state.navyNumbers?.length} nomor)\n` +
          `• File: ${state.adminName}_${state.navyName}.vcf\n\n` +
          `Mau melakukan apa selanjutnya?`,
          {
            parse_mode: "Markdown",
            reply_markup: askAgainKeyboard
          }
        );
        
      } catch (err: any) {
        console.error("Admin CV error:", err);
        await bot.sendMessage(chatId, "❌ Error membuat kontak");
      }
      
      userStates.set(chatId, { lastActivity: Date.now() });
      break;
  }
}

async function handleMergeVcf(
  bot: TelegramBot,
  chatId: number,
  state: UserState
): Promise<void> {
  if (!state.mergeFiles || state.mergeFiles.length < 2) {
    await bot.sendMessage(chatId, 
      "⚠️ *Minimal 2 file VCF diperlukan!*\n\n" +
      "Kirim minimal 2 file VCF terlebih dahulu.",
      { parse_mode: "Markdown" }
    );
    return;
  }

  const progressMsg = await bot.sendMessage(chatId, 
    `⏳ *Menggabungkan ${state.mergeFiles.length} file VCF...*`,
    { parse_mode: "Markdown" }
  );

  try {
    let combinedContent = "";
    
    for (let i = 0; i < state.mergeFiles.length; i++) {
      const fileContent = state.mergeFiles[i].toString();
      combinedContent += fileContent + "\n";
    }

    const fileName = `merged_${Date.now()}.vcf`;
    await bot.sendDocument(chatId, Buffer.from(combinedContent), {}, {
      filename: fileName,
      contentType: "text/vcard"
    });

    await db.insert(conversions).values({
      telegramUserId: chatId,
      conversionType: "MERGE_VCF",
      fileName: fileName,
      numberCount: state.mergeFiles.length,
      contactName: null,
      adminName: null,
      navyName: null
    });

    await bot.deleteMessage(chatId, progressMsg.message_id).catch(() => {});

    const askAgainKeyboard = {
      inline_keyboard: [
        [
          { text: "🔄 Merge Lagi", callback_data: "btn_merge" },
          { text: "📋 Menu Utama", callback_data: "btn_back" }
        ],
        [
          { text: "📄 TXT ke VCF", callback_data: "btn_txt_to_vcf" },
          { text: "👥 Buat Admin CV", callback_data: "btn_admin" }
        ]
      ]
    };
    
    await bot.sendMessage(
      chatId,
      `✅ *Selesai!* ${state.mergeFiles.length} file VCF berhasil digabung.\n\n` +
      `📁 File: ${fileName}\n` +
      `📊 Total file: ${state.mergeFiles.length}\n\n` +
      `Mau melakukan apa selanjutnya?`,
      { 
        parse_mode: "Markdown",
        reply_markup: askAgainKeyboard 
      }
    );

    console.log(`✅ ${chatId} merge ${state.mergeFiles.length} VCF files`);

  } catch (err: any) {
    console.error("Merge error:", err);
    await bot.sendMessage(chatId, "❌ Gagal menggabungkan file VCF.");
  }

  userStates.set(chatId, { lastActivity: Date.now() });
}

export function setupBot(): void {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log("❌ Token bot tidak ditemukan!");
    return;
  }

  const bot = new TelegramBot(token, { 
    polling: true,
    filepath: false
  });
  
  console.log("✅ Bot siap digunakan!");
  console.log("👑 Dibuat oleh: FETRUS MEILANO ILHAMSYAH");
  console.log("📞 Kirim /start ke bot untuk mulai");

  setInterval(() => {
    const now = Date.now();
    let cleanedCount = 0;
    userStates.forEach((state, userId) => {
      if (state.lastActivity && now - state.lastActivity > STATE_TTL) {
        userStates.delete(userId);
        cleanedCount++;
      }
    });
    if (cleanedCount > 0) {
      console.log(`🧹 Bersihkan ${cleanedCount} user tidak aktif`);
    }
  }, 5 * 60 * 1000);

  const userLastRequest = new Map<number, number>();
  const RATE_LIMIT_MS = 1500;

  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text?.trim();
    const userIdStr = chatId.toString();

    const now = Date.now();
    const lastRequest = userLastRequest.get(chatId);
    if (lastRequest && now - lastRequest < RATE_LIMIT_MS) {
      try {
        await bot.sendMessage(chatId, "⏳ Tunggu 1.5 detik sebelum request berikutnya");
      } catch (e) {}
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
        const welcomeMessage = `🤖 *BOT KONVERSI VCF* 🤖

*FITUR UTAMA:*
/start - Menu utama
/txt2vcf - Konversi TXT ke VCF
/admincv - Buat kontak Admin + Navy
/vcf2txt - Ekstrak nomor dari VCF
/merge - Gabungkan file VCF
/reset - Reset data pribadi
/help - Bantuan penggunaan
/about - Info pembuat bot

*Admin Only:*
/admin_stats - Lihat statistik
/admin_clear - Hapus semua data

👑 *Dibuat oleh:* FETRUS MEILANO ILHAMSYAH
📞 *Kontak:* ${OWNER_USERNAME}
🌐 *Website:* ${WEBSITE_URL}

Pilih fitur di bawah atau ketik command di atas:`;

        const inlineKeyboard = {
          inline_keyboard: [
            [
              { text: "📄 TXT → VCF", callback_data: "btn_txt_to_vcf" },
              { text: "👥 Admin CV", callback_data: "btn_admin" }
            ],
            [
              { text: "🔄 VCF → TXT", callback_data: "btn_vcf_to_txt" },
              { text: "🔗 Merge VCF", callback_data: "btn_merge" }
            ],
            [
              { text: "📋 Menu Lengkap", callback_data: "btn_full_menu" },
              { text: "ℹ️ About", callback_data: "btn_about" }
            ],
            userIdStr === ADMIN_ID ? [
              { text: "⚙️ Admin Panel", callback_data: "btn_admin_panel" }
            ] : []
          ].filter(Boolean)
        };

        const photoPath = path.join(process.cwd(), "attached_assets", "IMG_2950_1766914856970.jpeg");
        if (fs.existsSync(photoPath)) {
          await bot.sendPhoto(chatId, photoPath, {
            caption: welcomeMessage,
            parse_mode: "Markdown",
            reply_markup: inlineKeyboard
          });
        } else {
          await bot.sendMessage(chatId, welcomeMessage, {
            parse_mode: "Markdown",
            reply_markup: inlineKeyboard
          });
        }

        console.log(`👋 User ${chatId} (${msg.from?.first_name || 'Unknown'}) start bot`);

      } catch (error: any) {
        console.error("Start error:", error);
        await bot.sendMessage(chatId, "Halo! Ketik /start untuk memulai");
      }

      userStates.set(chatId, { lastActivity: now });
      return;
    }

    if (text === "/help") {
      const helpText = `📚 *BANTUAN PENGGUNAAN*

*COMMAND UTAMA:*
/txt2vcf - Konversi file TXT ke VCF
• Format: satu nomor per baris
• Contoh: 08123456789

/admincv - Buat kontak Admin + Navy
• Masukkan nomor admin dan navy
• Hasil: 1 file VCF gabungan

/vcf2txt - Ekstrak nomor dari VCF
• Kirim file .vcf
• Dapatkan file .txt berisi nomor

/merge - Gabungkan file VCF
• Kirim 2+ file VCF
• Hasil: 1 file VCF gabungan

/reset - Hapus data pribadi
• Reset riwayat konversi Anda

/about - Info pembuat bot
• Kontak developer

*FORMAT FILE:*
• .txt - Untuk konversi ke VCF
• .vcf - Untuk ekstrak atau merge

📞 *Butuh bantuan?* Hubungi: ${OWNER_USERNAME}`;
      
      await bot.sendMessage(chatId, helpText, { parse_mode: "Markdown" });
      return;
    }

    if (text === "/about") {
      const aboutText = `👑 *TENTANG PEMBUAT*

*Nama:* FETRUS MEILANO ILHAMSYAH
*Role:* Developer & Pemilik Bot
*Telegram:* ${OWNER_USERNAME}
*ID Telegram:* ${OWNER_ID}
*Website:* ${WEBSITE_URL}

*Bot VCF Converter ini dibuat untuk:*
• Membantu konversi nomor telepon
• Memudahkan pembuatan kontak
• Tools gratis untuk komunitas

*Fitur Unggulan:*
⚡ Konversi cepat & berurutan
🔢 Format nomor otomatis (+62)
📁 File rapi & terorganisir
🎯 Semua fitur GRATIS!

*Ingin request fitur atau laporkan bug?*
Hubungi saya langsung di Telegram!

*Terima kasih telah menggunakan bot ini!* 🙏`;
      
      await bot.sendMessage(chatId, aboutText, { parse_mode: "Markdown" });
      return;
    }

    if (text === "/txt2vcf") {
      userStates.set(chatId, {
        mode: "TXT_TO_VCF",
        step: 0,
        lastActivity: now
      });
      await bot.sendMessage(chatId, 
        "📤 *KIRIM FILE .txt*\n\n" +
        "Kirim file .txt berisi daftar nomor telepon.\n\n" +
        "*Format yang didukung:*\n" +
        "• Satu nomor per baris\n" +
        "• Contoh:\n" +
        "08123456789\n" +
        "08198765432\n" +
        "08211223344\n\n" +
        "Bot akan otomatis format ke +62",
        { parse_mode: "Markdown" }
      );
      return;
    }

    if (text === "/admincv") {
      userStates.set(chatId, {
        mode: "ADMIN_CV",
        step: 1,
        lastActivity: now
      });
      await bot.sendMessage(chatId, 
        "👥 *BUAT KONTAK ADMIN + NAVY*\n\n" +
        "Masukkan nomor admin (satu per baris):\n\n" +
        "*Contoh:*\n" +
        "08123456789\n" +
        "08198765432",
        { parse_mode: "Markdown" }
      );
      return;
    }

    if (text === "/vcf2txt") {
      userStates.set(chatId, {
        mode: "VCF_TO_TXT",
        lastActivity: now
      });
      await bot.sendMessage(chatId, 
        "🔄 *EKSTRAK NOMOR DARI VCF*\n\n" +
        "Kirim file .vcf untuk diekstrak nomornya.\n\n" +
        "Bot akan mengambil semua nomor telepon dari file VCF dan mengembalikan dalam format TXT.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    if (text === "/merge") {
      userStates.set(chatId, {
        mode: "MERGE_VCF",
        step: 1,
        mergeFiles: [],
        mergeFileNames: [],
        lastActivity: now
      });
      await bot.sendMessage(chatId, 
        "🔗 *GABUNGKAN FILE VCF*\n\n" +
        "Kirim file VCF pertama:\n\n" +
        "*Catatan:*\n" +
        "• Kirim minimal 2 file VCF\n" +
        "• Maksimal 10 file\n" +
        "• Hasil: 1 file VCF gabungan",
        { parse_mode: "Markdown" }
      );
      return;
    }

    if (text === "/reset") {
      try {
        await db.delete(conversions).where(eq(conversions.telegramUserId, chatId));
        userStates.set(chatId, { lastActivity: now });
        await bot.sendMessage(chatId, "✅ *Data pribadi Anda telah direset!*", { parse_mode: "Markdown" });
      } catch (err: any) {
        console.error("Reset error:", err);
        await bot.sendMessage(chatId, "❌ Gagal mereset data.");
      }
      return;
    }

    if (text === "/admin_stats" && userIdStr === ADMIN_ID) {
      try {
        const allConversions = await db.select().from(conversions);
        const userSet = new Set<number>();
        allConversions.forEach(c => userSet.add(c.telegramUserId));
        const totalUsers = userSet.size;
        const totalConversions = allConversions.length;
        const txtToVcf = allConversions.filter(c => c.conversionType === "TXT_TO_VCF").length;
        const adminCv = allConversions.filter(c => c.conversionType === "ADMIN_CV").length;
        const vcfToTxt = allConversions.filter(c => c.conversionType === "VCF_TO_TXT").length;
        
        console.log("==================================");
        console.log("📊 ADMIN STATS REQUEST");
        console.log(`👤 By: ${ADMIN_ID}`);
        console.log(`👥 Users: ${totalUsers}`);
        console.log(`🔄 Conversions: ${totalConversions}`);
        console.log("==================================");
        
        await bot.sendMessage(chatId, 
          `📊 *STATISTIK BOT*\n\n` +
          `👥 User Unik: *${totalUsers}*\n` +
          `🔄 Total Konversi: *${totalConversions}*\n` +
          `📄 TXT → VCF: *${txtToVcf}*\n` +
          `👥 Kontak Admin: *${adminCv}*\n` +
          `🔄 VCF → TXT: *${vcfToTxt}*\n` +
          `💾 Cache Aktif: *${userStates.size}*\n\n` +
          `⏰ Server: ${new Date().toLocaleTimeString()}`,
          { parse_mode: "Markdown" }
        );
      } catch (err: any) {
        await bot.sendMessage(chatId, "❌ Gagal mengambil statistik.");
      }
      return;
    }

    if (text === "/admin_clear" && userIdStr === ADMIN_ID) {
      try {
        const beforeCount = await db.select().from(conversions);
        const cacheCount = userStates.size;
        
        await db.delete(conversions);
        userStates.clear();
        
        console.log("==================================");
        console.log("🚨 ADMIN CLEAR ALL DATA!");
        console.log("==================================");
        console.log(`👤 Admin: ${ADMIN_ID}`);
        console.log(`🗑️ Records: ${beforeCount.length}`);
        console.log(`🧹 Cache: ${cacheCount} users`);
        console.log(`⏰ Time: ${new Date().toLocaleTimeString()}`);
        console.log("==================================");
        
        await bot.sendMessage(chatId, 
          "✅ *SEMUA DATA DIHAPUS!*\n\n" +
          `🗑️ Records: ${beforeCount.length}\n` +
          `🧹 Cache: ${cacheCount} users\n` +
          `⏰ Waktu: ${new Date().toLocaleTimeString()}\n\n` +
          "Database dan cache sudah bersih.",
          { parse_mode: "Markdown" }
        );
      } catch (err: any) {
        console.error("Admin clear error:", err.message);
        await bot.sendMessage(chatId, "❌ Gagal menghapus data.");
      }
      return;
    }

    if (msg.document) {
      const fileName = msg.document.file_name?.toLowerCase() || "";
      const userName = msg.from?.first_name || "User";
      
      console.log(`📁 ${userName} (${chatId}) upload: ${fileName}`);
      
      const state = userStates.get(chatId) || { lastActivity: now };
      
      if (state.mode === "MERGE_VCF" && fileName.endsWith(".vcf")) {
        try {
          const fileLink = await bot.getFileLink(msg.document.file_id);
          const response = await fetch(fileLink);
          const buffer = await response.arrayBuffer();
          
          if (!state.mergeFiles) state.mergeFiles = [];
          if (!state.mergeFileNames) state.mergeFileNames = [];
          
          state.mergeFiles.push(Buffer.from(buffer));
          state.mergeFileNames.push(fileName);
          state.lastActivity = now;
          userStates.set(chatId, state);
          
          const fileCount = state.mergeFiles.length;
          
          if (fileCount === 1) {
            await bot.sendMessage(chatId, 
              `✅ File 1 diterima: ${fileName}\n\n` +
              `Kirim file VCF kedua (minimal 2 file, maksimal 10).\n` +
              `Ketik /done jika sudah selesai mengirim file.`,
              { parse_mode: "Markdown" }
            );
          } else if (fileCount >= 2 && fileCount < 10) {
            await bot.sendMessage(chatId, 
              `✅ File ${fileCount} diterima: ${fileName}\n\n` +
              `Total: ${fileCount} file VCF\n` +
              `Ketik /done untuk menggabungkan atau kirim file VCF lagi.`,
              { parse_mode: "Markdown" }
            );
          } else if (fileCount >= 10) {
            await bot.sendMessage(chatId, 
              `✅ File ke-10 diterima\n\n` +
              `Maksimal 10 file tercapai.\n` +
              `Ketik /done untuk menggabungkan semua file.`,
              { parse_mode: "Markdown" }
            );
          }
          
        } catch (error: any) {
          console.error("Merge file error:", error);
          await bot.sendMessage(chatId, "❌ Gagal memproses file VCF.");
        }
        return;
      }
      
      if (fileName.endsWith(".txt")) {
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
            await bot.editMessageText("⚠️ File kosong", {
              chat_id: chatId,
              message_id: progressMsg.message_id
            });
            return;
          }

          userStates.set(chatId, {
            mode: "TXT_TO_VCF",
            step: 1,
            fileNumbers: numbers,
            numberCount: numbers.length,
            lastActivity: now
          });

          console.log(`✅ ${userName} upload TXT: ${numbers.length} nomor`);

          await bot.editMessageText(
            `✅ ${numbers.length} nomor ditemukan\n\nMasukkan nama kontak:`,
            {
              chat_id: chatId,
              message_id: progressMsg.message_id
            }
          );
        } catch (error: any) {
          console.error("File error:", error);
          await bot.sendMessage(chatId, "❌ Gagal memproses file.");
        }
        
      } else if (fileName.endsWith(".vcf")) {
        try {
          const progressMsg = await bot.sendMessage(chatId, "⏳ Mengekstrak nomor...");
          
          const fileLink = await bot.getFileLink(msg.document.file_id);
          const response = await fetch(fileLink);
          const vcfContent = await response.text();
          
          const numbers = extractNumbersFromVcf(vcfContent);
          
          if (numbers.length === 0) {
            await bot.editMessageText("⚠️ Tidak ada nomor ditemukan", {
              chat_id: chatId,
              message_id: progressMsg.message_id
            });
            return;
          }

          const txtContent = numbers.map(n => formatPhoneNumber(n)).join('\n');
          await bot.sendDocument(chatId, Buffer.from(txtContent), {}, {
            filename: `nomor_${Date.now()}.txt`,
            contentType: "text/plain"
          });

          await db.insert(conversions).values({
            telegramUserId: chatId,
            conversionType: "VCF_TO_TXT",
            fileName: `extracted_numbers.txt`,
            numberCount: numbers.length,
            contactName: null,
            adminName: null,
            navyName: null
          });

          await bot.deleteMessage(chatId, progressMsg.message_id).catch(() => {});

          const askAgainKeyboard = {
            inline_keyboard: [
              [
                { text: "🔄 Ekstrak Lagi", callback_data: "btn_vcf_to_txt" },
                { text: "📋 Menu Utama", callback_data: "btn_back" }
              ],
              [
                { text: "📄 TXT ke VCF", callback_data: "btn_txt_to_vcf" },
                { text: "👥 Buat Admin CV", callback_data: "btn_admin" }
              ]
            ]
          };
          
          await bot.sendMessage(
            chatId,
            `✅ *Selesai!* ${numbers.length} nomor diekstrak dari file VCF.\n\n` +
            `Mau melakukan apa selanjutnya?`,
            {
              parse_mode: "Markdown",
              reply_markup: askAgainKeyboard
            }
          );

          console.log(`✅ ${userName} ekstrak VCF: ${numbers.length} nomor`);

          userStates.set(chatId, { lastActivity: Date.now() });
          
        } catch (error: any) {
          console.error("VCF error:", error);
          await bot.sendMessage(chatId, "❌ Gagal memproses VCF.");
        }
      } else {
        await bot.sendMessage(chatId, "⚠️ Format tidak didukung. Gunakan .txt atau .vcf");
      }
      return;
    }

    if (state.mode === "TXT_TO_VCF") {
      await handleTxtToVcf(bot, chatId, state, text);
      return;
    } else if (state.mode === "ADMIN_CV") {
      await handleAdminCv(bot, chatId, state, text);
      return;
    } else if (state.mode === "MERGE_VCF" && text === "/done") {
      await handleMergeVcf(bot, chatId, state);
      return;
    }

    await bot.sendMessage(chatId, 
      `🤖 *BOT KONVERSI VCF*\n\n` +
      `Ketik /start untuk menu utama\n` +
      `/help untuk bantuan\n` +
      `/about untuk info pembuat\n\n` +
      `👑 *Developer:* FETRUS MEILANO ILHAMSYAH\n` +
      `📞 ${OWNER_USERNAME}`,
      { parse_mode: "Markdown" }
    );
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
      await bot.answerCallbackQuery(query.id);
      
      if (query.data === "btn_txt_to_vcf") {
        userStates.set(chatId, {
          mode: "TXT_TO_VCF",
          step: 0,
          lastActivity: now
        });
        await bot.sendMessage(chatId, "📤 Kirim file .txt berisi nomor telepon (satu nomor per baris)");
      } 
      else if (query.data === "btn_admin") {
        userStates.set(chatId, {
          mode: "ADMIN_CV",
          step: 1,
          lastActivity: now
        });
        await bot.sendMessage(chatId, "Masukkan nomor admin (satu nomor per baris):");
      }
      else if (query.data === "btn_vcf_to_txt") {
        userStates.set(chatId, {
          mode: "VCF_TO_TXT",
          lastActivity: now
        });
        await bot.sendMessage(chatId, "Kirim file .vcf untuk diekstrak nomornya");
      }
      else if (query.data === "btn_merge") {
        userStates.set(chatId, {
          mode: "MERGE_VCF",
          step: 1,
          mergeFiles: [],
          mergeFileNames: [],
          lastActivity: now
        });
        await bot.sendMessage(chatId, 
          "🔗 *GABUNGKAN FILE VCF*\n\n" +
          "Kirim file VCF pertama:\n\n" +
          "*Catatan:*\n" +
          "• Kirim minimal 2 file VCF\n" +
          "• Maksimal 10 file\n" +
          "• Hasil: 1 file VCF gabungan\n\n" +
          "Ketik /done setelah semua file dikirim",
          { parse_mode: "Markdown" }
        );
      }
      else if (query.data === "btn_full_menu") {
        const menuText = `📋 *MENU LENGKAP BOT*

*COMMAND TEXT:*
/start - Menu utama dengan tombol
/txt2vcf - Konversi TXT ke VCF
/admincv - Buat kontak Admin + Navy  
/vcf2txt - Ekstrak nomor dari VCF
/merge - Gabungkan file VCF
/reset - Reset data pribadi
/help - Panduan penggunaan
/about - Info pembuat bot

*TOMBOL CEPAT:*
📄 TXT → VCF - Konversi file
👥 Admin CV - Buat kontak admin
🔄 VCF → TXT - Ekstrak nomor
🔗 Merge VCF - Gabung file

*INFO:*
👑 Developer: FETRUS MEILANO ILHAMSYAH
📞 Telegram: ${OWNER_USERNAME}
🌐 Website: ${WEBSITE_URL}

*Admin Only:*
/admin_stats - Statistik bot
/admin_clear - Hapus semua data`;
        
        await bot.sendMessage(chatId, menuText, { parse_mode: "Markdown" });
      }
      else if (query.data === "btn_about") {
        const aboutText = `👑 *TENTANG PEMBUAT*

*Nama:* FETRUS MEILANO ILHAMSYAH
*Role:* Developer & Pemilik Bot
*Telegram:* ${OWNER_USERNAME}
*ID Telegram:* ${OWNER_ID}
*Website:* ${WEBSITE_URL}

*Bot VCF Converter ini dibuat untuk:*
• Membantu konversi nomor telepon
• Memudahkan pembuatan kontak
• Tools gratis untuk komunitas

*Fitur Unggulan:*
⚡ Konversi cepat & berurutan
🔢 Format nomor otomatis (+62)
📁 File rapi & terorganisir
🎯 Semua fitur GRATIS!

*Ingin request fitur atau laporkan bug?*
Hubungi saya langsung di Telegram!

*Terima kasih telah menggunakan bot ini!* 🙏`;
        
        await bot.sendMessage(chatId, aboutText, { parse_mode: "Markdown" });
      }
      else if (query.data === "btn_reset") {
        try {
          await db.delete(conversions).where(eq(conversions.telegramUserId, chatId));
          userStates.set(chatId, { lastActivity: now });
          await bot.sendMessage(chatId, "✅ Data direset");
        } catch (err: any) {
          console.error("Reset error:", err);
          await bot.sendMessage(chatId, "❌ Gagal reset");
        }
      }
      else if (query.data === "btn_admin_panel" && chatId.toString() === ADMIN_ID) {
        const adminKeyboard = {
          inline_keyboard: [
            [
              { text: "📊 Statistik", callback_data: "btn_admin_stats" },
              { text: "🗑️ Hapus Semua", callback_data: "btn_admin_clear" }
            ],
            [
              { text: "📋 Cache Aktif", callback_data: "btn_admin_cache" },
              { text: "🔙 Kembali", callback_data: "btn_back" }
            ]
          ]
        };
        
        await bot.sendMessage(chatId, 
          "⚙️ *Admin Panel*\n\nPilih opsi:",
          { 
            parse_mode: "Markdown",
            reply_markup: adminKeyboard 
          }
        );
      }
      else if (query.data === "btn_admin_stats" && chatId.toString() === ADMIN_ID) {
        try {
          const allConversions = await db.select().from(conversions);
          const userSet = new Set<number>();
          allConversions.forEach(c => userSet.add(c.telegramUserId));
          const totalUsers = userSet.size;
          const totalConversions = allConversions.length;
          
          await bot.sendMessage(chatId, 
            `📊 *Statistik Real-time*\n\n` +
            `👥 User Unik: ${totalUsers}\n` +
            `🔄 Total Konversi: ${totalConversions}\n` +
            `💾 Cache Aktif: ${userStates.size}\n` +
            `⏰ Server: ${new Date().toLocaleTimeString()}`,
            { parse_mode: "Markdown" }
          );
        } catch (err: any) {
          await bot.sendMessage(chatId, "❌ Gagal mengambil statistik");
        }
      }
      else if (query.data === "btn_admin_clear" && chatId.toString() === ADMIN_ID) {
        const confirmKeyboard = {
          inline_keyboard: [
            [
              { text: "✅ Ya, Hapus", callback_data: "btn_admin_clear_confirm" },
              { text: "❌ Batal", callback_data: "btn_admin_panel" }
            ]
          ]
        };
        
        await bot.sendMessage(chatId, 
          "⚠️ *PERINGATAN!*\n\n" +
          "Anda akan menghapus:\n" +
          "• Semua data konversi\n" +
          "• Semua cache user\n\n" +
          "Tindakan ini tidak dapat dibatalkan!\n\n" +
          "Yakin ingin melanjutkan?",
          { 
            parse_mode: "Markdown",
            reply_markup: confirmKeyboard 
          }
        );
      }
      else if (query.data === "btn_admin_clear_confirm" && chatId.toString() === ADMIN_ID) {
        try {
          const beforeCount = await db.select().from(conversions);
          const cacheCount = userStates.size;
          
          await db.delete(conversions);
          userStates.clear();
          
          console.log("==================================");
          console.log("🚨 ADMIN CLEAR ALL DATA!");
          console.log("==================================");
          console.log(`👤 Admin: ${ADMIN_ID}`);
          console.log(`🗑️ Records: ${beforeCount.length}`);
          console.log(`🧹 Cache: ${cacheCount} users`);
          console.log(`⏰ Time: ${new Date().toLocaleTimeString()}`);
          console.log("==================================");
          
          await bot.sendMessage(chatId, 
            "✅ *Data Berhasil Dihapus!*\n\n" +
            `🗑️ Records: ${beforeCount.length}\n` +
            `🧹 Cache: ${cacheCount} users\n` +
            `⏰ Waktu: ${new Date().toLocaleTimeString()}\n\n` +
            "Database dan cache sudah bersih.",
            { parse_mode: "Markdown" }
          );
        } catch (err: any) {
          console.error("❌ Admin clear error:", err.message);
          await bot.sendMessage(chatId, "❌ Gagal menghapus data");
        }
      }
      else if (query.data === "btn_admin_cache" && chatId.toString() === ADMIN_ID) {
        let cacheInfo = `💾 *Cache Aktif: ${userStates.size} user*\n\n`;
        
        let count = 0;
        userStates.forEach((state, userId) => {
          if (count < 10) {
            const lastActive = state.lastActivity ? 
              Math.round((Date.now() - state.lastActivity) / 60000) + " menit lalu" : 
              "unknown";
            cacheInfo += `👤 ${userId}: ${state.mode || 'idle'} (${lastActive})\n`;
            count++;
          }
        });
        
        if (userStates.size > 10) {
          cacheInfo += `\n... dan ${userStates.size - 10} user lainnya`;
        }
        
        await bot.sendMessage(chatId, cacheInfo, { parse_mode: "Markdown" });
      }
      else if (query.data === "btn_back") {
        const welcomeMessage = `🤖 *BOT KONVERSI VCF* 🤖

*FITUR UTAMA:*
/start - Menu utama
/txt2vcf - Konversi TXT ke VCF
/admincv - Buat kontak Admin + Navy
/vcf2txt - Ekstrak nomor dari VCF
/merge - Gabungkan file VCF
/reset - Reset data pribadi
/help - Bantuan penggunaan
/about - Info pembuat bot

👑 *Dibuat oleh:* FETRUS MEILANO ILHAMSYAH
📞 *Kontak:* ${OWNER_USERNAME}
🌐 *Website:* ${WEBSITE_URL}

Pilih fitur di bawah:`;

        const inlineKeyboard = {
          inline_keyboard: [
            [
              { text: "📄 TXT → VCF", callback_data: "btn_txt_to_vcf" },
              { text: "👥 Admin CV", callback_data: "btn_admin" }
            ],
            [
              { text: "🔄 VCF → TXT", callback_data: "btn_vcf_to_txt" },
              { text: "🔗 Merge VCF", callback_data: "btn_merge" }
            ],
            [
              { text: "📋 Menu Lengkap", callback_data: "btn_full_menu" },
              { text: "ℹ️ About", callback_data: "btn_about" }
            ],
            chatId.toString() === ADMIN_ID ? [
              { text: "⚙️ Admin Panel", callback_data: "btn_admin_panel" }
            ] : []
          ].filter(Boolean)
        };

        await bot.sendMessage(chatId, welcomeMessage, {
          parse_mode: "Markdown",
          reply_markup: inlineKeyboard
        });
      }
    } catch (error: any) {
      console.error("Callback error:", error);
    }
  });

  bot.on("polling_error", (error: Error) => {
    console.error("❌ Polling Error:", error.message);
  });

  console.log("==================================");
  console.log("🤖 BOT VCF CONVERTER");
  console.log("==================================");
  console.log("👑 Pemilik: FETRUS MEILANO ILHAMSYAH");
  console.log(`📞 Telegram: ${OWNER_USERNAME}`);
  console.log(`🆔 Owner ID: ${OWNER_ID}`);
  console.log(`🌐 Website: ${WEBSITE_URL}`);
  console.log(`🔧 Admin ID: ${ADMIN_ID || "Belum diatur"}`);
  console.log(`⏰ Dimulai: ${new Date().toLocaleTimeString()}`);
  console.log("==================================");
}