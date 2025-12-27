const { makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const qrcode = require('qrcode');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// --- VARIABEL GLOBAL ---
let qrCodeData = null;
let isConnected = false;

// --- 1. SERVER WEB ---
app.get('/', async (req, res) => {
    res.setHeader('Content-Type', 'text/html');

    if (isConnected) {
        return res.send(`
            <div style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1>✅ Bot WhatsApp Aktif!</h1>
                <p style="color: green;">Terhubung sebagai Desktop (macOS)</p>
            </div>
        `);
    }

    if (qrCodeData) {
        try {
            const qrImage = await qrcode.toDataURL(qrCodeData);
            return res.send(`
                <div style="font-family: sans-serif; text-align: center; padding: 20px;">
                    <h1>Scan QR Code</h1>
                    <p style="color: red; font-weight: bold;">JANGAN LOGOUT DARI HP SETELAH SCAN!</p>
                    <img src="${qrImage}" alt="QR Code" style="width: 300px; height: 300px; border: 1px solid #ccc;"/>
                    <p>Refresh otomatis dalam 5 detik...</p>
                    <script>setTimeout(() => window.location.reload(), 5000);</script>
                </div>
            `);
        } catch (err) {
            return res.send('<h1>Gagal generate QR</h1>');
        }
    }

    return res.send(`
        <div style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h1>⏳ Menghubungkan ke WhatsApp...</h1>
            <p>Sedang mencoba bypass proteksi 405...</p>
            <script>setTimeout(() => window.location.reload(), 3000);</script>
        </div>
    `);
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
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        // --- PERBAIKAN PENTING DI SINI (Fix Error 405) ---
        // Kita menyamar sebagai Mac Desktop agar tidak diblokir WA
        browser: Browsers.macOS('Desktop'), 
        syncFullHistory: false, // Hemat memori Render
        connectTimeoutMs: 60000 
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('✨ QR Code diterima! Buka website Render.');
            qrCodeData = qr;
        }

        if (connection === 'close') {
            const reason = lastDisconnect.error?.output?.statusCode;
            console.log('❌ Koneksi terputus. Reason:', reason);

            isConnected = false;
            qrCodeData = null;

            // Jika error 405 (Method Not Allowed) atau 403 (Forbidden)
            // Hapus sesi dan coba lagi
            if (reason === 405 || reason === 403 || reason === 401) {
                console.log('⚠️ Terdeteksi blokir/logout (Error 405/403/401). Reset sesi...');
                try {
                    if (fs.existsSync(authFolder)) {
                        fs.rmSync(authFolder, { recursive: true, force: true });
                        console.log('🗑️ Sesi dihapus.');
                    }
                } catch (e) {
                    console.error('Gagal hapus sesi:', e);
                }
            }

            // Selalu reconnect kecuali jika user sengaja logout (jarang terjadi di bot)
            console.log('🔄 Reconnecting dalam 5 detik...');
            setTimeout(() => connectToWhatsApp(), 5000);
            
        } else if (connection === 'open') {
            console.log('✅ Tersambung ke WhatsApp! 🚀');
            isConnected = true;
            qrCodeData = null;
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

        // --- COMMANDS ---
        switch (command) {
            case 'ping':
                await sock.sendMessage(msg.key.remoteJid, { text: 'Pong! 🏓 (Mac Mode)' });
                break;

            case 'sticker':
            case 's':
                const isImage = msg.message.imageMessage;
                const isQuotedImage = msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;

                if (!isImage && !isQuotedImage) {
                    await sock.sendMessage(msg.key.remoteJid, { text: 'Kirim/Reply gambar dengan .sticker' });
                    return;
                }
                
                try {
                    await sock.sendMessage(msg.key.remoteJid, { react: { text: "⏳", key: msg.key } });
                    
                    let messageToDownload = isImage ? msg : {
                        message: msg.message.extendedTextMessage.contextInfo.quotedMessage
                    };

                    const buffer = await downloadMediaMessage(
                        messageToDownload,
                        'buffer',
                        {},
                        { logger: pino({ level: 'silent' }) }
                    );

                    const sticker = new Sticker(buffer, {
                        pack: 'Bot Sticker',
                        author: 'Bot Render',
                        type: StickerTypes.FULL,
                        quality: 50
                    });

                    await sock.sendMessage(msg.key.remoteJid, await sticker.toMessage());
                    await sock.sendMessage(msg.key.remoteJid, { react: { text: "✅", key: msg.key } });

                } catch (error) {
                    console.error("Error sticker:", error);
                    await sock.sendMessage(msg.key.remoteJid, { text: 'Gagal membuat sticker.' });
                }
                break;
        }
    });
}

connectToWhatsApp();