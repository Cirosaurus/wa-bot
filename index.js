const { makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const qrcode = require('qrcode'); // Library pengubah text jadi gambar
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// Variabel Global
let qrCodeData = null; // Menyimpan kode QR
let isConnected = false; // Status koneksi

// --- 1. SERVER WEB (TAMPILAN QR) ---
app.get('/', async (req, res) => {
    res.setHeader('Content-Type', 'text/html');

    // Tampilan jika sudah connect
    if (isConnected) {
        return res.send(`
            <center>
                <h1>✅ Bot WhatsApp Aktif!</h1>
                <p>Status: Terhubung ke WhatsApp Server</p>
            </center>
        `);
    }

    // Tampilan jika ada QR Code
    if (qrCodeData) {
        try {
            // Ubah kode QR menjadi gambar (Data URL)
            const qrImage = await qrcode.toDataURL(qrCodeData);
            return res.send(`
                <center>
                    <h1>Scan QR Code di Bawah ini</h1>
                    <img src="${qrImage}" alt="QR Code" style="width: 300px; height: 300px;"/>
                    <p>Halaman ini akan refresh otomatis dalam 5 detik...</p>
                    <script>setTimeout(() => window.location.reload(), 5000);</script>
                </center>
            `);
        } catch (err) {
            return res.send('<center><h1>Gagal generate gambar QR</h1></center>');
        }
    }

    // Tampilan jika sedang loading
    return res.send(`
        <center>
            <h1>⏳ Sedang Memuat...</h1>
            <p>Menunggu QR Code dari WhatsApp...</p>
            <script>setTimeout(() => window.location.reload(), 3000);</script>
        </center>
    `);
});

app.listen(port, () => {
    console.log(`Server web berjalan di port ${port}`);
});

// --- 2. LOGIC BOT WHATSAPP ---
async function connectToWhatsApp() {
    const authFolder = 'auth_info_baileys';

    // Hapus sesi HANYA jika folder auth rusak/perlu reset manual
    // Di Render Free, folder ini otomatis hilang saat deploy ulang,
    // jadi kita tidak perlu kode delete paksa di sini agar tidak looping.

    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // Matikan QR terminal
        logger: pino({ level: 'silent' }),
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        connectTimeoutMs: 60000 
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // Simpan QR ke variabel global agar bisa diambil browser
        if (qr) {
            console.log('QR Code baru diterima! Silakan buka website.');
            qrCodeData = qr;
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus. Reconnecting:', shouldReconnect);
            
            isConnected = false;
            // Jangan hapus qrCodeData di sini agar user masih bisa lihat last QR jika perlu

            if (shouldReconnect) {
                setTimeout(() => connectToWhatsApp(), 3000);
            }
        } else if (connection === 'open') {
            console.log('Tersambung ke WhatsApp! 🚀');
            isConnected = true;
            qrCodeData = null; // Hapus QR agar tidak muncul lagi
        }
    });

    // --- LOGIC PESAN ---
    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message) return;
        if (msg.key.fromMe) return;

        const messageType = Object.keys(msg.message)[0];
        const text = messageType === 'conversation' ? msg.message.conversation : 
                     messageType === 'extendedTextMessage' ? msg.message.extendedTextMessage.text : '';

        const prefix = '.'; 
        if (!text.startsWith(prefix)) return;

        const args = text.slice(prefix.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        switch (command) {
            case 'ping':
                await sock.sendMessage(msg.key.remoteJid, { text: 'Pong! 🏓' });
                break;
            case 'sticker':
            case 's':
                // ... (Kode sticker sama seperti sebelumnya) ...
                const isImage = msg.message.imageMessage;
                const isQuotedImage = msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
                
                if (!isImage && !isQuotedImage) {
                    await sock.sendMessage(msg.key.remoteJid, { text: 'Kirim gambar dengan caption .sticker' });
                    return;
                }
                try {
                    let messageToDownload;
                    if (isImage) {
                        messageToDownload = msg;
                    } else {
                        messageToDownload = {
                            message: msg.message.extendedTextMessage.contextInfo.quotedMessage
                        };
                    }
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
                } catch (error) {
                    console.log("Error sticker:", error);
                    await sock.sendMessage(msg.key.remoteJid, { text: 'Gagal membuat sticker.' });
                }
                break;
        }
    });
}

connectToWhatsApp();