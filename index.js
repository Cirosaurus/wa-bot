const { makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const qrcode = require('qrcode'); // Library untuk menampilkan QR di Web
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// --- VARIABEL GLOBAL ---
let qrCodeData = null; // Untuk menyimpan data QR
let isConnected = false; // Status koneksi

// --- 1. SERVER WEB (TAMPILAN QR) ---
app.get('/', async (req, res) => {
    res.setHeader('Content-Type', 'text/html');

    // Tampilan jika sudah connect
    if (isConnected) {
        return res.send(`
            <div style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1>✅ Bot WhatsApp Aktif!</h1>
                <p style="color: green; font-size: 18px;">Bot sudah terhubung ke server WhatsApp.</p>
            </div>
        `);
    }

    // Tampilan jika QR Code tersedia
    if (qrCodeData) {
        try {
            // Ubah kode QR menjadi gambar (Data URL)
            const qrImage = await qrcode.toDataURL(qrCodeData);
            return res.send(`
                <div style="font-family: sans-serif; text-align: center; padding: 20px;">
                    <h1>Scan QR Code di Bawah Ini</h1>
                    <p>Buka WhatsApp > Titik Tiga > Perangkat Tertaut > Tautkan Perangkat</p>
                    <img src="${qrImage}" alt="QR Code" style="width: 300px; height: 300px; border: 1px solid #ccc;"/>
                    <p>Halaman ini akan refresh otomatis dalam 5 detik...</p>
                    <script>setTimeout(() => window.location.reload(), 5000);</script>
                </div>
            `);
        } catch (err) {
            return res.send('<h1>Gagal generate gambar QR</h1>');
        }
    }

    // Tampilan jika sedang loading (menunggu QR dari WA)
    return res.send(`
        <div style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h1>⏳ Sedang Memuat...</h1>
            <p>Menunggu QR Code dari WhatsApp...</p>
            <script>setTimeout(() => window.location.reload(), 3000);</script>
        </div>
    `);
});

app.listen(port, () => {
    console.log(`Server web berjalan di port ${port}`);
});

// --- 2. LOGIC BOT WHATSAPP ---
async function connectToWhatsApp() {
    const authFolder = 'auth_info_baileys';
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // Kita tampilkan di Web, bukan terminal
        logger: pino({ level: 'silent' }),
        browser: ['Ubuntu', 'Chrome', '20.0.04'], // Penyamaran Browser
        connectTimeoutMs: 60000 
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // Jika ada QR baru, simpan ke variabel global
        if (qr) {
            console.log('✨ QR Code diterima! Silakan buka website Render untuk scan.');
            qrCodeData = qr;
        }

        if (connection === 'close') {
            const reason = lastDisconnect.error?.output?.statusCode;
            console.log('❌ Koneksi terputus. Reason:', reason);
            
            // Reset status
            isConnected = false;
            qrCodeData = null;

            // LOGIKA ANTI-DEATHLOOP
            // Jika error bukan karena Logout (401), berarti sesi rusak/koneksi bermasalah.
            if (reason !== DisconnectReason.loggedOut) {
                console.log('⚠️ Mendeteksi sesi error. Menghapus sesi lama agar fresh...');
                
                try {
                    // Hapus folder sesi secara paksa
                    if (fs.existsSync(authFolder)) {
                        fs.rmSync(authFolder, { recursive: true, force: true });
                        console.log('🗑️ Folder sesi berhasil dihapus.');
                    }
                } catch (e) {
                    console.error('Gagal hapus sesi:', e);
                }

                // Reconnect otomatis
                console.log('🔄 Restarting bot dalam 5 detik...');
                setTimeout(() => connectToWhatsApp(), 5000);
            } else {
                console.log('⛔ Bot Logout. Hapus sesi dan scan ulang.');
                if (fs.existsSync(authFolder)) {
                    fs.rmSync(authFolder, { recursive: true, force: true });
                }
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ Tersambung ke WhatsApp! 🚀');
            isConnected = true;
            qrCodeData = null; // Hapus QR agar tidak muncul lagi di web
        }
    });

    // --- LOGIC MEMBACA PESAN ---
    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message) return;
        if (msg.key.fromMe) return;

        const messageType = Object.keys(msg.message)[0];
        const text = messageType === 'conversation' ? msg.message.conversation : 
                     messageType === 'extendedTextMessage' ? msg.message.extendedTextMessage.text : '';

        // Cek Prefix (.)
        if (!text.startsWith('.')) return;

        const args = text.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        // --- DAFTAR COMMAND ---
        switch (command) {
            case 'ping':
                await sock.sendMessage(msg.key.remoteJid, { text: 'Pong! 🏓' });
                break;

            case 'sticker':
            case 's':
                // 1. Cek apakah ada gambar?
                const isImage = msg.message.imageMessage;
                const isQuotedImage = msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;

                if (!isImage && !isQuotedImage) {
                    await sock.sendMessage(msg.key.remoteJid, { text: 'Kirim gambar dengan caption .sticker atau reply gambar dengan .sticker' });
                    return;
                }

                try {
                    await sock.sendMessage(msg.key.remoteJid, { react: { text: "⏳", key: msg.key } });

                    // 2. Tentukan pesan mana yang mau didownload
                    let messageToDownload;
                    if (isImage) {
                        messageToDownload = msg;
                    } else {
                        // Jika me-reply gambar, kita buat objek pesan palsu agar bisa didownload
                        messageToDownload = {
                            message: msg.message.extendedTextMessage.contextInfo.quotedMessage
                        };
                    }

                    // 3. Download Gambar
                    const buffer = await downloadMediaMessage(
                        messageToDownload,
                        'buffer',
                        { },
                        { logger: pino({ level: 'silent' }) }
                    );

                    // 4. Buat Sticker
                    const sticker = new Sticker(buffer, {
                        pack: 'Bot Sticker',
                        author: 'Bot Render',
                        type: StickerTypes.FULL,
                        quality: 50
                    });

                    // 5. Kirim Sticker
                    await sock.sendMessage(msg.key.remoteJid, await sticker.toMessage());
                    await sock.sendMessage(msg.key.remoteJid, { react: { text: "✅", key: msg.key } });

                } catch (error) {
                    console.error("Gagal membuat sticker:", error);
                    await sock.sendMessage(msg.key.remoteJid, { text: 'Gagal membuat sticker.' });
                }
                break;
        }
    });
}

connectToWhatsApp();