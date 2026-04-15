require('dotenv').config();
const { Telegraf, session, Scenes, Markup } = require('telegraf');
const nodemailer = require('nodemailer');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');
const { ImapFlow } = require('imapflow');

// ==========================================
// DATABASE SETUP (SQLite)
// ==========================================
const db = new sqlite3.Database('./bot_database.db');
const dbRun = promisify(db.run).bind(db);
const dbGet = promisify(db.get).bind(db);
const dbAll = promisify(db.all).bind(db);

async function initDB() {
    await dbRun(`CREATE TABLE IF NOT EXISTS users (
        user_id INTEGER PRIMARY KEY,
        email_user TEXT,
        email_pass TEXT,
        lang_code TEXT DEFAULT 'ID'
    )`);
}
initDB();

// ==========================================
// MULTILINGUAL TEMPLATES
// ==========================================
const templates = {
    ID: {
        name: 'Indonesia 🇮🇩',
        subject: 'login tidak tersedia',
        body: (num) => `Halo Tim Dukungan WhatsApp,\n\nSaya ingin melaporkan masalah terkait nomor WhatsApp saya. Saat mencoba melakukan pendaftaran, setiap kali saya ingin masuk selalu muncul pesan “Login Tidak Tersedia Saat Ini”.\n\nSaya sangat berharap pihak WhatsApp dapat membantu agar saya bisa menggunakan kembali nomor saya ${num} tanpa muncul kendala tersebut.\n\nTerima kasih atas perhatian dan bantuannya.`
    },
    EN: {
        name: 'English 🇺🇸',
        subject: 'Login unavailable at the moment',
        body: (num) => `Hello WhatsApp Support Team,\n\nI am reporting an issue with my account. Every time I try to register or log in, I receive the message "Login unavailable at the moment".\n\nI hope you can help me restore access to my number ${num} without this obstacle.\n\nThank you for your assistance.`
    },
    PT: {
        name: 'Portuguese 🇧🇷',
        subject: 'Login não disponível no momento',
        body: (num) => `Olá Equipe de Suporte do WhatsApp,\n\nEstou relatando um problema com meu número. Sempre que tento entrar, aparece a mensagem "Login não disponível no momento".\n\nEspero que possam me ajudar a voltar a usar meu número ${num} sem esse obstáculo.\n\nObrigado pela atenção e ajuda.`
    },
    ES: {
        name: 'Spanish 🇪🇸',
        subject: 'Inicio de sesión no disponible',
        body: (num) => `Hola Equipo de Soporte de WhatsApp,\n\nQuiero reportar un problema con mi número de WhatsApp. Al intentar registrarme, aparece el mensaje "Inicio de sesión no disponible en este momento".\n\nEspero que puedan ayudarme a recuperar mi número ${num} sin este inconveniente.\n\nGracias por su atención y ayuda.`
    }
};

// ==========================================
// TELEGRAF & UI DASHBOARD LOGIC
// ==========================================
const bot = new Telegraf(process.env.BOT_TOKEN);

const showMainMenu = async (ctx) => {
    const userData = await dbGet('SELECT * FROM users WHERE user_id = ?', [ctx.from.id]);
    const lang = userData?.lang_code || 'ID';
    
    const text = `🖥 <b>DASHBOARD SUPPORT WA</b>\n\n` +
                 `Status: ${userData?.email_user ? '✅ Terhubung' : '❌ Belum Setup'}\n` +
                 `Email: <code>${userData?.email_user || 'Belum diatur'}</code>\n` +
                 `Template: <b>${templates[lang].name}</b>\n\n` +
                 `<i>Sistem memantau balasan dari WhatsApp Support setiap 3 menit.</i>`;
    
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('⚙️ Setup Email & App Password', 'MENU_SETUP')],
        [Markup.button.callback('🌐 Pilih Bahasa Template', 'MENU_LANG')],
        [Markup.button.callback('📨 KIRIM PESAN BANDING', 'MENU_KIRIM')],
        [Markup.button.callback('🗑 Reset Konfigurasi', 'MENU_RESET')]
    ]);

    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard }).catch(() => {});
    } else {
        await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
    }
};

