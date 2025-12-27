const { makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// --- KONFIGURASI ---
// NOMOR HP BOT
const phoneNumber = "6283143826307"; 
const authFolder = 'auth_info_baileys';

// --- VARIABEL GLOBAL ---
let pairingCode = null;
let isConnected = false;
let sock = null;

// --- 1. SERVER WEB (UI MANUAL) ---
app.get('/', async (req, res) => {
    res.setHeader('Content-Type', 'text/html');

    const styleCenter = 'style="font-family: sans-serif; text-align: center; padding: 20px;"';
    const btnStyle = 'background-color: #007bff; color: white; padding: 15px 30px; text-decoration: none; font-size: 18px; border-radius: 5px; font-weight: bold; display: inline-block; margin-top: 10px;';
    const btnResetStyle = 'background-color: #dc3545; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 14px;';

    let content = '';

    if (isConnected) {
        content = `
            <div ${styleCenter}>
                <h1 style="color: green;">✅ Bot WhatsApp Aktif!</h1>
                <p>Terhubung ke nomor: ${phoneNumber}</p>
                <p style="font-size: 12px; color: grey;">Mode: Stealth (No Online Status)</p>
            </div>`;
    } else if (pairingCode) {
        content = `
            <div ${styleCenter}>
                <h1>Kode Pairing Anda:</h1>
                <div style="background: #f0f0f0; padding: 15px; font-size: 35px; font-weight: bold; letter-spacing: 5px; border: 2px dashed #333; margin: 20px 0;">
                    ${pairingCode}
                </div>
                <p>1. Buka WA > Perangkat Tertaut > Tautkan dengan No HP</p>
                <p>2. Masukkan kode di atas segera.</p>
                <br>
                <a href="/" style="${btnStyle} background-color: #6c757d;">🔄 Refresh Halaman</a>
            </div>`;
    } else {
        content = `
            <div ${styleCenter}>
                <h1>🛡️ Bot WA (Mode Stealth)</h1>
                <p>Status: <span style="color: orange;">Standby / Disconnected</span></p>
                <p>Klik tombol di bawah untuk meminta kode:</p>
                <br>
                <a href="/get-code" style="${btnStyle}">👉 MINTA KODE PAIRING</a>
                <br><br><br>
                <a href="/reset" style="${btnResetStyle}">🗑️ RESET SESI & RESTART</a>
            </div>`;
    }

    return res.send(content);
});

// Route Tombol Minta Kode
app.get('/get-code', async (req, res) => {
    if (!sock) return res.send('Bot belum siap loading... tunggu 5 detik.');
    if (isConnected) return res.redirect('/');

    try {
        console.log("Minta kode manual...");
        const code = await sock.requestPairingCode(phoneNumber);
        pairingCode = code?.match(/.{1,4}/g)?.join("-") || code;
        res.redirect('/');
    } catch (error) {
        console.error("Gagal request code:", error);
        res.send(`Gagal: ${error.message}. <br><a href="/">Kembali</a>`);
    }
});

// Route Reset Sesi
app.get('/reset', (req, res) => {
    if (fs.existsSync(authFolder)) {
        fs.rmSync(authFolder, { recursive: true, force: true });
    }
    res.send('<h1>Sesi Dihapus. Bot Restart...</h1><script>setTimeout(() => window.location.href = "/", 5000);</script>');
    process.exit(0);
});

app.listen(port, () => {
    console.log(`Server web berjalan di port ${port}`);
});

// --- 2. LOGIC BOT (CONFIG STEALTH) ---
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        
        // --- CONFIG STEALTH / ANTI-BLOKIR ---
        // 1. Hapus browser custom (biarkan default Baileys)
        // 2. Matikan status online saat connect
        markOnlineOnConnect: false, 
        // 3. Matikan sync history penuh (biar ringan & tidak mencurigakan)
        syncFullHistory: false, 
        
        connectTimeoutMs: 60000,
        retryRequestDelayMs: 5000 
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const reason = lastDisconnect.error?.output?.statusCode;
            console.log('❌ Koneksi terputus. Reason:', reason);
            
            isConnected = false;
            pairingCode = null;

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
            await sock.sendMessage(msg.key.remoteJid, { text: 'Pong Stealth Mode! 🏓' });
        }
    });
}

connectToWhatsApp();