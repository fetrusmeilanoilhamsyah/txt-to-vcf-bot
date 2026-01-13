import TelegramBot from "node-telegram-bot-api";
import fs from "fs";
import path from "path";
import { db } from "./db";
import { conversions, membershipPackages, userMemberships, paymentRecords } from "@shared/schema";
import { eq, and } from "drizzle-orm";

interface UserState {
  mode?: "TXT_TO_VCF" | "ADMIN_CV" | "VIP_PURCHASE";
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
  selectedPackageId?: number;
}

const userStates = new Map<number, UserState>();
const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID?.toString() || "";
const PREMIUM_USERS = process.env.PREMIUM_USERS?.split(",").map(id => id.trim()) || [];

console.log("Admin ID configured:", ADMIN_ID);
console.log("Premium users configured:", PREMIUM_USERS.length, "users");

// Format phone number with + prefix for VCF
function formatPhoneNumber(number: string): string {
  if (!number) return number;
  const digits = number.replace(/\D/g, "");
  return digits.startsWith("+") || number.startsWith("+") ? number : `+${digits}`;
}

// Check if user is in premium whitelist
function isPremiumUser(chatId: number): boolean {
  const userId = chatId.toString();
  const isPremium = PREMIUM_USERS.includes(userId) || userId === ADMIN_ID;
  console.log(`Checking premium status for ${userId}: ${isPremium}`);
  return isPremium;
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
        const packages = await db.select().from(membershipPackages);
        const priceList = packages.map(p => `${p.name}: Rp${p.price.toLocaleString("id-ID")}`).join(" | ");
        
        const welcomeMessage = `🎉 Bot Konverter VCF Pro

📄 CV TXT to VCF - GRATIS DARI FETRUS MEILANO ILHAMSYAH
👥 CV Kontak Admin - PREMIUM
💎 Premium Membership ${priceList}

Pilih fitur di bawah:`;

        const inlineKeyboard = {
          inline_keyboard: [
            [
              { text: "📄 CV TXT to VCF", callback_data: "btn_txt_to_vcf" },
              { text: "👥 CV Kontak Admin", callback_data: "btn_admin" }
            ],
            [
              { text: "💎 Premium Membership", callback_data: "btn_vip" }
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

    // VIP command - show membership packages
    if (text === "/vip") {
      try {
        const packages = await db.select().from(membershipPackages);
        const isPremium = isPremiumUser(chatId);
        
        let message = isPremium ? "✅ Anda sudah Premium!\n\n" : "💎 PAKET PREMIUM MEMBERSHIP\n\n";
        
        packages.forEach((pkg) => {
          message += `📦 ${pkg.name}\n💰 Rp${pkg.price.toLocaleString("id-ID")}\n⏱️ ${pkg.days} hari akses\n\n`;
        });
        
        message += "💳 Cara Pembayaran:\n1. Pilih paket\n2. Transfer ke rekening yang diberikan\n3. Kirim bukti transfer\n4. Admin akan verifikasi\n\nKetik /paket untuk memilih paket";
        
        await bot.sendMessage(chatId, message);
      } catch (err) {
        console.error("Error showing VIP packages:", err);
        await bot.sendMessage(chatId, "❌ Gagal memuat paket Premium");
      }
      return;
    }

    // Paket selection
    if (text === "/paket") {
      try {
        const packages = await db.select().from(membershipPackages);
        const buttons = packages.map((pkg) => [
          { text: `${pkg.name} - Rp${pkg.price.toLocaleString("id-ID")}`, callback_data: `vip_${pkg.id}` }
        ]);
        
        await bot.sendMessage(chatId, "Pilih paket Premium:", {
          reply_markup: { inline_keyboard: buttons }
        });
      } catch (err) {
        console.error("Error loading packages:", err);
        await bot.sendMessage(chatId, "❌ Gagal memuat paket");
      }
      return;
    }

    // Admin verify command
    if (text?.startsWith("/verify ")) {
      const userIdStr = chatId.toString();
      console.log(`Admin check: userId=${userIdStr}, adminId=${ADMIN_ID}, match=${userIdStr === ADMIN_ID}`);
      
      if (userIdStr !== ADMIN_ID) {
        await bot.sendMessage(chatId, `❌ Hanya admin yang bisa menggunakan command ini.\n\nID Anda: ${userIdStr}`);
        return;
      }
      
      const parts = text.trim().split(" ");
      console.log("Verify command parts:", parts);
      
      if (parts.length < 3) {
        await bot.sendMessage(chatId, "Format: /verify <userId> <packageId>\n\nContoh: /verify 987654321 1");
        return;
      }
      
      const userId = parseInt(parts[1], 10);
      const packageId = parseInt(parts[2], 10);
      
      console.log(`Parsing: userId=${userId}, packageId=${packageId}`);
      
      if (isNaN(userId) || isNaN(packageId)) {
        await bot.sendMessage(chatId, `❌ Error: userId atau packageId tidak valid!\n\nAnda kirim: /verify ${parts[1]} ${parts[2]}\n\nMohon gunakan angka.\n\nFormat: /verify <userId> <packageId>`);
        return;
      }
      
      try {
        const pkg = await db.query.membershipPackages.findFirst({
          where: eq(membershipPackages.id, packageId)
        });
        
        if (!pkg) {
          await bot.sendMessage(chatId, `❌ Paket ID ${packageId} tidak ditemukan.\n\nPackage IDs yang valid:\n1 = 7 Hari (Rp5,000)\n2 = 15 Hari (Rp10,000)\n3 = 1 Bulan (Rp20,000)`);
          return;
        }
        
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + pkg.days);
        
        const existing = await db.query.userMemberships.findFirst({
          where: eq(userMemberships.telegramUserId, userId)
        });
        
        if (existing) {
          await db.update(userMemberships).set({
            status: "active",
            expiresAt,
            packageId
          }).where(eq(userMemberships.telegramUserId, userId));
        } else {
          await db.insert(userMemberships).values({
            telegramUserId: userId,
            packageId,
            status: "active",
            expiresAt
          });
        }
        
        await db.update(paymentRecords).set({
          status: "verified",
          verifiedBy: chatId,
          verifiedAt: new Date()
        }).where(and(
          eq(paymentRecords.telegramUserId, userId),
          eq(paymentRecords.packageId, packageId),
          eq(paymentRecords.status, "pending")
        ));
        
        await bot.sendMessage(chatId, `✅ User ${userId} sudah diverifikasi!\n\n📦 Paket: ${pkg.name}\n💰 Harga: Rp${pkg.price.toLocaleString("id-ID")}\n⏱️ Premium sampai: ${expiresAt.toLocaleDateString("id-ID")}`);
        
        try {
          await bot.sendMessage(userId, `✅ Pembayaran Anda sudah diverifikasi!\n\n🎉 Anda sekarang Premium!\n\n📦 Paket: ${pkg.name}\n⏱️ Durasi: ${pkg.days} hari\n📅 Berakhir: ${expiresAt.toLocaleDateString("id-ID")}\n\nSekarang Anda bisa akses CV Kontak Admin. Ketik /admin untuk mulai!`);
        } catch (e) {
          console.log("User not found for notification");
        }
      } catch (err) {
        console.error("Error verifying payment:", err);
        await bot.sendMessage(chatId, `❌ Gagal memverifikasi pembayaran\n\nError: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
      return;
    }

    // Admin clear conversions command
    if (text === "/clear_all") {
      const userIdStr = chatId.toString();
      
      if (userIdStr !== ADMIN_ID) {
        await bot.sendMessage(chatId, `❌ Hanya admin yang bisa menggunakan command ini.\n\nID Anda: ${userIdStr}`);
        return;
      }

      try {
        await db.delete(conversions);
        userStates.clear();
        await bot.sendMessage(chatId, `✅ Hasil konversi berhasil dihapus!\n\n🗑️ Data yang dihapus:\n- Conversions (hasil konversi): Dihapus ✅\n- User States: Dihapus ✅\n\n✅ Data yang tetap aman:\n- Payment Records (bukti pembayaran): Tersimpan ✅\n- User Memberships (data Premium): Tersimpan ✅\n\nBot siap untuk test baru!`);
        console.log("✅ Admin cleared conversions data from database");
      } catch (err) {
        console.error("Error clearing conversions:", err);
        await bot.sendMessage(chatId, `❌ Gagal menghapus data\n\nError: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
      return;
    }

    // Admin mode
    if (text === "/admin") {
      if (!isPremiumUser(chatId)) {
        await bot.sendMessage(chatId, "🔒 Fitur ini hanya untuk member premium.\n\nHubungi admin untuk akses premium.");
        return;
      }
      
      state.mode = "ADMIN_CV";
      state.step = 1;
      await bot.sendMessage(chatId, "Berikan nomor admin (ketik satu nomor per baris):");
      return;
    }

    // Handle payment proof (photo/document)
    if (msg.photo || (msg.document && state.mode === "VIP_PURCHASE")) {
      try {
        const pendingPayment = await db.query.paymentRecords.findFirst({
          where: and(
            eq(paymentRecords.telegramUserId, chatId),
            eq(paymentRecords.status, "pending")
          )
        });

        if (!pendingPayment) {
          await bot.sendMessage(chatId, "⚠️ Anda belum memilih paket Premium.\n\nKetik /vip untuk memilih paket terlebih dahulu.");
          return;
        }

        const pkg = await db.query.membershipPackages.findFirst({
          where: eq(membershipPackages.id, pendingPayment.packageId)
        });

        if (!pkg) {
          await bot.sendMessage(chatId, "❌ Paket tidak ditemukan");
          return;
        }

        const adminMessage = `🔔 BUKTI PEMBAYARAN BARU!

👤 User ID: <code>${chatId}</code>
📦 Paket: ${pkg.name}
💰 Jumlah: Rp${pkg.price.toLocaleString("id-ID")}
📅 Waktu: ${new Date().toLocaleString("id-ID")}

✅ Untuk verifikasi, gunakan:
<code>/verify ${chatId} ${pkg.id}</code>`;

        if (ADMIN_ID) {
          try {
            if (msg.photo) {
              const photoId = msg.photo[msg.photo.length - 1].file_id;
              await bot.sendPhoto(parseInt(ADMIN_ID), photoId, {
                caption: adminMessage,
                parse_mode: "HTML"
              });
            } else if (msg.document) {
              const docId = msg.document.file_id;
              await bot.sendDocument(parseInt(ADMIN_ID), docId, {
                caption: adminMessage,
                parse_mode: "HTML"
              });
            }
          } catch (e) {
            console.log("Failed to send to admin:", e);
          }
        }

        await bot.sendMessage(chatId, `✅ Bukti pembayaran diterima!

Terima kasih sudah mengirim bukti transfer. Admin akan memverifikasi dalam waktu kurang dari 1 jam.

Anda akan mendapat notifikasi setelah pembayaran diverifikasi.`);
        return;
      } catch (error) {
        console.error("Error processing payment proof:", error);
        await bot.sendMessage(chatId, "❌ Terjadi kesalahan saat memproses bukti pembayaran.");
      }
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
      if (!isPremiumUser(chatId)) {
        await bot.sendMessage(chatId, "🔒 Fitur CV Kontak Admin hanya untuk member premium.\n\nHubungi admin untuk akses premium.");
        return;
      }
      
      state.mode = "ADMIN_CV";
      state.step = 1;
      await bot.sendMessage(chatId, "Berikan nomor admin (ketik satu nomor per baris):");
      return;
    } else if (query.data?.startsWith("vip_")) {
      await bot.answerCallbackQuery(query.id);
      const packageId = parseInt(query.data.split("_")[1]);
      
      try {
        const pkg = await db.query.membershipPackages.findFirst({
          where: eq(membershipPackages.id, packageId)
        });
        
        if (!pkg) {
          await bot.sendMessage(chatId, "❌ Paket tidak ditemukan");
          return;
        }
        
        const message = `💳 PAKET: ${pkg.name}
💰 HARGA: Rp${pkg.price.toLocaleString("id-ID")}
⏱️ DURASI: ${pkg.days} hari akses Premium

📌 CARA PEMBAYARAN:

1️⃣ Transfer ke:
BANK SEA BANK
NO REK: 901903426172
ATAS NAMA: NURYUTEH

2️⃣ Kirim bukti transfer ke bot ini
💡 Kirim foto atau dokumen bukti transfer

3️⃣ Admin akan verifikasi dalam <1 jam

Setelah verifikasi, Anda langsung bisa akses CV Kontak Admin!`;
        
        await bot.sendMessage(chatId, message);
        state.mode = "VIP_PURCHASE";
        state.selectedPackageId = packageId;
        
        await db.insert(paymentRecords).values({
          telegramUserId: chatId,
          packageId,
          amount: pkg.price,
          status: "pending"
        });
      } catch (err) {
        console.error("Error processing Premium purchase:", err);
        await bot.sendMessage(chatId, "❌ Terjadi kesalahan");
      }
      return;
    } else if (query.data === "btn_vip") {
      await bot.answerCallbackQuery(query.id);
      
      if (isPremiumUser(chatId)) {
        await bot.sendMessage(chatId, "✅ Anda sudah Premium! Akses CV Kontak Admin sekarang dengan ketik /admin");
        return;
      }
      
      try {
        const packages = await db.select().from(membershipPackages);
        const buttons = packages.map((pkg) => [
          { text: `${pkg.name} - Rp${pkg.price.toLocaleString("id-ID")}`, callback_data: `vip_${pkg.id}` }
        ]);
        
        const vipMessage = `💎 PAKET PREMIUM MEMBERSHIP

Pilih paket yang sesuai kebutuhan Anda:`;
        
        await bot.sendMessage(chatId, vipMessage, {
          reply_markup: { inline_keyboard: buttons }
        });
      } catch (err) {
        console.error("Error loading packages:", err);
        await bot.sendMessage(chatId, "❌ Gagal memuat paket");
      }
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