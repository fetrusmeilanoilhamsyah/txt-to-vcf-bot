import TelegramBot from "node-telegram-bot-api";
import fs from "fs";
import path from "path";
import { db } from "./db";
import { conversions } from "@shared/schema";
import { eq } from "drizzle-orm";
import AdmZip from "adm-zip";

interface UserState {
  mode?: "TXT_TO_VCF" | "ADMIN_CV" | "VCF_TO_TXT" | "MERGE_VCF" | "MERGE_TXT" | "ADMIN_RESET_NEON_DB" | undefined;
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
  mergeFileIds?: string[]; // TAMBAHAN: Track file_id untuk detect duplikat
  mergeTxtFiles?: Buffer[];
  mergeTxtFileIds?: string[]; // TAMBAHAN: Track file_id untuk TXT
  mergeTxtNumbers?: string[];
}

const userStates = new Map<number, UserState>();
const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID?.toString() || "";
const OWNER_ID = "6404822546";
const OWNER_USERNAME = "@FEE999888";
const WEBSITE_URL = "https://fetrusmeilanoilhamsyah.github.io";
const STATE_TTL = 30 * 60 * 1000;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_CONTACTS = 50000;
const MAX_MERGE_FILES = 100;

console.log("🔥 Bot VCF Converter aktif!");
console.log(`👑 Pemilik: ${OWNER_ID} (${OWNER_USERNAME})`);
console.log(`🆔 Admin: ${ADMIN_ID || "Belum diatur"}`);

const mainMenuKeyboard = {
  keyboard: [
    [{ text: "TXT → VCF" }, { text: "Admin CV" }],
    [{ text: "VCF → TXT" }, { text: "Merge VCF" }, { text: "Merge TXT" }],
    [{ text: "Menu Utama" }, { text: "Help" }, { text: "Stats" }],
    [{ text: "Cancel" }, { text: "Clear Data" }],
  ],
  resize_keyboard: true,
  persistent: true
};

const adminMenuKeyboard = {
  keyboard: [
    [{ text: "TXT → VCF" }, { text: "Admin CV" }],
    [{ text: "VCF → TXT" }, { text: "Merge VCF" }, { text: "Merge TXT" }],
    [{ text: "Menu Utama" }, { text: "Help" }, { text: "Stats" }],
    [{ text: "Cancel" }, { text: "Reset Database" }],
  ],
  resize_keyboard: true,
  persistent: true
};

// ===== OPTIMIZED VALIDATION =====
const COUNTRY_CODES = {
  '852': 'HK', '1': 'US/CA', '65': 'SG', '60': 'MY', '66': 'TH',
  '84': 'VN', '63': 'PH', '81': 'JP', '82': 'KR', '86': 'CN',
  '91': 'IN', '44': 'UK', '33': 'FR', '49': 'DE', '61': 'AU'
};

function validateAndFormatPhoneNumber(number: string): string | null {
  if (!number) return null;
  const cleaned = number.replace(/\D/g, '');
  if (cleaned.length < 10 || cleaned.length > 15) return null;

  // Check for international codes
  for (const [code, _] of Object.entries(COUNTRY_CODES)) {
    if (cleaned.startsWith(code) && cleaned.length >= 11) {
      return '+' + cleaned;
    }
  }

  // Indonesia specific
  if (cleaned.startsWith('0')) return '+62' + cleaned.substring(1);
  if (cleaned.startsWith('62')) return '+' + cleaned;
  if (cleaned.startsWith('8')) return '+62' + cleaned;

  return cleaned;
}

function formatPhoneNumber(number: string): string {
  return validateAndFormatPhoneNumber(number) || number;
}

// ===== OPTIMIZED VCF EXTRACTION =====
function extractNumbersFromVcf(vcfContent: string): string[] {
  const numbers = new Set<string>();
  const telRegex = /TEL[^:]*:([^\r\n]+)/gi;
  let match;

  while ((match = telRegex.exec(vcfContent)) !== null) {
    const number = match[1].replace(/\D/g, '');
    if (number.length >= 10) {
      const formatted = validateAndFormatPhoneNumber(number);
      if (formatted) numbers.add(formatted);
    }
  }

  return Array.from(numbers);
}