// --- SCENE 1: SETUP KREDENSIAL ---
const setupWizard = new Scenes.WizardScene(
    'SETUP_WIZARD',
    async (ctx) => {
        await ctx.reply('📧 Masukkan Alamat Email Anda (cth: admin@gmail.com):\n\n<i>Ketik /cancel untuk membatalkan</i>', { parse_mode: 'HTML' });
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message?.text === '/cancel') {
            await ctx.reply('❌ Setup dibatalkan.');
            showMainMenu(ctx);
            return ctx.scene.leave();
        }
        ctx.scene.state.email = ctx.message.text.trim();
        await ctx.reply('🔑 Masukkan 16-digit App Password Anda:\n\n<i>Ketik /cancel untuk membatalkan</i>', { parse_mode: 'HTML' });
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message?.text === '/cancel') {
            await ctx.reply('❌ Setup dibatalkan.');
            showMainMenu(ctx);
            return ctx.scene.leave();
        }

        const pass = ctx.message.text.trim();
        const email = ctx.scene.state.email;
        
        // Simpan ke SQLite
        await dbRun(
            'INSERT INTO users (user_id, email_user, email_pass) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET email_user=excluded.email_user, email_pass=excluded.email_pass',
            [ctx.from.id, email, pass]
        );

        await ctx.reply('✅ Kredensial berhasil disimpan dengan aman di database!');
        showMainMenu(ctx);
        return ctx.scene.leave();
    }
);

// --- SCENE 2: KIRIM BANDING ---
const kirimWizard = new Scenes.WizardScene(
    'KIRIM_WIZARD',
    async (ctx) => {
        const user = await dbGet('SELECT * FROM users WHERE user_id = ?', [ctx.from.id]);
        if (!user?.email_user) {
            await ctx.reply('⚠️ Anda belum melakukan setup kredensial email!');
            showMainMenu(ctx);
            return ctx.scene.leave();
        }
        await ctx.reply('📱 Masukkan Nomor WhatsApp yang bermasalah\nFormat: +628123456789\n\n<i>Ketik /cancel untuk membatalkan</i>', { parse_mode: 'HTML' });
        return ctx.wizard.next();
    },
    async (ctx) => {
        const nomor = ctx.message?.text;
        if (nomor === '/cancel') {
            await ctx.reply('❌ Pengiriman dibatalkan.');
            showMainMenu(ctx);
            return ctx.scene.leave();
        }

        if (!/^\+\d+$/.test(nomor)) {
            await ctx.reply('⚠️ Format nomor tidak valid. Pastikan menggunakan kode negara (contoh: +628123456789). Coba masukkan lagi:');
            return;
        }

        const user = await dbGet('SELECT * FROM users WHERE user_id = ?', [ctx.from.id]);
        const lang = user.lang_code || 'ID';
        const template = templates[lang];

        const loading = await ctx.reply('⏳ Menghubungkan ke SMTP dan mengirim email...', { parse_mode: 'HTML' });

        const transporter = nodemailer.createTransport({
            service: 'gmail', // Akan otomatis menyesuaikan jika pakai Gmail
            auth: { user: user.email_user, pass: user.email_pass }
        });

        try {
            await transporter.sendMail({
                from: user.email_user,
                to: 'support@support.whatsapp.com',
                subject: template.subject,
                text: template.body(nomor)
            });
            await ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, null, `✅ <b>BERHASIL!</b>\nEmail untuk nomor <code>${nomor}</code> telah dikirim via <b>${user.email_user}</b> menggunakan template ${template.name}.`, { parse_mode: 'HTML' });
        } catch (e) {
            await ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, null, `❌ <b>GAGAL:</b> ${e.message}`, { parse_mode: 'HTML' });
        }
        
        showMainMenu(ctx);
        return ctx.scene.leave();
    }
);

// --- MIDDLEWARE & ROUTING ---
const stage = new Scenes.Stage([setupWizard, kirimWizard]);
bot.use(session());
bot.use(stage.middleware());

bot.start(showMainMenu);
bot.command('menu', showMainMenu);

