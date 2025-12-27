const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// --- 1. MEMBUAT SERVER WEB PANCINGAN AGAR RENDER TIDAK MATI ---
app.get('/', (req, res) => {
    res.send('Bot WhatsApp sedang berjalan! 🤖');
});

app.listen(port, () => {
    console.log(`Server web berjalan di port ${port}`);
});

// --- 2. LOGIC BOT WHATSAPP ---
async function connectToWhatsApp() {
    // Menyiapkan folder auth (akan hilang saat restart di Render Free, tapi cukup untuk tes)
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true, // QR akan muncul di Log Render
        logger: pino({ level: 'silent' }), // Supaya log tidak berisik
        browser: ["Bot Render", "Chrome", "1.0.0"]
    });

    // Update credential jika ada perubahan
    sock.ev.on('creds.update', saveCreds);

    // Cek koneksi
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus karena:', lastDisconnect.error, ', Reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('Tersambung ke WhatsApp! 🚀');
        }
    });

    // Membaca pesan
    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message) return;
        
        // Ambil isi pesan (text)
        const messageType = Object.keys(msg.message)[0];
        const text = messageType === 'conversation' ? msg.message.conversation : 
                     messageType === 'extendedTextMessage' ? msg.message.extendedTextMessage.text : '';

        // Auto Reply Sederhana
        if (text.toLowerCase() === 'ping') {
            await sock.sendMessage(msg.key.remoteJid, { text: 'Pong dari Server Render! 🏓' });
        }
    });
}

connectToWhatsApp();