import TelegramBot from "node-telegram-bot-api";
import fs from "fs";
import path from "path";
import { db } from "./db";
import { conversions } from "@shared/schema";
import { eq } from "drizzle-orm";
import AdmZip from "adm-zip";

interface UserState {
  mode?: 
    | "TXT_TO_VCF" 
    | "ADMIN_CV" 
    | "VCF_TO_TXT" 
    | "MERGE_VCF"
    | "USER_CLEAR_CV"
    | "ADMIN_RESET_NEON_DB"
    | undefined;
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
console.log("==================================");

const mainMenuKeyboard = {
  keyboard: [
    [{ text: "📄 TXT → VCF" }, { text: "👥 Admin CV" }],
    [{ text: "🔄 VCF → TXT" }, { text: "🔗 Merge VCF" }],
    [{ text: "📋 Menu Utama" }, { text: "ℹ️ Help" }, { text: "📊 Stats" }],
    [{ text: "❌ Cancel" }, { text: "👮 Clear Hasil cv" }, { text: "👮 Reset database khusus ADMIN FEE" }],
  ],  
  resize_keyboard: true,
  persistent: true
};

const adminMenuKeyboard = {
  keyboard: [
    [{ text: "📄 TXT → VCF" }, { text: "👥 Admin CV" }],
    [{ text: "🔄 VCF → TXT" }, { text: "🔗 Merge VCF" }], 
    [{ text: "📋 Menu Utama" }, { text: "ℹ️ Help" }, { text: "📊 Stats" }],
    [{ text: "❌ Cancel" }, { text: "👮 Reset database khusus ADMIN FEE" }], 
  ],
  resize_keyboard: true,
  persistent: true
};

// ===== FUNGSI UTILITAS =====
function validateAndFormatPhoneNumber(number: string): string | null {
  if (!number) return null;
  const cleaned = number.replace(/\D/g, '');
  if (cleaned.length < 10 || cleaned.length > 15) return null;
  if (cleaned.startsWith('0')) return '+62' + cleaned.substring(1);
  else if (cleaned.startsWith('62')) return '+' + cleaned;
  else if (cleaned.startsWith('8')) return '+62' + cleaned;
  return '+' + cleaned;
}

function formatPhoneNumber(number: string): string {
  const formatted = validateAndFormatPhoneNumber(number);
  return formatted || number;
}

function extractNumbersFromVcf(vcfContent: string): string[] {
  const numbers: string[] = [];
  const seenNumbers: { [key: string]: boolean } = {};
  const lines = vcfContent.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('TEL;') || trimmed.startsWith('TEL:')) {
      const telLine = trimmed.includes(':') ? trimmed.split(':')[1] : trimmed;
      const numberMatch = telLine.match(/\d+/g);
      if (numberMatch) {
        const number = numberMatch.join('');
        if (number.length >= 10) {
          const formatted = validateAndFormatPhoneNumber(number);
          if (formatted && !seenNumbers[formatted]) {
            seenNumbers[formatted] = true;
            numbers.push(formatted);
          }
        }
      }
    }
  }
  return numbers;
}