// ===== OPTIMIZED PROGRESS BAR =====
function createProgressBar(current: number, total: number, width = 20): string {
  const percentage = current / total;
  const filled = Math.round(width * percentage);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${Math.round(percentage * 100)}%`;
}

// ===== OPTIMIZED ZIP CREATION =====
async function sendAsZip(
  bot: TelegramBot,
  chatId: number,
  numbers: string[],
  contactName: string,
  fileName: string,
  splitLimit: number
): Promise<void> {
  const zip = new AdmZip();
  const totalChunks = Math.ceil(numbers.length / splitLimit);
  const progressMsg = await bot.sendMessage(chatId, `⏳ Membuat ZIP ${totalChunks} file...`);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * splitLimit;
    const chunk = numbers.slice(start, start + splitLimit);
    const fileNum = i + 1;
    const filePartName = `${fileName}${String(fileNum).padStart(3, '0')}.vcf`;
    
    const vcardContent = chunk.map((number, idx) => 
      `BEGIN:VCARD\nVERSION:3.0\nFN:${contactName} ${start + idx + 1}\nTEL;TYPE=CELL:${formatPhoneNumber(number)}\nEND:VCARD`
    ).join("\n");

    zip.addFile(filePartName, Buffer.from(vcardContent));
  }

  const zipBuffer = zip.toBuffer();
  await bot.sendDocument(chatId, zipBuffer, {}, {
    filename: `${fileName}_${numbers.length}_contacts.zip`,
    contentType: "application/zip"
  });

  await bot.deleteMessage(chatId, progressMsg.message_id).catch(() => {});
}

// ===== OPTIMIZED VCF GENERATION =====
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
  // Use ZIP for large files
  if (numbers.length > 5000) {
    await sendAsZip(bot, chatId, numbers, contactName, fileName, splitLimit);
    await bot.deleteMessage(chatId, progressMsgId).catch(() => {});
    return;
  }

  const totalFiles = Math.ceil(numbers.length / splitLimit);
  const BATCH_SIZE = 20;
  let sentCount = 0;

  for (let i = 0; i < totalFiles; i += BATCH_SIZE) {
    const batchEnd = Math.min(i + BATCH_SIZE, totalFiles);
    const batchPromises = [];

    for (let j = i; j < batchEnd; j++) {
      const start = j * splitLimit;
      const chunk = numbers.slice(start, start + splitLimit);
      const fileNum = fileStartNumber + j;
      const filePartName = `${fileName}${String(fileNum).padStart(3, '0')}.vcf`;

      const vcardContent = chunk.map((number, idx) =>
        `BEGIN:VCARD\nVERSION:3.0\nFN:${contactName} ${start + idx + 1}\nTEL;TYPE=CELL:${formatPhoneNumber(number)}\nEND:VCARD`
      ).join("\n");

      batchPromises.push(
        bot.sendDocument(chatId, Buffer.from(vcardContent), {}, {
          filename: filePartName,
          contentType: "text/vcard"
        }).catch(() => null)
      );
    }

    await Promise.all(batchPromises);
    sentCount += batchEnd - i;

    if (sentCount % 20 === 0 || sentCount === totalFiles) {
      await bot.editMessageText(
        `⏳ ${sentCount}/${totalFiles} file\n${createProgressBar(sentCount, totalFiles)}`,
        { chat_id: chatId, message_id: progressMsgId }
      ).catch(() => {});
    }

    if (batchEnd < totalFiles) await new Promise(resolve => setTimeout(resolve, 50));
  }

  await bot.deleteMessage(chatId, progressMsgId).catch(() => {});
}

// ===== OPTIMIZED MERGE TXT =====
async function handleMergeTxt(
  bot: TelegramBot,
  chatId: number,
  state: UserState
): Promise<void> {
  if (!state.mergeTxtFiles || state.mergeTxtFiles.length < 2) {
    await bot.sendMessage(chatId, "Minimal 2 file TXT diperlukan!", { reply_markup: mainMenuKeyboard });
    return;
  }

  const progressMsg = await bot.sendMessage(chatId, `Menggabungkan ${state.mergeTxtFiles.length} file TXT...`);

  try {
    const allNumbers = new Set<string>();
    let totalNumbersBefore = 0;

    for (const fileBuffer of state.mergeTxtFiles) {
      const lines = fileBuffer.toString().split(/\r?\n/);
      totalNumbersBefore += lines.length;

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          const formatted = validateAndFormatPhoneNumber(trimmed);
          if (formatted) allNumbers.add(formatted);
        }
      }
    }

    const uniqueNumbers = Array.from(allNumbers);
    const txtContent = uniqueNumbers.join('\n');
    const fileName = `merged_${Date.now()}_${uniqueNumbers.length}_numbers.txt`;

    await bot.sendDocument(chatId, Buffer.from(txtContent), {}, {
      filename: fileName,
      contentType: "text/plain"
    });

    await db.insert(conversions).values({
      telegramUserId: chatId,
      conversionType: "MERGE_TXT",
      fileName: fileName,
      numberCount: uniqueNumbers.length,
      contactName: null,
      adminName: null,
      navyName: null
    }).catch(() => {});

    await bot.deleteMessage(chatId, progressMsg.message_id).catch(() => {});

    await bot.sendMessage(chatId,
      `Selesai\n\n` +
      `${state.mergeTxtFiles.length} file digabung\n` +
      `Sebelum: ${totalNumbersBefore}\n` +
      `Setelah: ${uniqueNumbers.length} unik\n` +
      `Duplikat dihapus: ${totalNumbersBefore - uniqueNumbers.length}`,
      { reply_markup: mainMenuKeyboard }
    );

    console.log(`Merge TXT: ${chatId} - ${state.mergeTxtFiles.length} files -> ${uniqueNumbers.length} unique`);
  } catch (err: any) {
    console.error("Merge TXT error:", err);
    await bot.deleteMessage(chatId, progressMsg.message_id).catch(() => {});
    await bot.sendMessage(chatId, "Gagal menggabungkan file TXT.", { reply_markup: mainMenuKeyboard });
  }

  userStates.set(chatId, { lastActivity: Date.now() });
}

// ===== OPTIMIZED TXT TO VCF HANDLER =====
async function handleTxtToVcf(
  bot: TelegramBot,
  chatId: number,
  state: UserState,
  text?: string
): Promise<void> {
  if (!text) return;

  if (!state.fileNumbers || state.fileNumbers.length === 0) {
    await bot.sendMessage(chatId, "⚠️ Upload file terlebih dahulu", { reply_markup: mainMenuKeyboard });
    return;
  }

  switch (state.step) {
    case 1:
      state.contactName = text;
      state.step = 2;
      await bot.sendMessage(chatId, `✅ Nama kontak: ${text}\n\n📝 Masukkan nama file:`);
      break;

    case 2:
      state.fileName = text;
      state.step = 3;
      await bot.sendMessage(chatId, `✅ Nama file: ${text}\n\n🔢 Nomor awal file (contoh: 1):`);
      break;

    case 3:
      const startNum = parseInt(text);
      if (isNaN(startNum) || startNum < 0) {
        await bot.sendMessage(chatId, "⚠️ Masukkan angka valid");
        return;
      }
      state.fileStartNumber = startNum;
      state.step = 4;
      await bot.sendMessage(chatId, `✅ Nomor awal: ${startNum}\n\n📊 Kontak per file (atau "all"):`);
      break;

    case 4:
      const limit = text.toLowerCase() === "all" ? state.numberCount || 999999 : parseInt(text);
      if (isNaN(limit) || limit < 1) {
        await bot.sendMessage(chatId, "⚠️ Masukkan angka valid atau 'all'");
        return;
      }

      state.splitLimit = limit;
      const fileCount = Math.ceil(state.numberCount! / limit);
      const progressMsg = await bot.sendMessage(chatId, `⏳ Memproses ${state.numberCount} nomor...`);

      try {
        await generateAndSendVcf(
          bot, chatId, state.fileNumbers!, state.contactName!,
          state.fileName!, state.fileStartNumber!, state.splitLimit!, progressMsg.message_id
        );

        await db.insert(conversions).values({
          telegramUserId: chatId,
          conversionType: "TXT_TO_VCF",
          fileName: state.fileName || null,
          contactName: state.contactName || null,
          adminName: null,
          navyName: null,
          numberCount: state.numberCount || null
        }).catch(() => {});

        await bot.sendMessage(chatId,
          `✅ Selesai!\n\n📊 ${state.numberCount} nomor → ${fileCount} file\n📁 ${state.contactName}\n\nPilih menu:`,
          { reply_markup: mainMenuKeyboard }
        );

        console.log(`✅ TXT→VCF: ${chatId} - ${state.numberCount} numbers`);
      } catch (err: any) {
        console.error("Conversion error:", err);
        await bot.sendMessage(chatId, "❌ Error konversi. Coba lagi.", { reply_markup: mainMenuKeyboard });
      }

      userStates.set(chatId, { lastActivity: Date.now() });
      break;
  }
}

// ===== OPTIMIZED ADMIN CV HANDLER =====
async function handleAdminCv(
  bot: TelegramBot,
  chatId: number,
  state: UserState,
  text?: string
): Promise<void> {
  if (!text) return;

  switch (state.step) {
    case 1:
      const adminNumbers = text.split(/\r?\n/)
        .map(n => n.trim())
        .filter(n => n.length > 0)
        .map(n => validateAndFormatPhoneNumber(n))
        .filter(n => n !== null) as string[];

      if (adminNumbers.length === 0) {
        await bot.sendMessage(chatId, "⚠️ Minimal 1 nomor valid");
        return;
      }

      state.adminNumbers = adminNumbers;
      state.step = 2;
      await bot.sendMessage(chatId, `✅ ${adminNumbers.length} nomor admin\n\n📝 Nama admin:`);
      break;

    case 2:
      state.adminName = text;
      state.step = 3;
      await bot.sendMessage(chatId, `✅ Admin: ${text}\n\n📱 Nomor navy (satu per baris):`);
      break;

    case 3:
      const navyNumbers = text.split(/\r?\n/)
        .map(n => n.trim())
        .filter(n => n.length > 0)
        .map(n => validateAndFormatPhoneNumber(n))
        .filter(n => n !== null) as string[];

      if (navyNumbers.length === 0) {
        await bot.sendMessage(chatId, "⚠️ Minimal 1 nomor valid");
        return;
      }

      state.navyNumbers = navyNumbers;
      state.step = 4;
      await bot.sendMessage(chatId, `✅ ${navyNumbers.length} nomor navy\n\n📝 Nama navy:`);
      break;

    case 4:
      state.navyName = text;
      const totalContacts = (state.adminNumbers?.length || 0) + (state.navyNumbers?.length || 0);

      if (totalContacts > MAX_CONTACTS) {
        await bot.sendMessage(chatId, `⚠️ Max ${MAX_CONTACTS} kontak. Anda: ${totalContacts}`);
        return;
      }

      const progressMsg = await bot.sendMessage(chatId, `⏳ Memproses ${totalContacts} kontak...`);

      try {
        const adminVcards = state.adminNumbers!.map((number, idx) =>
          `BEGIN:VCARD\nVERSION:3.0\nFN:${state.adminName} ${idx + 1}\nTEL;TYPE=CELL:${formatPhoneNumber(number)}\nEND:VCARD`
        );

        const navyVcards = state.navyNumbers!.map((number, idx) =>
          `BEGIN:VCARD\nVERSION:3.0\nFN:${state.navyName} ${idx + 1}\nTEL;TYPE=CELL:${formatPhoneNumber(number)}\nEND:VCARD`
        );

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
        }).catch(() => {});

        await bot.deleteMessage(chatId, progressMsg.message_id).catch(() => {});

        await bot.sendMessage(chatId,
          `✅ Selesai!\n\n👥 Admin: ${state.adminName} (${state.adminNumbers?.length})\n⚓ Navy: ${state.navyName} (${state.navyNumbers?.length})\n📁 Total: ${totalContacts}\n\nPilih menu:`,
          { reply_markup: mainMenuKeyboard }
        );

        console.log(`✅ Admin CV: ${chatId} - ${totalContacts} contacts`);
      } catch (err: any) {
        console.error("Admin CV error:", err);
        await bot.sendMessage(chatId, "❌ Error membuat kontak", { reply_markup: mainMenuKeyboard });
      }

      userStates.set(chatId, { lastActivity: Date.now() });
      break;
  }
}

// ===== OPTIMIZED MERGE VCF =====
async function handleMergeVcf(
  bot: TelegramBot,
  chatId: number,
  state: UserState
): Promise<void> {
  if (!state.mergeFiles || state.mergeFiles.length < 2) {
    await bot.sendMessage(chatId, "Minimal 2 file VCF!", { reply_markup: mainMenuKeyboard });
    return;
  }

  const progressMsg = await bot.sendMessage(chatId, `Menggabungkan ${state.mergeFiles.length} file...`);

  try {
    const allContacts = new Map<string, string>();

    for (const fileBuffer of state.mergeFiles) {
      const content = fileBuffer.toString();
      const vcards = content.split('END:VCARD').filter(v => v.trim());

      for (let vcard of vcards) {
        vcard = vcard.trim() + '\nEND:VCARD';
        const telMatch = vcard.match(/TEL[^:]*:([^\r\n]+)/i);

        if (telMatch) {
          const number = telMatch[1].replace(/\D/g, '');
          if (number.length >= 10) {
            const formatted = validateAndFormatPhoneNumber(number);
            if (formatted) allContacts.set(formatted, vcard);
          }
        }
      }
    }

    const combinedContent = Array.from(allContacts.values()).join('\n');
    const fileName = `merged_${Date.now()}_${allContacts.size}_contacts.vcf`;

    if (allContacts.size > 5000) {
      const zip = new AdmZip();
      zip.addFile(fileName, Buffer.from(combinedContent));
      const zipBuffer = zip.toBuffer();

      await bot.sendDocument(chatId, zipBuffer, {}, {
        filename: `${fileName}.zip`,
        contentType: "application/zip"
      });
    } else {
      await bot.sendDocument(chatId, Buffer.from(combinedContent), {}, {
        filename: fileName,
        contentType: "text/vcard"
      });
    }

    await db.insert(conversions).values({
      telegramUserId: chatId,
      conversionType: "MERGE_VCF",
      fileName: fileName,
      numberCount: allContacts.size,
      contactName: null,
      adminName: null,
      navyName: null
    }).catch(() => {});

    await bot.deleteMessage(chatId, progressMsg.message_id).catch(() => {});

    await bot.sendMessage(chatId,
      `Selesai\n\n${state.mergeFiles.length} file digabung\n${allContacts.size} kontak unik\nFile: ${fileName}`,
      { reply_markup: mainMenuKeyboard }
    );

    console.log(`Merge VCF: ${chatId} - ${state.mergeFiles.length} files -> ${allContacts.size} contacts`);
  } catch (err: any) {
    console.error("Merge VCF error:", err);
    await bot.deleteMessage(chatId, progressMsg.message_id).catch(() => {});
    await bot.sendMessage(chatId, "Gagal menggabungkan file VCF.", { reply_markup: mainMenuKeyboard });
  }

  userStates.set(chatId, { lastActivity: Date.now() });
}

// ===== BOT SETUP =====
export function setupBot(): void {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log("❌ Token bot tidak ditemukan!");
    return;
  }

  const bot = new TelegramBot(token, { polling: true, filepath: false });
  console.log("✅ Bot siap!");

  // State cleanup
  setInterval(() => {
    const now = Date.now();
    let cleanedCount = 0;

    userStates.forEach((state, userId) => {
      if (state.lastActivity && now - state.lastActivity > STATE_TTL) {
        if (state.mergeFiles) state.mergeFiles.length = 0;
        if (state.mergeTxtFiles) state.mergeTxtFiles.length = 0;
        userStates.delete(userId);
        cleanedCount++;
      }
    });

    if (cleanedCount > 0) console.log(`🧹 Cleaned ${cleanedCount} inactive users`);
  }, 2 * 60 * 1000);

  const userLastRequest = new Map<number, number>();
  const RATE_LIMIT_MS = 300; // Kurangi dari 800ms ke 300ms untuk file upload

  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text?.trim();
    const userIdStr = chatId.toString();
    const now = Date.now();

    // Rate limiting - TAPI SKIP UNTUK FILE UPLOADS
    const lastRequest = userLastRequest.get(chatId);
    if (lastRequest && now - lastRequest < RATE_LIMIT_MS && !msg.document) {
      return;
    }
    
    // UPDATE LAST REQUEST SETELAH PROSES, BUKAN SEBELUM
    if (!msg.document) {
      userLastRequest.set(chatId, now);
    }

    if (!userStates.has(chatId)) userStates.set(chatId, { lastActivity: now });
    const state = userStates.get(chatId)!;
    state.lastActivity = now;

    // ===== CLEAR DATA =====
    if (text === "Clear Data" || text === "/clear") {
      try {
        const userConversions = await db.select().from(conversions)
          .where(eq(conversions.telegramUserId, chatId)).catch(() => []);
        const deletedCount = userConversions.length;

        if (deletedCount === 0) {
          await bot.sendMessage(chatId,
            `Tidak ada data untuk dihapus.\n\nAnda belum melakukan konversi.`,
            { reply_markup: mainMenuKeyboard }
          );
          return;
        }

        await db.delete(conversions).where(eq(conversions.telegramUserId, chatId)).catch(() => {});
        
        const currentState = userStates.get(chatId) || {};
        userStates.set(chatId, { lastActivity: Date.now() });

        await bot.sendMessage(chatId,
          `Data berhasil dihapus\n\n${deletedCount} riwayat konversi telah dihapus dari database.`,
          { reply_markup: mainMenuKeyboard }
        );

        console.log(`User ${chatId} cleared ${deletedCount} records`);
      } catch (error) {
        console.error("Clear error:", error);
        await bot.sendMessage(chatId, "Error menghapus data", { reply_markup: mainMenuKeyboard });
      }
      return;
    }

    // ===== RESET DATABASE ADMIN =====
    if ((text === "Reset Database" || text === "/reset_db") && userIdStr === ADMIN_ID) {
      userStates.set(chatId, { mode: "ADMIN_RESET_NEON_DB", lastActivity: now });
      await bot.sendMessage(chatId,
        `RESET DATABASE\n\nKetik "RESET_NEON" untuk konfirmasi reset database.`,
        { reply_markup: { remove_keyboard: true } }
      );
      return;
    }

    if (state.mode === "ADMIN_RESET_NEON_DB" && userIdStr === ADMIN_ID) {
      if (text?.toUpperCase() === "RESET_NEON") {
        try {
          await db.delete(conversions);
          userStates.clear();
          userLastRequest.clear();

          await bot.sendMessage(chatId,
            `Database telah direset\n\nSemua data konversi berhasil dihapus.`,
            { reply_markup: adminMenuKeyboard }
          );

          console.log(`ADMIN ${chatId} reset database`);
        } catch (error) {
          console.error("Reset DB error:", error);
          await bot.sendMessage(chatId, "Error reset database", { reply_markup: adminMenuKeyboard });
        }
      } else {
        await bot.sendMessage(chatId, "Reset dibatalkan", { reply_markup: adminMenuKeyboard });
      }
      userStates.set(chatId, { lastActivity: now });
      return;
    }

    // ===== ADMIN PANEL =====
    if (text === "/admin" && userIdStr === ADMIN_ID) {
      await bot.sendMessage(chatId, "ADMIN PANEL", { reply_markup: adminMenuKeyboard });
      return;
    }

    // ===== COMMANDS =====
    if (text === "/start" || text === "Menu Utama") {
      const isAdmin = userIdStr === ADMIN_ID;
      const welcomeMessage = `BOT KONVERSI VCF GRATISSSSSS\n\nFITUR TERSEDIA:\nTXT → VCF - Konversi nomor TXT ke file VCF\nAdmin CV - Buat kontak admin dan navy\nVCF → TXT - Ekstrak nomor dari VCF\nMerge VCF - Gabungkan multiple file VCF\nMerge TXT - Gabungkan multiple file TXT\n\nGRATIS & CEPAT\nHapus duplikat otomatis\n\nDeveloper: ${OWNER_USERNAME}\nWebsite: ${WEBSITE_URL}${isAdmin ? '\n\nMode: ADAutoMIN' : ''}`;

      const photoPath = path.join(process.cwd(), "attached_assets", "IMG_2950_1766914856970.jpeg");
      try {
        if (fs.existsSync(photoPath)) {
          await bot.sendPhoto(chatId, photoPath, {
            caption: welcomeMessage,
            reply_markup: isAdmin ? adminMenuKeyboard : mainMenuKeyboard
          });
        } else {
          await bot.sendMessage(chatId, welcomeMessage, {
            reply_markup: isAdmin ? adminMenuKeyboard : mainMenuKeyboard
          });
        }
      } catch {
        await bot.sendMessage(chatId, welcomeMessage, {
          reply_markup: isAdmin ? adminMenuKeyboard : mainMenuKeyboard
        });
      }
      userStates.set(chatId, { lastActivity: now });
      return;
    }

    if (text === "/help" || text === "Help") {
      await bot.sendMessage(chatId,
        `BANTUAN\n\n` +
        `CARA PENGGUNAAN:\n` +
        `1. Pilih fitur dari menu\n` +
        `2. Upload file atau ikuti instruksi\n` +
        `3. Terima file hasil konversi\n\n` +
        `TXT → VCF\nUpload file TXT berisi nomor (satu per baris), dapatkan file VCF untuk import ke kontak.\n\n` +
        `Admin CV\nBuat file VCF dengan dua grup: Admin dan Navy.\n\n` +
        `VCF → TXT\nEkstrak nomor telepon dari file VCF.\n\n` +
        `Merge VCF\nGabungkan multiple file VCF menjadi satu.\n\n` +
        `Merge TXT\nGabungkan multiple file TXT menjadi satu.\n\n` +
        `BATASAN:\n` +
        `Max ukuran file: 10MB\n` +
        `Max kontak: 50,000\n` +
        `Max file merge: 100\n\n` +
        `Kontak: ${OWNER_USERNAME}`,
        { reply_markup: mainMenuKeyboard }
      );
      return;
    }

    if (text === "/about") {
      await bot.sendMessage(chatId,
        `TENTANG BOT\n\n` +
        `Developer: FETRUS MEILANO ILHAMSYAH\n` +
        `Telegram: ${OWNER_USERNAME}\n` +
        `Website: ${WEBSITE_URL}\n\n` +
        `FITUR:\n` +
        `Konversi cepat TXT ke VCF\n` +
        `Format nomor otomatis\n` +
        `Organisir file rapi\n` +
        `Hapus duplikat otomatis\n` +
        `Support ZIP untuk file besar\n` +
        `Support international numbers\n` +
        `100% gratis\n\n` +
        `Request fitur: ${OWNER_USERNAME}`,
        { reply_markup: mainMenuKeyboard }
      );
      return;
    }

    if (text === "/stats" || text === "Stats") {
      try {
        const userConversions = await db.select().from(conversions)
          .where(eq(conversions.telegramUserId, chatId)).catch(() => []);

        const totalConversions = userConversions.length;
        const txtToVcf = userConversions.filter(c => c.conversionType === "TXT_TO_VCF").length;
        const adminCv = userConversions.filter(c => c.conversionType === "ADMIN_CV").length;
        const vcfToTxt = userConversions.filter(c => c.conversionType === "VCF_TO_TXT").length;
        const mergeVcf = userConversions.filter(c => c.conversionType === "MERGE_VCF").length;
        const mergeTxt = userConversions.filter(c => c.conversionType === "MERGE_TXT").length;
        const totalNumbers = userConversions.reduce((sum, c) => sum + (c.numberCount || 0), 0);

        await bot.sendMessage(chatId,
          `STATISTIK ANDA\n\n` +
          `Total konversi: ${totalConversions}\n` +
          `TXT → VCF: ${txtToVcf}\n` +
          `Admin CV: ${adminCv}\n` +
          `VCF → TXT: ${vcfToTxt}\n` +
          `Merge VCF: ${mergeVcf}\n` +
          `Merge TXT: ${mergeTxt}\n` +
          `Total kontak: ${totalNumbers}`,
          { reply_markup: mainMenuKeyboard }
        );
      } catch {
        await bot.sendMessage(chatId, "Tidak ada data statistik", { reply_markup: mainMenuKeyboard });
      }
      return;
    }

    if (text === "/cancel" || text === "Cancel") {
      if (state && state.mode) {
        userStates.set(chatId, { lastActivity: Date.now() });
        await bot.sendMessage(chatId, "Operasi dibatalkan", { reply_markup: mainMenuKeyboard });
      }
      return;
    }

    // ===== MENU BUTTONS =====
    if (text === "/txt2vcf" || text === "TXT → VCF") {
      userStates.set(chatId, { mode: "TXT_TO_VCF", step: 0, lastActivity: now });
      await bot.sendMessage(chatId,
        "TXT TO VCF\n\nKirim file TXT berisi nomor telepon.\n\nFormat: satu nomor per baris\nContoh:\n08123456789\n08198765432\n\nMaksimal 50,000 nomor"
      );
      return;
    }

    if (text === "/admincv" || text === "Admin CV") {
      userStates.set(chatId, { mode: "ADMIN_CV", step: 1, lastActivity: now });
      await bot.sendMessage(chatId, "ADMIN CV\n\nMasukkan nomor admin (satu per baris):");
      return;
    }

    if (text === "/vcf2txt" || text === "VCF → TXT") {
      userStates.set(chatId, { mode: "VCF_TO_TXT", lastActivity: now });
      await bot.sendMessage(chatId,
        "VCF TO TXT\n\nKirim file VCF untuk ekstrak nomor telepon.\n\nFormat nomor otomatis\nDuplikat otomatis dihapus"
      );
      return;
    }

    if (text === "/merge" || text === "Merge VCF") {
      userStates.set(chatId, {
        mode: "MERGE_VCF",
        step: 1,
        mergeFiles: [],
        mergeFileNames: [],
        mergeFileIds: [],
        lastActivity: now
      });
      await bot.sendMessage(chatId,
        "MERGE VCF\n\nKirim file VCF yang ingin digabungkan.\n\nMinimal: 2 file\nMaksimal: 100 file\nDuplikat otomatis dihapus\n\nKetik /done setelah semua file terkirim"
      );
      return;
    }

    if (text === "/mergetxt" || text === "Merge TXT") {
      userStates.set(chatId, {
        mode: "MERGE_TXT",
        step: 1,
        mergeTxtFiles: [],
        mergeTxtFileIds: [],
        lastActivity: now
      });
      await bot.sendMessage(chatId,
        "MERGE TXT\n\nKirim file TXT yang ingin digabungkan.\n\nMinimal: 2 file\nMaksimal: 100 file\nFormat nomor otomatis\nDuplikat otomatis dihapus\n\nKetik /done setelah semua file terkirim"
      );
      return;
    }

    // ===== ADMIN STATS =====
    if (userIdStr === ADMIN_ID && (text === "Admin Stats" || text === "/admin_stats")) {
      try {
        const allConversions = await db.select().from(conversions).catch(() => []);
        const userSet = new Set<number>();
        let totalContacts = 0;

        allConversions.forEach(c => {
          userSet.add(c.telegramUserId);
          totalContacts += c.numberCount || 0;
        });

        const today = new Date().toISOString().split('T')[0];
        const todayConversions = allConversions.filter(c =>
          c.createdAt && new Date(c.createdAt).toISOString().split('T')[0] === today
        );

        await bot.sendMessage(chatId,
          `ADMIN STATISTICS\n\n` +
          `Total users: ${userSet.size}\n` +
          `Total conversions: ${allConversions.length}\n` +
          `Total contacts: ${totalContacts}\n` +
          `Today: ${todayConversions.length}\n` +
          `Active sessions: ${userStates.size}\n` +
          `Database records: ${allConversions.length}`,
          { reply_markup: adminMenuKeyboard }
        );
      } catch (error) {
        console.error("Admin stats error:", error);
        await bot.sendMessage(chatId, "Error loading statistics", { reply_markup: adminMenuKeyboard });
      }
      return;
    }

    // ===== FILE HANDLING =====
    if (msg.document) {
      const fileName = msg.document.file_name?.toLowerCase() || "";

      if (msg.document.file_size && msg.document.file_size > MAX_FILE_SIZE) {
        await bot.sendMessage(chatId,
          `⚠️ File terlalu besar (${(msg.document.file_size / 1024 / 1024).toFixed(1)}MB)\n` +
          `Max ${MAX_FILE_SIZE / 1024 / 1024}MB`,
          { reply_markup: mainMenuKeyboard }
        );
        return;
      }

      // MERGE TXT FILES
      if (state.mode === "MERGE_TXT" && fileName.endsWith(".txt")) {
        try {
          if ((state.mergeTxtFiles?.length || 0) >= MAX_MERGE_FILES) {
            await bot.sendMessage(chatId, `Maksimal ${MAX_MERGE_FILES} file. Ketik /done untuk merge.`, { reply_markup: mainMenuKeyboard });
            return;
          }

          const fileLink = await bot.getFileLink(msg.document.file_id);
          const response = await fetch(fileLink);
          const buffer = await response.arrayBuffer();

          if (!state.mergeTxtFiles) state.mergeTxtFiles = [];
          if (!state.mergeTxtFileIds) state.mergeTxtFileIds = [];
          
          const fileId = msg.document.file_id;
          if (state.mergeTxtFileIds.includes(fileId)) {
            console.log(`Duplicate TXT file_id: ${fileId} from user ${chatId}`);
            return;
          }

          state.mergeTxtFileIds.push(fileId);
          state.mergeTxtFiles.push(Buffer.from(buffer));
          state.lastActivity = now;
          userStates.set(chatId, state);

          const fileCount = state.mergeTxtFiles.length;
          
          if (fileCount === 1 || fileCount % 5 === 0 || fileCount >= MAX_MERGE_FILES) {
            await bot.sendMessage(chatId,
              `${fileCount} file TXT diterima\n\n` +
              `${fileCount >= 2 ? 'Siap merge. ' : ''}` +
              `${fileCount >= MAX_MERGE_FILES ? 'Maksimal tercapai. ' : ''}` +
              `${fileCount >= 2 ? 'Ketik /done' : 'Kirim file lagi'}`
            );
          }

          console.log(`Merge TXT [${fileCount}]: User ${chatId} - "${fileName}" (${msg.document.file_size} bytes)`);
        } catch (error: any) {
          console.error("Merge TXT error:", error);
          await bot.sendMessage(chatId, `Error file: ${fileName}`);
        }
        return;
      }

      // MERGE VCF FILES
      if (state.mode === "MERGE_VCF" && fileName.endsWith(".vcf")) {
        try {
          if ((state.mergeFiles?.length || 0) >= MAX_MERGE_FILES) {
            await bot.sendMessage(chatId, `⚠️ Max ${MAX_MERGE_FILES} file\nKetik /done`, { reply_markup: mainMenuKeyboard });
            return;
          }

          const fileLink = await bot.getFileLink(msg.document.file_id);
          const response = await fetch(fileLink);
          const buffer = await response.arrayBuffer();

          if (!state.mergeFiles) state.mergeFiles = [];
          if (!state.mergeFileNames) state.mergeFileNames = [];

          // CHECK DUPLICATE BERDASARKAN FILE_ID, bukan buffer (lebih cepat)
          const fileId = msg.document.file_id;
          if (!state.mergeFileIds) state.mergeFileIds = [];
          
          if (state.mergeFileIds.includes(fileId)) {
            console.log(`⚠️ Duplicate file_id detected: ${fileId} for user ${chatId}`);
            return; // Skip tanpa notif, biar gak spam
          }

          state.mergeFileIds.push(fileId);
          state.mergeFiles.push(Buffer.from(buffer));
          state.mergeFileNames.push(fileName);
          state.lastActivity = now;
          userStates.set(chatId, state);

          const fileCount = state.mergeFiles.length;
          
          // HANYA KASIH NOTIF SETIAP 5 FILE atau file pertama/terakhir
          if (fileCount === 1 || fileCount % 5 === 0 || fileCount >= MAX_MERGE_FILES) {
            await bot.sendMessage(chatId,
              `✅ ${fileCount} file VCF diterima\n\n` +
              `${fileCount >= 2 ? '📊 Siap merge! ' : ''}` +
              `${fileCount >= MAX_MERGE_FILES ? '⚠️ Max tercapai! ' : ''}` +
              `${fileCount >= 2 ? 'Ketik /done' : 'Kirim file lagi'}`
            );
          }

          console.log(`📥 Merge VCF [${fileCount}]: User ${chatId} - "${fileName}" (${msg.document.file_size} bytes)`);
        } catch (error: any) {
          console.error("Merge VCF error:", error);
          await bot.sendMessage(chatId, `❌ Error file: ${fileName}`);
        }
        return;
      }

      // TXT FILE
      if (fileName.endsWith(".txt")) {
        try {
          const fileLink = await bot.getFileLink(msg.document.file_id);
          const response = await fetch(fileLink);
          const content = await response.text();
          const lines = content.split(/\r?\n/);

          if (lines.length > MAX_CONTACTS) {
            await bot.sendMessage(chatId,
              `File terlalu besar: ${lines.length} nomor\nMaksimal ${MAX_CONTACTS} nomor`,
              { reply_markup: mainMenuKeyboard }
            );
            return;
          }

          const numbers = lines
            .map(l => l.trim())
            .filter(l => l.length > 0)
            .map(n => validateAndFormatPhoneNumber(n))
            .filter(n => n !== null) as string[];

          if (numbers.length === 0) {
            await bot.sendMessage(chatId, "Tidak ada nomor valid dalam file");
            return;
          }

          userStates.set(chatId, {
            mode: "TXT_TO_VCF",
            step: 1,
            fileNumbers: numbers,
            numberCount: numbers.length,
            lastActivity: now
          });

          await bot.sendMessage(chatId, 
            `File "${fileName}" diterima\n\n` +
            `${numbers.length} nomor valid terdeteksi\n\n` +
            `Masukkan nama kontak:`
          );

          console.log(`TXT Upload: User ${chatId} - ${numbers.length} numbers from ${fileName}`);
        } catch (error: any) {
          console.error("TXT file error:", error);
          await bot.sendMessage(chatId, "Error memproses file TXT");
        }
        return;
      }

      // VCF FILE
      if (fileName.endsWith(".vcf")) {
        try {
          const fileLink = await bot.getFileLink(msg.document.file_id);
          const response = await fetch(fileLink);
          const vcfContent = await response.text();
          const numbers = extractNumbersFromVcf(vcfContent);

          if (numbers.length === 0) {
            await bot.sendMessage(chatId, "Tidak ada nomor valid dalam VCF");
            return;
          }

          const txtContent = numbers.join('\n');

          await bot.sendDocument(chatId, Buffer.from(txtContent), {}, {
            filename: `extracted_${Date.now()}_${numbers.length}.txt`,
            contentType: "text/plain"
          });

          await db.insert(conversions).values({
            telegramUserId: chatId,
            conversionType: "VCF_TO_TXT",
            fileName: fileName,
            numberCount: numbers.length,
            contactName: null,
            adminName: null,
            navyName: null
          }).catch(() => {});

          await bot.sendMessage(chatId,
            `Ekstraksi selesai\n\n` +
            `File: "${fileName}"\n` +
            `${numbers.length} nomor diekstrak\n` +
            `Format nomor otomatis\n` +
            `Duplikat dihapus`,
            { reply_markup: mainMenuKeyboard }
          );

          console.log(`VCF to TXT: User ${chatId} - ${numbers.length} numbers from ${fileName}`);
          userStates.set(chatId, { lastActivity: Date.now() });
        } catch (error: any) {
          console.error("VCF error:", error);
          await bot.sendMessage(chatId, "Error memproses VCF");
        }
      }
      return;
    }

    // ===== MODE HANDLERS =====
    if (state.mode === "TXT_TO_VCF") {
      await handleTxtToVcf(bot, chatId, state, text);
      return;
    } else if (state.mode === "ADMIN_CV") {
      await handleAdminCv(bot, chatId, state, text);
      return;
    } else if (state.mode === "MERGE_VCF" && text === "/done") {
      await handleMergeVcf(bot, chatId, state);
      return;
    } else if (state.mode === "MERGE_TXT" && text === "/done") {
      await handleMergeTxt(bot, chatId, state);
      return;
    }

    // Default
    await bot.sendMessage(chatId,
      `BOT KONVERSI VCF\n\nGunakan menu atau ketik /start`,
      { reply_markup: mainMenuKeyboard }
    );
  });

  bot.on("callback_query", async (query) => {
    const chatId = query.message?.chat.id;
    if (!chatId) return;

    const now = Date.now();
    if (!userStates.has(chatId)) userStates.set(chatId, { lastActivity: now });
    const state = userStates.get(chatId)!;
    state.lastActivity = now;

    try {
      await bot.answerCallbackQuery(query.id);

      if (query.data === "btn_txt_to_vcf") {
        userStates.set(chatId, { mode: "TXT_TO_VCF", step: 0, lastActivity: now });
        await bot.sendMessage(chatId, "📤 Kirim file .txt", { reply_markup: mainMenuKeyboard });
      } else if (query.data === "btn_admin") {
        userStates.set(chatId, { mode: "ADMIN_CV", step: 1, lastActivity: now });
        await bot.sendMessage(chatId, "Masukkan nomor admin:", { reply_markup: mainMenuKeyboard });
      } else if (query.data === "btn_vcf_to_txt") {
        userStates.set(chatId, { mode: "VCF_TO_TXT", lastActivity: now });
        await bot.sendMessage(chatId, "Kirim file .vcf", { reply_markup: mainMenuKeyboard });
      } else if (query.data === "btn_merge") {
        userStates.set(chatId, {
          mode: "MERGE_VCF",
          step: 1,
          mergeFiles: [],
          mergeFileNames: [],
          lastActivity: now
        });
        await bot.sendMessage(chatId, "🔗 Kirim file VCF (min 2)\n\nKetik /done", { reply_markup: mainMenuKeyboard });
      } else if (query.data === "btn_merge_txt") {
        userStates.set(chatId, {
          mode: "MERGE_TXT",
          step: 1,
          mergeTxtFiles: [],
          lastActivity: now
        });
        await bot.sendMessage(chatId, "📋 Kirim file TXT (min 2)\n\nKetik /done", { reply_markup: mainMenuKeyboard });
      } else if (query.data === "btn_back") {
        userStates.set(chatId, { lastActivity: now });
        await bot.sendMessage(chatId, "📋 Menu Utama\n\nPilih fitur:", { reply_markup: mainMenuKeyboard });
      }
    } catch (error: any) {
      console.error("Callback error:", error);
    }
  });

  bot.on("polling_error", (error: Error) => {
    console.error("❌ Polling Error:", error.message);
  });

  console.log("==================================");
  console.log("BOT VCF CONVERTER");
  console.log("==================================");
  console.log("Owner: FETRUS MEILANO ILHAMSYAH");
  console.log(`Telegram: ${OWNER_USERNAME}`);
  console.log(`Owner ID: ${OWNER_ID}`);
  console.log(`Website: ${WEBSITE_URL}`);
  console.log(`Admin ID: ${ADMIN_ID}`);
  console.log(`Max Size: ${MAX_FILE_SIZE / 1024 / 1024}MB`);
  console.log(`Max Contacts: ${MAX_CONTACTS}`);
  console.log(`Started: ${new Date().toLocaleTimeString()}`);
  console.log("==================================");
}