bot.action('MENU_SETUP', (ctx) => { ctx.answerCbQuery(); ctx.scene.enter('SETUP_WIZARD'); });
bot.action('MENU_KIRIM', (ctx) => { ctx.answerCbQuery(); ctx.scene.enter('KIRIM_WIZARD'); });

bot.action('MENU_LANG', async (ctx) => {
    ctx.answerCbQuery();
    const buttons = Object.keys(templates).map(code => 
        [Markup.button.callback(templates[code].name, `SET_LANG_${code}`)]
    );
    buttons.push([Markup.button.callback('🔙 Kembali ke Menu Utama', 'BACK')]);
    await ctx.editMessageText('🌐 Pilih Bahasa untuk Template Pesan Dukungan:', Markup.inlineKeyboard(buttons));
});

bot.action(/^SET_LANG_(.+)$/, async (ctx) => {
    const lang = ctx.match[1];
    await dbRun('UPDATE users SET lang_code = ? WHERE user_id = ?', [lang, ctx.from.id]);
    ctx.answerCbQuery(`Bahasa diubah ke ${templates[lang].name}`);
    showMainMenu(ctx);
});

bot.action('MENU_RESET', async (ctx) => {
    await dbRun('DELETE FROM users WHERE user_id = ?', [ctx.from.id]);
    ctx.answerCbQuery('Data konfigurasi berhasil dihapus!');
    showMainMenu(ctx);
});

bot.action('BACK', (ctx) => {
    ctx.answerCbQuery();
    showMainMenu(ctx);
});

// ==========================================
// BACKGROUND WORKER: IMAP DETECT & DELETE
// ==========================================
async function checkWhatsAppReplies() {
    const users = await dbAll("SELECT * FROM users WHERE email_user IS NOT NULL AND email_pass IS NOT NULL");
    if (users.length === 0) return;

    for (const user of users) {
        let imapHost = 'imap.gmail.com';
        if (user.email_user.includes('@yahoo.com')) imapHost = 'imap.mail.yahoo.com';
        else if (user.email_user.includes('@outlook.com') || user.email_user.includes('@hotmail.com')) imapHost = 'outlook.office365.com';

        const client = new ImapFlow({
            host: imapHost,
            port: 993,
            secure: true,
            auth: { user: user.email_user, pass: user.email_pass },
            logger: false 
        });

        try {
            await client.connect();
            let lock = await client.getMailboxLock('INBOX');
            
            try {
                // Cari email dari WA yang belum dibaca
                const messages = client.fetch({ from: 'support@support.whatsapp.com', unseen: true }, { envelope: true });
                let msgCount = 0;

                for await (let msg of messages) {
                    msgCount++;
                    
                    // Notifikasi ke Telegram user
                    await bot.telegram.sendMessage(
                        user.user_id, 
                        `🔔 <b>BALASAN DARI WHATSAPP DITERIMA!</b>\n\n` +
                        `📧 Akun: <code>${user.email_user}</code>\n` +
                        `📝 Subject: <i>${msg.envelope.subject}</i>\n\n` +
                        `🗑 <i>Sistem sedang membersihkan email ini dari server secara permanen...</i>`,
                        { parse_mode: 'HTML' }
                    );

                    // Beri flag terhapus
                    await client.messageFlagsAdd(msg.uid, ['\\Deleted'], { uid: true });
                }

                if (msgCount > 0) {
                    // Eksekusi penghapusan permanen (Expunge)
                    await client.mailboxExpunge();
                }

            } finally {
                lock.release();
            }
            await client.logout();

        } catch (error) {
            console.error(`IMAP Worker Error [${user.email_user}]: ${error.message}`);
        }
    }
}

// Jalankan IMAP Worker setiap 3 Menit (180000 ms)
setInterval(checkWhatsAppReplies, 3 * 60 * 1000);

// ==========================================
// STARTING POINT
// ==========================================
bot.launch().then(() => {
    console.log('🤖 Bot WA Support Multi-Account (SQLite + IMAP) Berjalan...');
    console.log('🔄 Background Worker disiapkan untuk interval 3 menit.');
});

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
