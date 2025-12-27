const { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, delay } = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// --- KONFIGURASI ---
// GANTI NOMOR DI SINI (Format: 628xxx)
const phoneNumber = "6283143826307"; 
const authFolder = 'auth_info_baileys';

// --- VARIABEL GLOBAL ---
let pairingCode = null;
let isConnected = false;
let sock = null;

// --- 1. SERVER WEB ---
app.get('/', async (req, res) => {
    res.setHeader('Content-Type', 'text/html');

    let content = '';

    if (isConnected) {
        content = `
            <div style="background: #d4edda; color: #155724; padding: 20px; border-radius: 10px; text-align: center;">
                <h1>✅ Bot WhatsApp Aktif!</h1>
                <p>Bot sudah terhubung dengan nomor ${phoneNumber}</p>
            </div>`;
    } else if (pairingCode) {
        content = `
            <div style="text-align: center;">
                <h1>Kode Pairing Anda:</h1>
                <div style="background: #f0f0f0; padding: 15px; font-size: 35px; font-weight: bold; letter-spacing: 5px; border: 2px dashed #333; margin: 20px 0;">
                    ${pairingCode}
                </div>
                <p>1. Buka WhatsApp > Perangkat Tertaut > Tautkan Perangkat</p>
                <p>2. Pilih <b>"Tautkan dengan nomor telepon saja"</b></p>
                <p>3. Masukkan kode di atas.</p>
                <p style="color: red;">*Kode akan berubah setiap kali bot restart</p>
            </div>`;
    } else {
        content = `<h1>⏳ Sedang memproses kode... Tunggu 5 detik.</h1>`;
    }

    // Tombol Reset Sesi (Penting untuk mengatasi kode error)
    content += `
        <br><br>
        <div style="text-align: center; margin-top: 50px; border-top: 1px solid #ccc; padding-top: 20px;">
            <p>Kode tidak muncul atau tidak bisa dipakai?</p>
            <a href="/reset" style="background: red; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                🗑️ HAPUS SESI & RESTART
            </a>
        </div>
        <script>setTimeout(() => window.location.reload(), 4000);</script>
    `;

    return res.send(`<div style="font-family: sans-serif; padding: 20px;">${content}</div>`);
});

// Route khusus untuk menghapus sesi secara manual
app.get('/reset', (req, res) => {
    try {
        if (fs.existsSync(authFolder)) {
            fs.rmSync(authFolder, { recursive: true, force: true });
        }
        res.send('<h1>✅ Sesi dihapus! Bot sedang restart...</h1><p>Silakan kembali ke halaman utama dalam 10 detik.</p><script>setTimeout(() => window.location.href = "/", 10000);</script>');
        console.log("Menghapus sesi dan restart...");
        process.exit(0); // Mematikan proses agar Render menyalakan ulang
    } catch (error) {
        res.send(`<h1>Gagal menghapus: ${error.message}</h1>`);
    }
});

app.listen(port, () => {
    console.log(`Server web berjalan di port ${port}`);
});

// --- 2. LOGIC BOT ---
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        connectTimeoutMs: 60000
    });

    // Request Pairing Code hanya jika belum terdaftar
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                // Pastikan belum connect sebelum request kode
                if (!isConnected) {
                    const code = await sock.requestPairingCode(phoneNumber);
                    pairingCode = code?.match(/.{1,4}/g)?.join("-") || code;
                    console.log(`✨ KODE PAIRING BARU: ${pairingCode}`);
                }
            } catch (err) {
                console.error("Gagal request pairing code:", err);
            }
        }, 4000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const reason = lastDisconnect.error?.output?.statusCode;
            console.log('❌ Koneksi terputus. Reason:', reason);
            
            isConnected = false;
            pairingCode = null;

            // Hapus sesi jika logout
            if (reason === DisconnectReason.loggedOut) {
                console.log('⛔ Logout. Hapus sesi...');
                if (fs.existsSync(authFolder)) {
                    fs.rmSync(authFolder, { recursive: true, force: true });
                }
            }

            console.log('🔄 Reconnecting...');
            setTimeout(() => connectToWhatsApp(), 5000);

        } else if (connection === 'open') {
            console.log('✅ Tersambung ke WhatsApp! 🚀');
            isConnected = true;
            pairingCode = null;
        }
    });

    sock.ev.on('messages.upsert', async m => {
        // Logic pesan sederhana
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const type = Object.keys(msg.message)[0];
        const text = type === 'conversation' ? msg.message.conversation : 
                     type === 'extendedTextMessage' ? msg.message.extendedTextMessage.text : '';

        if (text.toLowerCase() === '.ping') {
            await sock.sendMessage(msg.key.remoteJid, { text: 'Pong! 🏓' });
        }
    });
}

connectToWhatsApp();