const { makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const qrcode = require('qrcode-terminal'); 
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const fs = require('fs'); // <--- TAMBAHAN 1: Import Module File System

const app = express();
const port = process.env.PORT || 3000;

// --- 1. SERVER WEB PANCINGAN ---
app.get('/', (req, res) => {
    res.send('Bot WhatsApp sedang berjalan! 🤖');
});

app.listen(port, () => {
    console.log(`Server web berjalan di port ${port}`);
});

// --- 2. LOGIC BOT WHATSAPP ---
async function connectToWhatsApp() {
    // Nama folder sesi (disimpan di variabel agar konsisten)
    const authFolder = 'auth_info_baileys';

    // <--- TAMBAHAN 2: LOGIKA PEMBERSIH SESI ---
    // Cek apakah folder sesi ada? Jika ada, hapus paksa agar minta QR baru.
    try {
        if (fs.existsSync(authFolder)) {
            fs.rmSync(authFolder, { recursive: true, force: true });
            console.log('🗑️ Sesi lama berhasil dihapus. Meminta QR Code baru...');
        }
    } catch (error) {
        console.error('Gagal menghapus sesi lama:', error);
    }
    // -------------------------------------------

    // Gunakan variabel authFolder yang sudah didefinisikan di atas
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, 
        logger: pino({ level: 'silent' }),
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        // Tambahkan timeout koneksi agar lebih stabil
        connectTimeoutMs: 60000 
    });

    sock.ev.on('creds.update', saveCreds);

    // Cek koneksi & Generate QR Manual
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // --- BAGIAN INI UNTUK MEMUNCULKAN QR CODE ---
        if (qr) {
            console.log('Scan QR Code di bawah ini:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus. Reconnecting:', shouldReconnect);
            
            // Reconnect jika bukan logout
            if (shouldReconnect) {
                // Beri jeda 3 detik sebelum connect ulang agar tidak spamming
                setTimeout(() => connectToWhatsApp(), 3000);
            }
        } else if (connection === 'open') {
            console.log('Tersambung ke WhatsApp! 🚀');
        }
    });

    // Membaca pesan
    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message) return;
        if (msg.key.fromMe) return;

        const messageType = Object.keys(msg.message)[0];
        const text = messageType === 'conversation' ? msg.message.conversation : 
                     messageType === 'extendedTextMessage' ? msg.message.extendedTextMessage.text : '';

        // Prefix Check
        const prefix = '.'; 
        if (!text.startsWith(prefix)) return;

        const args = text.slice(prefix.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        switch (command) {
            case 'ping':
                await sock.sendMessage(msg.key.remoteJid, { text: 'Pong! 🏓' });
                break;

            case 'help':
            case 'menu':
                await sock.sendMessage(msg.key.remoteJid, { text: 'Menu: .ping, .sticker' });
                break;

            case 'sticker':
            case 's':
                const isImage = msg.message.imageMessage;
                const isQuotedImage = msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;

                if (!isImage && !isQuotedImage) {
                    await sock.sendMessage(msg.key.remoteJid, { text: 'Kirim/Reply gambar dengan caption .sticker' });
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
                        { },
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