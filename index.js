const { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, delay } = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// --- KONFIGURASI ---
// GANTI NOMOR INI DENGAN NOMOR WA YANG AKAN JADI BOT
// Awali dengan kode negara (62), tanpa spasi atau tanda plus
const phoneNumber = "6283143826307"; 

// --- VARIABEL GLOBAL ---
let pairingCode = null;
let isConnected = false;

// --- 1. SERVER WEB ---
app.get('/', async (req, res) => {
    res.setHeader('Content-Type', 'text/html');

    if (isConnected) {
        return res.send('<center><h1>✅ Bot WhatsApp Aktif!</h1></center>');
    }

    if (pairingCode) {
        return res.send(`
            <div style="font-family: sans-serif; text-align: center; padding: 20px;">
                <h1>Kode Pairing Anda:</h1>
                <div style="background: #f0f0f0; padding: 20px; font-size: 40px; font-weight: bold; letter-spacing: 5px; border-radius: 10px;">
                    ${pairingCode}
                </div>
                <p>1. Buka WhatsApp di HP > Perangkat Tertaut > Tautkan Perangkat</p>
                <p>2. Pilih <b>"Tautkan dengan nomor telepon saja"</b> (di bagian bawah)</p>
                <p>3. Masukkan kode di atas.</p>
                <script>setTimeout(() => window.location.reload(), 5000);</script>
            </div>
        `);
    }

    return res.send('<center><h1>⏳ Sedang memproses kode...</h1><script>setTimeout(() => window.location.reload(), 3000);</script></center>');
});

app.listen(port, () => {
    console.log(`Server web berjalan di port ${port}`);
});

// --- 2. LOGIC BOT ---
async function connectToWhatsApp() {
    const authFolder = 'auth_info_baileys';
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // Kita tidak pakai QR
        logger: pino({ level: 'silent' }),
        browser: ["Ubuntu", "Chrome", "20.0.04"], // Browser standar Linux
        connectTimeoutMs: 60000
    });

    // --- LOGIC PAIRING CODE ---
    if (!sock.authState.creds.registered) {
        // Tunggu sebentar biar socket siap
        setTimeout(async () => {
            try {
                // Request kode pairing
                const code = await sock.requestPairingCode(phoneNumber);
                pairingCode = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`✨ KODE PAIRING: ${pairingCode}`);
            } catch (err) {
                console.error("Gagal request pairing code:", err);
            }
        }, 5000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const reason = lastDisconnect.error?.output?.statusCode;
            console.log('❌ Koneksi terputus. Reason:', reason);
            
            isConnected = false;

            // Hapus sesi jika logout atau banned
            if (reason === DisconnectReason.loggedOut) {
                console.log('⛔ Logout. Hapus sesi...');
                fs.rmSync(authFolder, { recursive: true, force: true });
            }

            // Reconnect
            console.log('🔄 Reconnecting...');
            setTimeout(() => connectToWhatsApp(), 5000);

        } else if (connection === 'open') {
            console.log('✅ Tersambung ke WhatsApp! 🚀');
            isConnected = true;
            pairingCode = null; // Hapus kode setelah connect
        }
    });

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const messageType = Object.keys(msg.message)[0];
        const text = messageType === 'conversation' ? msg.message.conversation : 
                     messageType === 'extendedTextMessage' ? msg.message.extendedTextMessage.text : '';

        if (!text.startsWith('.')) return;
        const args = text.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        // CONTOH COMMAND
        if (command === 'ping') {
            await sock.sendMessage(msg.key.remoteJid, { text: 'Pong via Pairing Code! 🏓' });
        }
    });
}

connectToWhatsApp();