function createProgressBar(current: number, total: number, width = 20): string {
  const percentage = current / total;
  const filled = Math.round(width * percentage);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${Math.round(percentage * 100)}%`;
}

async function sendAsZip(
  bot: TelegramBot,
  chatId: number,
  numbers: string[],
  contactName: string,
  fileName: string,
  splitLimit: number
): Promise<void> {
  const chunks: string[][] = [];
  for (let i = 0; i < numbers.length; i += splitLimit) chunks.push(numbers.slice(i, i + splitLimit));
  const zip = new AdmZip();
  const progressMsg = await bot.sendMessage(chatId, `⏳ Membuat ZIP ${chunks.length} file...`);
  chunks.forEach((chunk, index) => {
    const fileNum = index + 1;
    const filePartName = `${fileName}${String(fileNum).padStart(3, '0')}.vcf`;
    const vcardContent = chunk.map((number, idx) => {
      const globalIndex = index * splitLimit + idx + 1;
      return `BEGIN:VCARD\nVERSION:3.0\nFN:${contactName} ${globalIndex}\nTEL;TYPE=CELL:${formatPhoneNumber(number)}\nEND:VCARD`;
    }).join("\n");
    zip.addFile(filePartName, Buffer.from(vcardContent));
  });
  const zipBuffer = zip.toBuffer();
  await bot.sendDocument(chatId, zipBuffer, {}, {
    filename: `${fileName}_${numbers.length}_contacts.zip`,
    contentType: "application/zip"
  });
  await bot.deleteMessage(chatId, progressMsg.message_id).catch(() => {});
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
  if (numbers.length > 5000) {
    await sendAsZip(bot, chatId, numbers, contactName, fileName, splitLimit);
    await bot.deleteMessage(chatId, progressMsgId).catch(() => {});
    return;
  }
  const chunks: string[][] = [];
  for (let i = 0; i < numbers.length; i += splitLimit) chunks.push(numbers.slice(i, i + splitLimit));
  const totalFiles = chunks.length;
  const BATCH_SIZE = 15;
  const DELAY_MS = 25;
  let sentCount = 0;
  for (let batchStart = 0; batchStart < chunks.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, chunks.length);
    const batchPromises = [];
    for (let i = batchStart; i < batchEnd; i++) {
      const chunk = chunks[i];
      const fileNum = fileStartNumber + i;
      const filePartName = `${fileName}${String(fileNum).padStart(3, '0')}.vcf`;
      const vcardContent = chunk.map((number, idx) => {
        const globalIndex = i * splitLimit + idx + 1;
        return `BEGIN:VCARD\nVERSION:3.0\nFN:${contactName} ${globalIndex}\nTEL;TYPE=CELL:${formatPhoneNumber(number)}\nEND:VCARD`;
      }).join("\n");
      batchPromises.push(bot.sendDocument(chatId, Buffer.from(vcardContent), {}, {
        filename: filePartName,
        contentType: "text/vcard"
      }).catch(() => null));
    }
    await Promise.all(batchPromises);
    sentCount += batchEnd - batchStart;
    if (sentCount % 30 === 0 || sentCount === totalFiles) {
      await bot.editMessageText(`⏳ ${sentCount}/${totalFiles} file\n${createProgressBar(sentCount, totalFiles)}`, { chat_id: chatId, message_id: progressMsgId }).catch(() => {});
    }
    if (batchEnd < chunks.length) await new Promise(resolve => setTimeout(resolve, DELAY_MS));
  }
  console.log(`📤 ${totalFiles} file dikirim ke ${chatId}`);
  await bot.deleteMessage(chatId, progressMsgId).catch(() => {});
}

// ===== HANDLER MODE =====
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
      await bot.sendMessage(chatId, `✅ Nama file: ${text}\n\n🔢 Masukkan nomor awal file (contoh: 1):`);
      break;
    case 3:
      const startNum = parseInt(text);
      if (isNaN(startNum) || startNum < 0) {
        await bot.sendMessage(chatId, "⚠️ Masukkan angka valid");
        return;
      }
      state.fileStartNumber = startNum;
      state.step = 4;
      await bot.sendMessage(chatId, `✅ Nomor awal: ${startNum}\n\n📊 Masukkan jumlah kontak per file (atau "all"):`);
      break;
    case 4:
      const limit = text.toLowerCase() === "all" ? state.numberCount || 999999 : parseInt(text);
      if (isNaN(limit) || limit < 1) {
        await bot.sendMessage(chatId, "⚠️ Masukkan angka valid atau 'all'");
        return;
      }
      state.splitLimit = limit;
      const fileCount = limit === state.numberCount ? 1 : Math.ceil(state.numberCount! / limit);
      const progressMsg = await bot.sendMessage(chatId, `⏳ Memproses ${state.numberCount} nomor...`);
      try {
        await generateAndSendVcf(bot, chatId, state.fileNumbers!, state.contactName!, state.fileName!, state.fileStartNumber!, state.splitLimit!, progressMsg.message_id);
        await db.insert(conversions).values({
          telegramUserId: chatId,
          conversionType: "TXT_TO_VCF",
          fileName: state.fileName || null,
          contactName: state.contactName || null,
          adminName: null,
          navyName: null,
          numberCount: state.numberCount || null
        }).catch(() => {});
        console.log(`✅ ${state.numberCount} nomor dikonversi oleh ${chatId}`);
        await bot.sendMessage(chatId, `✅ Selesai!\n\n📊 ${state.numberCount} nomor menjadi ${fileCount} file\n📁 Nama: ${state.contactName}\n📝 File: ${state.fileName}\n\nPilih menu di bawah untuk lanjut:`, { reply_markup: mainMenuKeyboard });
      } catch (err: any) {
        console.error("Conversion error:", err);
        try { if (OWNER_ID && chatId.toString() !== OWNER_ID) await bot.sendMessage(OWNER_ID, `🚨 Error dari ${chatId}: ${err.message?.substring(0, 100)}`); } catch {}
        await bot.sendMessage(chatId, "❌ Error saat konversi. Silakan coba lagi atau hubungi developer.", { reply_markup: mainMenuKeyboard });
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
      const adminNumbers = text.split(/\r?\n/)
        .map(n => n.trim())
        .filter(n => n.length > 0)
        .map(n => validateAndFormatPhoneNumber(n))
        .filter(n => n !== null) as string[];
      if (adminNumbers.length === 0) {
        await bot.sendMessage(chatId, "⚠️ Masukkan minimal 1 nomor valid");
        return;
      }
      state.adminNumbers = adminNumbers;
      state.step = 2;
      await bot.sendMessage(chatId, `✅ ${adminNumbers.length} nomor admin\n\n📝 Masukkan nama admin:`);
      break;
    case 2:
      state.adminName = text;
      state.step = 3;
      await bot.sendMessage(chatId, `✅ Admin: ${text}\n\n📱 Masukkan nomor navy (satu per baris):`);
      break;
    case 3:
      const navyNumbers = text.split(/\r?\n/)
        .map(n => n.trim())
        .filter(n => n.length > 0)
        .map(n => validateAndFormatPhoneNumber(n))
        .filter(n => n !== null) as string[];
      if (navyNumbers.length === 0) {
        await bot.sendMessage(chatId, "⚠️ Masukkan minimal 1 nomor valid");
        return;
      }
      state.navyNumbers = navyNumbers;
      state.step = 4;
      await bot.sendMessage(chatId, `✅ ${navyNumbers.length} nomor navy\n\n📝 Masukkan nama navy:`);
      break;
    case 4:
      state.navyName = text;
      const totalContacts = (state.adminNumbers?.length || 0) + (state.navyNumbers?.length || 0);
      if (totalContacts > MAX_CONTACTS) {
        await bot.sendMessage(chatId, `⚠️ Maksimal ${MAX_CONTACTS} kontak. Anda memasukkan ${totalContacts}`);
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
        console.log(`✅ Admin CV: ${chatId} - ${totalContacts} kontak`);
        await bot.deleteMessage(chatId, progressMsg.message_id).catch(() => {});
        await bot.sendMessage(chatId, `✅ Selesai!\n\n👥 Admin: ${state.adminName} (${state.adminNumbers?.length})\n⚓ Navy: ${state.navyName} (${state.navyNumbers?.length})\n📁 Total: ${totalContacts} kontak\n\nPilih menu di bawah untuk lanjut:`, { reply_markup: mainMenuKeyboard });
      } catch (err: any) {
        console.error("Admin CV error:", err);
        await bot.sendMessage(chatId, "❌ Error membuat kontak", { reply_markup: mainMenuKeyboard });
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
    await bot.sendMessage(chatId, "⚠️ Minimal 2 file VCF diperlukan!\n\nKirim minimal 2 file VCF terlebih dahulu.", { reply_markup: mainMenuKeyboard });
    return;
  }
  const progressMsg = await bot.sendMessage(chatId, `⏳ Menggabungkan ${state.mergeFiles.length} file...`);
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
            const formattedNumber = validateAndFormatPhoneNumber(number);
            if (formattedNumber) allContacts.set(formattedNumber, vcard);
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
      await bot.sendDocument(chatId, zipBuffer, {}, { filename: `${fileName}.zip`, contentType: "application/zip" });
    } else {
      await bot.sendDocument(chatId, Buffer.from(combinedContent), {}, { filename: fileName, contentType: "text/vcard" });
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
    await bot.sendMessage(chatId, `✅ Selesai!\n\n🔗 ${state.mergeFiles.length} file VCF digabung\n👥 ${allContacts.size} kontak unik\n📁 File: ${fileName}\n\nPilih menu di bawah untuk lanjut:`, { reply_markup: mainMenuKeyboard });
    console.log(`✅ Merge: ${chatId} - ${state.mergeFiles.length} files -> ${allContacts.size} contacts`);
  } catch (err: any) {
    console.error("Merge error:", err);
    await bot.sendMessage(chatId, "❌ Gagal menggabungkan file VCF.", { reply_markup: mainMenuKeyboard });
  }
  userStates.set(chatId, { lastActivity: Date.now() });
}

// ===== SETUP BOT =====
export function setupBot(): void {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log("❌ Token bot tidak ditemukan!");
    return;
  }
  const bot = new TelegramBot(token, { polling: true, filepath: false });
  console.log("✅ Bot siap digunakan!");
  console.log("👑 Dibuat oleh: FETRUS MEILANO ILHAMSYAH");

  setInterval(() => {
    const now = Date.now();
    let cleanedCount = 0;
    userStates.forEach((state, userId) => {
      if (state.lastActivity && now - state.lastActivity > STATE_TTL) {
        if (state.mergeFiles) state.mergeFiles.length = 0;
        userStates.delete(userId);
        cleanedCount++;
      }
    });
    if (cleanedCount > 0) console.log(`🧹 Cleaned ${cleanedCount} inactive users`);
  }, 2 * 60 * 1000);

  const userLastRequest = new Map<number, number>();
  const RATE_LIMIT_MS = 800;

  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text?.trim();
    const userIdStr = chatId.toString();
    const now = Date.now();

    // DEBUG LOG
    console.log(`📨 Message from ${chatId}: "${text}"`);

    // Rate limiting
    const currentState = userStates.get(chatId) || { lastActivity: now };
    const lastRequest = userLastRequest.get(chatId);
    if (lastRequest && now - lastRequest < RATE_LIMIT_MS && !msg.document) return;
    userLastRequest.set(chatId, now);
    if (!userStates.has(chatId)) userStates.set(chatId, { lastActivity: now });
    const state = userStates.get(chatId)!;
    state.lastActivity = now;

    // ===== TOMBOL ADMIN BARU (PASTIKAN DI ATAS!) =====
    if (text === "👮 Clear Hasil cv") {
      console.log(`✅ Tombol "👮 Clear Hasil cv" diklik oleh ${chatId}`);
      userStates.set(chatId, { mode: "USER_CLEAR_CV", lastActivity: now });
      await bot.sendMessage(chatId, `🗑️ HAPUS DATA ANDA\n\nID Anda: ${chatId}\nKetik "HAPUS" untuk konfirmasi:`, { reply_markup: { remove_keyboard: true } });
      return;
    }

    if (text === "👮 Reset database khusus ADMIN FEE") {
      console.log(`✅ Tombol "👮 Reset database khusus ADMIN FEE" diklik oleh ${chatId}`);
      if (userIdStr !== ADMIN_ID) {
        await bot.sendMessage(chatId, "❌ Akses ditolak. Hanya admin.");
        return;
      }
      userStates.set(chatId, { mode: "ADMIN_RESET_NEON_DB", lastActivity: now });
      await bot.sendMessage(chatId, `💀 RESET DATABASE NEON\n\nKetik "RESET_NEON" untuk konfirmasi:`, { reply_markup: { remove_keyboard: true } });
      return;
    }

    // ===== HANDLER MODE BARU =====
    if (state.mode === "USER_CLEAR_CV") {
      if (text?.toUpperCase() === "HAPUS") {
        try {
          const userConversions = await db.select().from(conversions).where(eq(conversions.telegramUserId, chatId)).catch(() => []);
          const deletedCount = userConversions.length;
          await db.delete(conversions).where(eq(conversions.telegramUserId, chatId)).catch(() => {});
          userStates.delete(chatId);
          userLastRequest.delete(chatId);
          await bot.sendMessage(chatId, `✅ Data Anda dihapus! ${deletedCount} konversi dihapus.`, { reply_markup: mainMenuKeyboard });
          console.log(`🗑️ User ${chatId} cleared data: ${deletedCount} records`);
        } catch (error) {
          console.error("User clear error:", error);
          await bot.sendMessage(chatId, "❌ Error menghapus data", { reply_markup: mainMenuKeyboard });
        }
      } else {
        await bot.sendMessage(chatId, "❌ Dibatalkan", { reply_markup: mainMenuKeyboard });
      }
      userStates.set(chatId, { lastActivity: now });
      return;
    }

    if (state.mode === "ADMIN_RESET_NEON_DB" && userIdStr === ADMIN_ID) {
      if (text?.toUpperCase() === "RESET_NEON") {
        try {
          await db.delete(conversions);
          userStates.clear();
          userLastRequest.clear();
          await bot.sendMessage(chatId, `💀 DATABASE NEON DI-RESET! Semua data dihapus.`, { reply_markup: adminMenuKeyboard });
          console.log(`💀 ADMIN ${chatId} reset Neon database`);
          if (OWNER_ID && chatId.toString() !== OWNER_ID) await bot.sendMessage(OWNER_ID, `🚨 ADMIN ${chatId} mereset database Neon!`);
        } catch (error) {
          console.error("Reset Neon DB error:", error);
          await bot.sendMessage(chatId, "❌ Error resetting Neon database", { reply_markup: adminMenuKeyboard });
        }
      } else {
        await bot.sendMessage(chatId, "❌ Dibatalkan", { reply_markup: adminMenuKeyboard });
      }
      userStates.set(chatId, { lastActivity: now });
      return;
    }

    // ===== ADMIN PANEL =====
    if (text === "/admin" && userIdStr === ADMIN_ID) {
      await bot.sendMessage(chatId, "👑 ADMIN PANEL\n\nSelamat datang, Admin!", { reply_markup: adminMenuKeyboard });
      return;
    }

    // ===== ADMIN COMMANDS =====
    if (userIdStr === ADMIN_ID) {
      if (text === "📊 Admin Stats" || text === "/admin_stats") {
        try {
          const allConversions = await db.select().from(conversions).catch(() => []);
          const userSet = new Set<number>();
          let totalContacts = 0;
          allConversions.forEach(c => { userSet.add(c.telegramUserId); totalContacts += c.numberCount || 0; });
          const today = new Date().toISOString().split('T')[0];
          const todayConversions = allConversions.filter(c => c.createdAt && new Date(c.createdAt).toISOString().split('T')[0] === today);
          const statsText = `📊 ADMIN STATISTICS\n\n👥 Total Users: ${userSet.size}\n🔄 Total Conversions: ${allConversions.length}\n📱 Total Contacts: ${totalContacts}\n📅 Today: ${todayConversions.length} conversions\n💾 Active Sessions: ${userStates.size}\n🗂️ Database: ${allConversions.length} records`;
          await bot.sendMessage(chatId, statsText, { reply_markup: adminMenuKeyboard });
        } catch (error) {
          console.error("Admin stats error:", error);
          await bot.sendMessage(chatId, "❌ Error loading statistics", { reply_markup: adminMenuKeyboard });
        }
        return;
      }
      if (text === "📋 User List" || text === "/admin_users") {
        try {
          const allConversions = await db.select().from(conversions).catch(() => []);
          const userMap = new Map<number, { count: number, contacts: number }>();
          allConversions.forEach(c => {
            const userData = userMap.get(c.telegramUserId) || { count: 0, contacts: 0 };
            userData.count++; userData.contacts += c.numberCount || 0;
            userMap.set(c.telegramUserId, userData);
          });
          const topUsers = Array.from(userMap.entries()).sort((a, b) => b[1].count - a[1].count).slice(0, 10).map(([id, data], index) => `${index + 1}. User ${id}: ${data.count} conv, ${data.contacts} contacts`).join('\n');
          await bot.sendMessage(chatId, `📋 TOP 10 ACTIVE USERS\n\n${topUsers}\n\nTotal unique users: ${userMap.size}`, { reply_markup: adminMenuKeyboard });
        } catch (error) {
          console.error("User list error:", error);
          await bot.sendMessage(chatId, "❌ Error loading user list", { reply_markup: adminMenuKeyboard });
        }
        return;
      }
    }

    // ===== HANDLE TEXT COMMANDS =====
    if (text === "/start" || text === "📋 Menu Utama") {
      const isAdmin = userIdStr === ADMIN_ID;
      const adminNote = isAdmin ? '\n👑 Anda login sebagai ADMIN\nKetik /admin untuk panel admin\n' : '';
      const welcomeMessage = `🤖 BOT KONVERSI VCF\n\nFITUR CEPAT:\n👥 Admin CV - Buat kontak admin\n🔄 VCF → TXT - Ekstrak nomor\n🔗 Merge VCF - Gabung file VCF\n📄 HITUNG OTOMATIS NOMOR TXT Kelebihan:\n\n• GRATIS\n\n👑 Developer: ${OWNER_USERNAME}\n🌐 ${WEBSITE_URL}${adminNote}\n\nGunakan tombol menu di bawah! ⬇️`;
      const photoPath = path.join(process.cwd(), "attached_assets", "IMG_2950_1766914856970.jpeg");
      try {
        if (fs.existsSync(photoPath)) await bot.sendPhoto(chatId, photoPath, { caption: welcomeMessage, reply_markup: mainMenuKeyboard });
        else await bot.sendMessage(chatId, welcomeMessage, { reply_markup: mainMenuKeyboard });
      } catch { await bot.sendMessage(chatId, welcomeMessage, { reply_markup: mainMenuKeyboard }); }
      userStates.set(chatId, { lastActivity: now });
      return;
    }

    if (text === "/help" || text === "ℹ️ Help") {
      await bot.sendMessage(chatId, `📚 BANTUAN SINGKAT\n\nCARA PAKAI:\n1️⃣ Pilih fitur dari menu\n2️⃣ Upload file atau ikuti instruksi\n3️⃣ File hasil otomatis terkirim\n\nFITUR:\n📄 TXT→VCF: Upload .txt → dapat .vcf\n👥 Admin CV: Gabung admin+navy\n🔄 VCF→TXT: Upload .vcf → dapat .txt\n🔗 Merge: Gabung banyak .vcf\n\n⚠️ BATASAN:\n• Maks file: 10MB\n• Maks kontak: 50,000\n• Merge file: 100 file\n•\n\n📞 Butuh bantuan? ${OWNER_USERNAME}`, { reply_markup: mainMenuKeyboard });
      return;
    }

    if (text === "/about") {
      await bot.sendMessage(chatId, `👑 TENTANG BOT\n\nDeveloper: FETRUS MEILANO ILHAMSYAH\nTelegram: ${OWNER_USERNAME}\nWebsite: ${WEBSITE_URL}\n\n⚡ Fitur Unggulan:\n• Konversi super cepat\n• Format otomatis +62\n• File rapi & terorganisir\n• Hapus duplikat otomatis\n• Support ZIP untuk file besar\n• 100% GRATIS!\n\nRequest fitur? Chat ${OWNER_USERNAME}`, { reply_markup: mainMenuKeyboard });
      return;
    }

    if (text === "/stats" || text === "📊 Stats") {
      try {
        const userConversions = await db.select().from(conversions).where(eq(conversions.telegramUserId, chatId)).catch(() => []);
        const totalConversions = userConversions.length;
        const txtToVcf = userConversions.filter(c => c.conversionType === "TXT_TO_VCF").length;
        const adminCv = userConversions.filter(c => c.conversionType === "ADMIN_CV").length;
        const vcfToTxt = userConversions.filter(c => c.conversionType === "VCF_TO_TXT").length;
        const mergeVcf = userConversions.filter(c => c.conversionType === "MERGE_VCF").length;
        const totalNumbers = userConversions.reduce((sum, c) => sum + (c.numberCount || 0), 0);
        await bot.sendMessage(chatId, `📊 STATISTIK ANDA\n\n🔄 Total Konversi: ${totalConversions}\n📄 TXT→VCF: ${txtToVcf}\n👥 Admin CV: ${adminCv}\n🔄 VCF→TXT: ${vcfToTxt}\n🔗 Merge VCF: ${mergeVcf}\n📱 Total Kontak: ${totalNumbers}\n\nTerima kasih telah menggunakan bot!`, { reply_markup: mainMenuKeyboard });
      } catch { await bot.sendMessage(chatId, "⚠️ Tidak ada data statistik", { reply_markup: mainMenuKeyboard }); }
      return;
    }

    if (text === "/cancel" || text === "❌ Cancel") {
      if (state && state.mode) {
        userStates.set(chatId, { lastActivity: Date.now() });
        await bot.sendMessage(chatId, "❌ Operasi dibatalkan\n\nKembali ke menu utama", { reply_markup: mainMenuKeyboard });
      }
      return;
    }

    // ===== MENU BUTTON HANDLERS =====
    if (text === "/txt2vcf" || text === "📄 TXT → VCF") {
      userStates.set(chatId, { mode: "TXT_TO_VCF", step: 0, lastActivity: now });
      await bot.sendMessage(chatId, "📤 KIRIM FILE .txt\n\nFormat: satu nomor per baris\nContoh:\n08123456789\n08198765432\n\n⚠️ Maksimal 50,000 nomor");
      return;
    }
    if (text === "/admincv" || text === "👥 Admin CV") {
      userStates.set(chatId, { mode: "ADMIN_CV", step: 1, lastActivity: now });
      await bot.sendMessage(chatId, "👥 BUAT KONTAK ADMIN + NAVY\n\n📱 Masukkan nomor admin (satu per baris):");
      return;
    }
    if (text === "/vcf2txt" || text === "🔄 VCF → TXT") {
      userStates.set(chatId, { mode: "VCF_TO_TXT", lastActivity: now });
      await bot.sendMessage(chatId, "🔄 EKSTRAK NOMOR\n\n📤 Kirim file .vcf\n\n✅ Otomatis format +62\n✅ Hapus duplikat");
      return;
    }
    if (text === "/merge" || text === "🔗 Merge VCF") {
      userStates.set(chatId, { mode: "MERGE_VCF", step: 1, mergeFiles: [], mergeFileNames: [], lastActivity: now });
      await bot.sendMessage(chatId, "🔗 GABUNGKAN FILE VCF\n\n📤 Kirim file VCF (minimal 2 file)\n📊 Maksimal 100 file\n✅ Hapus duplikat otomatis\n\nKetik /done setelah semua file dikirim\nKetik /cancel untuk batal");
      return;
    }

    // ===== RESET COMMAND FOR REGULAR USERS =====
    if (text === "/reset" && userIdStr !== ADMIN_ID) {
      try {
        const userConversions = await db.select().from(conversions).where(eq(conversions.telegramUserId, chatId)).catch(() => []);
        const count = userConversions.length;
        if (count > 0) await db.delete(conversions).where(eq(conversions.telegramUserId, chatId)).catch(() => {});
        userStates.set(chatId, { lastActivity: now });
        await bot.sendMessage(chatId, `✅ Data Anda telah direset!\n\n🗑️ ${count} konversi dihapus\n🔄 Session diperbarui\n\nStatistik Anda telah dikosongkan.`, { reply_markup: mainMenuKeyboard });
        console.log(`🔄 User ${chatId} reset their data: ${count} records`);
      } catch (error) {
        console.error("User reset error:", error);
        await bot.sendMessage(chatId, "❌ Error resetting data", { reply_markup: mainMenuKeyboard });
      }
      return;
    }

    // ===== FILE HANDLING =====
    if (msg.document) {
      const fileName = msg.document.file_name?.toLowerCase() || "";
      if (msg.document.file_size && msg.document.file_size > MAX_FILE_SIZE) {
        await bot.sendMessage(chatId, `⚠️ File terlalu besar (${(msg.document.file_size/1024/1024).toFixed(1)}MB)\nMaksimal ${MAX_FILE_SIZE/1024/1024}MB`, { reply_markup: mainMenuKeyboard });
        return;
      }
      if (state.mode === "MERGE_VCF" && fileName.endsWith(".vcf")) {
        try {
          if ((state.mergeFiles?.length || 0) >= MAX_MERGE_FILES) {
            await bot.sendMessage(chatId, `⚠️ Maksimal ${MAX_MERGE_FILES} file\nKetik /done untuk merge`, { reply_markup: mainMenuKeyboard });
            return;
          }
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
          if (fileCount === 1 || fileCount % 10 === 0 || fileCount >= MAX_MERGE_FILES) {
            await bot.sendMessage(chatId, fileCount === 1 ? `✅ File 1 diterima\n\nKirim file lainnya atau ketik /done` : `✅ ${fileCount} file diterima\n\n${fileCount >= MAX_MERGE_FILES ? "Maksimal tercapai! " : ""}Ketik /done untuk merge`, { parse_mode: "Markdown" });
          }
        } catch (error: any) {
          console.error("Merge file error:", error);
          await bot.sendMessage(chatId, "❌ Error membaca file VCF");
        }
        return;
      }
      if (fileName.endsWith(".txt")) {
        try {
          const fileLink = await bot.getFileLink(msg.document.file_id);
          const response = await fetch(fileLink);
          const content = await response.text();
          const lines = content.split(/\r?\n/);
          if (lines.length > MAX_CONTACTS) {
            await bot.sendMessage(chatId, `⚠️ Terlalu banyak nomor (${lines.length})\nMaksimal ${MAX_CONTACTS} nomor`, { reply_markup: mainMenuKeyboard });
            return;
          }
          const numbers = lines.map(l => l.trim()).filter(l => l.length > 0).map(n => validateAndFormatPhoneNumber(n)).filter(n => n !== null) as string[];
          if (numbers.length === 0) {
            await bot.sendMessage(chatId, "⚠️ Tidak ada nomor valid dalam file");
            return;
          }
          userStates.set(chatId, { mode: "TXT_TO_VCF", step: 1, fileNumbers: numbers, numberCount: numbers.length, lastActivity: now });
          await bot.sendMessage(chatId, `✅ ${numbers.length} nomor valid\n\n📝 Masukkan nama kontak:`);
        } catch (error: any) {
          console.error("File error:", error);
          await bot.sendMessage(chatId, "❌ Error memproses file");
        }
        return;
      }
      if (fileName.endsWith(".vcf")) {
        try {
          const fileLink = await bot.getFileLink(msg.document.file_id);
          const response = await fetch(fileLink);
          const vcfContent = await response.text();
          const numbers = extractNumbersFromVcf(vcfContent);
          if (numbers.length === 0) {
            await bot.sendMessage(chatId, "⚠️ Tidak ada nomor valid dalam VCF");
            return;
          }
          const txtContent = numbers.join('\n');
          await bot.sendDocument(chatId, Buffer.from(txtContent), {}, { filename: `nomor_${Date.now()}_${numbers.length}.txt`, contentType: "text/plain" });
          await db.insert(conversions).values({
            telegramUserId: chatId,
            conversionType: "VCF_TO_TXT",
            fileName: `extracted_numbers.txt`,
            numberCount: numbers.length,
            contactName: null,
            adminName: null,
            navyName: null
          }).catch(() => {});
          await bot.sendMessage(chatId, `✅ Selesai!\n\n📊 ${numbers.length} nomor diekstrak\n✅ Format +62 otomatis\n✅ Duplikat dihapus\n\nPilih menu di bawah:`, { reply_markup: mainMenuKeyboard });
          userStates.set(chatId, { lastActivity: Date.now() });
        } catch (error: any) {
          console.error("VCF error:", error);
          await bot.sendMessage(chatId, "❌ Error memproses VCF");
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
    }

    // Default response (HANYA JALAN JIKA TIDAK ADA HANDLER LAIN)
    await bot.sendMessage(chatId, `🤖 BOT KONVERSI VCF\n\nGunakan menu di bawah atau ketik /start`, { reply_markup: mainMenuKeyboard });
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
        userStates.set(chatId, { mode: "MERGE_VCF", step: 1, mergeFiles: [], mergeFileNames: [], lastActivity: now });
        await bot.sendMessage(chatId, "🔗 Kirim file VCF (minimal 2)\n\nKetik /done setelah selesai", { reply_markup: mainMenuKeyboard });
      } else if (query.data === "btn_back") {
        userStates.set(chatId, { lastActivity: now });
        await bot.sendMessage(chatId, "📋 *Menu Utama*\n\nPilih fitur di bawah:", { parse_mode: "Markdown", reply_markup: mainMenuKeyboard });
      } else if (query.data === "btn_admin_panel") {
        if (chatId.toString() === ADMIN_ID) {
          await bot.sendMessage(chatId, "👑 ADMIN PANEL\n\nSelamat datang, Admin!\nPilih aksi di bawah:", { reply_markup: adminMenuKeyboard });
        }
      }
    } catch (error: any) {
      console.error("Callback error:", error);
    }
  });

  bot.on("polling_error", (error: Error) => {
    console.error("❌ Polling Error:", error.message);
  });

  console.log("==================================");
  console.log("🤖 BOT VCF CONVERTER - ADMIN EDITION");
  console.log("==================================");
  console.log("👑 Owner: FETRUS MEILANO ILHAMSYAH");
  console.log(`📞 Telegram: ${OWNER_USERNAME}`);
  console.log(`🆔 Owner ID: ${OWNER_ID}`);
  console.log(`🌐 Website: ${WEBSITE_URL}`);
  console.log(`🔧 Admin ID: ${ADMIN_ID}`);
  console.log(`📁 Max Size: ${MAX_FILE_SIZE/1024/1024}MB`);
  console.log(`👥 Max Contacts: ${MAX_CONTACTS}`);
  console.log(`⏰ Started: ${new Date().toLocaleTimeString()}`);
  console.log("==================================");
}