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
let sock = null; // Variable socket dibuat global agar bisa diakses tombol web

// --- 1. SERVER WEB ---
app.get('/', async (req, res) => {
    res.setHeader('Content-Type', 'text/html');

    let content = '';
    const styleCenter = 'style="font-family: sans-serif; text-align: center; padding: 20px;"';
    const btnStyle = 'background-color: #007bff; color: white; padding: 15px 30px; text-decoration: none; font-size: 18px; border-radius: 5px; font-weight: bold; display: inline-block; margin-top: 10px;';
    const btnResetStyle = 'background-color: #dc3545; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 14px;';

    if (isConnected) {
        // TAMPILAN 1: SUDAH CONNECT
        content = `
            <div ${styleCenter}>
                <h1 style="color: green;">✅ Bot WhatsApp Aktif!</h1>
                <p>Bot sudah terhubung dengan nomor ${phoneNumber}</p>
            </div>`;
    } else if (pairingCode) {
        // TAMPILAN 2: KODE SUDAH MUNCUL
        content = `
            <div ${styleCenter}>
                <h1>Kode Pairing Anda:</h1>
                <div style="background: #f0f0f0; padding: 15px; font-size: 35px; font-weight: bold; letter-spacing: 5px; border: 2px dashed #333; margin: 20px 0;">
                    ${pairingCode}
                </div>
                <p>1. Buka WhatsApp > Perangkat Tertaut > Tautkan Perangkat</p>
                <p>2. Pilih <b>"Tautkan dengan nomor telepon saja"</b></p>
                <p>3. Masukkan kode di atas.</p>
                <p style="color: red; font-size: 12px;">*Kode hilang dalam 30 detik</p>
                <br>
                <a href="/" style="${btnStyle} background-color: #6c757d;">🔄 Refresh Halaman</a>
            </div>`;
    } else {
        // TAMPILAN 3: BELUM ADA KODE (STANDBY)
        content = `
            <div ${styleCenter}>
                <h1>🤖 Dashboard Bot WA</h1>
                <p>Status: <span style="color: orange;">Standby / Disconnected</span></p>
                <p>Klik tombol di bawah untuk meminta kode baru:</p>
                <br>
                <a href="/get-code" style="${btnStyle}">👉 MINTA KODE PAIRING</a>
                <br><br><br>
                <p style="font-size: 12px; color: #666;">Jika kode error terus, reset sesi:</p>
                <a href="/reset" style="${btnResetStyle}">🗑️ HAPUS SESI & RESTART</a>
            </div>`;
    }

    return res.send(content);
});

// --- ROUTE UNTUK TOMBOL MANUAL ---

// 1. Tombol Minta Kode
app.get('/get-code', async (req, res) => {
    if (!sock) {
        return res.send('<h1>Bot belum siap, tunggu 5 detik lalu refresh.</h1>');
    }
    if (isConnected) {
        return res.send('<h1>Bot sudah connect kok! Ngapain minta kode lagi?</h1><a href="/">Kembali</a>');
    }

    try {
        // INI PROSES REQUEST CODE MANUAL
        console.log("Tombol ditekan: Meminta Pairing Code...");
        const code = await sock.requestPairingCode(phoneNumber);
        pairingCode = code?.match(/.{1,4}/g)?.join("-") || code;
        res.redirect('/'); // Balik ke halaman utama buat liat kode
    } catch (error) {
        console.error("Gagal request code:", error);
        res.send(`<h1 style="color:red">Gagal meminta kode!</h1><p>Error: ${error.message}</p><p>Coba klik tombol Reset Sesi di halaman utama.</p><a href="/">Kembali</a>`);
    }
});

// 2. Tombol Reset
app.get('/reset', (req, res) => {
    if (fs.existsSync(authFolder)) {
        fs.rmSync(authFolder, { recursive: true, force: true });
    }
    res.send('<h1>Sesi dihapus. Bot Restart...</h1><script>setTimeout(() => window.location.href = "/", 5000);</script>');
    process.exit(0);
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
        connectTimeoutMs: 60000,
        // Supaya tidak retry terlalu agresif
        retryRequestDelayMs: 5000 
    });

    // KITA HAPUS BAGIAN "setTimeout requestPairingCode" OTOMATIS DARI SINI
    // Biarkan tombol web yang melakukan tugas itu.

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const reason = lastDisconnect.error?.output?.statusCode;
            console.log('❌ Koneksi terputus. Reason:', reason);
            
            isConnected = false;
            pairingCode = null; // Reset kode kalau putus

            if (reason === DisconnectReason.loggedOut) {
                console.log('⛔ Logout. Hapus sesi...');
                if (fs.existsSync(authFolder)) fs.rmSync(authFolder, { recursive: true, force: true });
            }

            // Reconnect
            setTimeout(() => connectToWhatsApp(), 5000);

        } else if (connection === 'open') {
            console.log('✅ Tersambung ke WhatsApp! 🚀');
            isConnected = true;
            pairingCode = null;
        }
    });

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const type = Object.keys(msg.message)[0];
        const text = type === 'conversation' ? msg.message.conversation : 
                     type === 'extendedTextMessage' ? msg.message.extendedTextMessage.text : '';

        if (text.toLowerCase() === '.ping') {
            await sock.sendMessage(msg.key.remoteJid, { text: 'Pong Manual Mode! 🏓' });
        }
    });
}

connectToWhatsApp();