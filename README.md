# 🤖 Contact Converter Fee Bot

Bot Telegram otomatis untuk konversi file `.txt` ke `.vcf` dengan sistem manajemen user premium dan database terintegrasi.

---

## 📋 Informasi & Panduan Setup Cepat

| Kategori | Keterangan & Instruksi |
| :--- | :--- |
| **🚀 Persiapan** | 1. Ambil Token di [@BotFather](https://t.me/BotFather)<br>2. Cek ID kamu di [@userinfobot](https://t.me/userinfobot)<br>3. Buat DB di [Neon.tech](https://neon.tech) |
| **⚙️ Setup .env** | Buat file `.env` di folder utama, lalu isi:<br>`DATABASE_URL=link_neon_kamu`<br>`TELEGRAM_BOT_TOKEN=token_bot_kamu`<br>`ADMIN_ID=1341856464`<br>`PORT=5000` |
| **💻 Jalankan** | 1. `npm install` (Install library)<br>2. `npm run dev` (Jalankan Bot) |
| **🛠️ Solusi Error** | • **ENOTFOUND base**: Link DB di `.env` salah, hapus format `$env:`.<br>• **Token Not Found**: Pastikan file bernama `.env` (pakai titik) & sudah disave.<br>• **Fitur Hilang**: Koneksi DB gagal atau DB masih kosong. |
| **✨ Fitur Utama** | • Konversi TXT ke VCF (Kontak HP)<br>• Sistem User Premium & Admin Panel<br>• Auto-sync Database Neon PostgreSQL |
| **👤 Developer** | **FETRUS MEILANO ILHAMSYAH** |

---

## ⚠️ Catatan Keamanan
Jangan pernah melakukan `git push` jika file `.env` kamu belum masuk ke `.gitignore`. Lindungi **DATABASE_URL** dan **BOT_TOKEN** kamu agar tidak disalahgunakan orang lain.

---
*Dibuat dengan semangat koding DENGAN AI wkwkwwk! 🚀*
