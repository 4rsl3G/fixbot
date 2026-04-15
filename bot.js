require('dotenv').config();
const { Telegraf, session, Scenes, Markup } = require('telegraf');
const nodemailer = require('nodemailer');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');
const { ImapFlow } = require('imapflow');

// ==========================================
// 1. DATABASE SETUP (SQLite)
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
// 2. MULTILINGUAL TEMPLATES
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
// 3. UI ENGINE & NAVIGATION
// ==========================================
const bot = new Telegraf(process.env.BOT_TOKEN);

const getDashboardUI = async (ctx) => {
    const userData = await dbGet('SELECT * FROM users WHERE user_id = ?', [ctx.from.id]);
    const lang = userData?.lang_code || 'ID';
    
    const text = `🖥 <b>WA SUPPORT WORKSPACE</b>\n` +
                 `━━━━━━━━━━━━━━━━━━━━━━\n` +
                 `<b>Status Koneksi :</b> ${userData?.email_user ? '🟢 Terhubung' : '🔴 Belum Konfigurasi'}\n` +
                 `<b>Akun Email     :</b> <code>${userData?.email_user || '-'}</code>\n` +
                 `<b>Bahasa Aktif   :</b> ${templates[lang].name}\n` +
                 `━━━━━━━━━━━━━━━━━━━━━━\n` +
                 `<i>Sistem polling IMAP aktif (interval 3m)</i>`;
    
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('⚙️ Konfigurasi Email (SMTP)', 'MENU_SETUP')],
        [Markup.button.callback('🌐 Ubah Bahasa Template', 'MENU_LANG')],
        [Markup.button.callback('🚀 KIRIM BANDING BARU', 'MENU_KIRIM')],
        [Markup.button.callback('🗑️ Hapus Konfigurasi Akun', 'MENU_RESET')]
    ]);

    return { text, keyboard };
};

const renderDashboard = async (ctx) => {
    const ui = await getDashboardUI(ctx);
    if (ctx.callbackQuery) {
        await ctx.editMessageText(ui.text, { parse_mode: 'HTML', ...ui.keyboard }).catch(() => {});
    } else {
        await ctx.reply(ui.text, { parse_mode: 'HTML', ...ui.keyboard });
    }
};

// ==========================================
// 4. SCENES (INTERACTIVE WIZARDS)
// ==========================================

// --- SCENE 1: SETUP KREDENSIAL ---
const setupWizard = new Scenes.WizardScene(
    'SETUP_WIZARD',
    async (ctx) => {
        await ctx.editMessageText(
            `⚙️ <b>SETUP KREDENSIAL (1/2)</b>\n━━━━━━━━━━━━━━━━━━━━━━\nSilakan balas pesan ini dengan <b>Alamat Email</b> Anda.\n\n<i>Contoh: admin@gmail.com</i>`, 
            { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Batal', 'BACK')]]) }
        );
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message?.text) {
            ctx.scene.state.email = ctx.message.text.trim();
            await ctx.reply(
                `⚙️ <b>SETUP KREDENSIAL (2/2)</b>\n━━━━━━━━━━━━━━━━━━━━━━\nSilakan balas dengan <b>16-digit App Password</b> Anda.`, 
                { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Batal', 'BACK')]]) }
            );
            return ctx.wizard.next();
        }
    },
    async (ctx) => {
        if (ctx.message?.text) {
            const pass = ctx.message.text.trim();
            const email = ctx.scene.state.email;
            
            await dbRun(
                'INSERT INTO users (user_id, email_user, email_pass) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET email_user=excluded.email_user, email_pass=excluded.email_pass',
                [ctx.from.id, email, pass]
            );

            await ctx.reply('✅ <b>Data berhasil dienkripsi dan disimpan.</b>', { parse_mode: 'HTML' });
            renderDashboard(ctx);
            return ctx.scene.leave();
        }
    }
);

// --- SCENE 2: KIRIM BANDING ---
const kirimWizard = new Scenes.WizardScene(
    'KIRIM_WIZARD',
    async (ctx) => {
        const user = await dbGet('SELECT * FROM users WHERE user_id = ?', [ctx.from.id]);
        if (!user?.email_user) {
            await ctx.answerCbQuery('⚠️ Anda belum melakukan konfigurasi email!', { show_alert: true });
            return ctx.scene.leave();
        }
        await ctx.editMessageText(
            `🚀 <b>KIRIM BANDING BARU</b>\n━━━━━━━━━━━━━━━━━━━━━━\nSilakan balas pesan ini dengan <b>Nomor WhatsApp</b> target.\n\n<i>Format Wajib: +628123456789</i>`, 
            { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Batal', 'BACK')]]) }
        );
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message?.text) {
            const nomor = ctx.message.text.trim();

            if (!/^\+\d+$/.test(nomor)) {
                await ctx.reply('⚠️ <b>Format Invalid!</b> Harap gunakan kode negara (contoh: +62...). Coba masukkan lagi:', { parse_mode: 'HTML' });
                return;
            }

            const user = await dbGet('SELECT * FROM users WHERE user_id = ?', [ctx.from.id]);
            const lang = user.lang_code || 'ID';
            const template = templates[lang];

            const loading = await ctx.reply('⏳ <i>Menjalankan SMTP handshake dan merakit payload...</i>', { parse_mode: 'HTML' });

            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: { user: user.email_user, pass: user.email_pass }
            });

            try {
                await transporter.sendMail({
                    from: user.email_user,
                    to: 'support@support.whatsapp.com',
                    subject: template.subject,
                    text: template.body(nomor)
                });
                await ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, null, `✅ <b>TRANSMISI SUKSES</b>\nPayload terkirim ke WhatsApp Support untuk <code>${nomor}</code>.`, { parse_mode: 'HTML' });
            } catch (e) {
                await ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, null, `❌ <b>TRANSMISI GAGAL:</b>\n<code>${e.message}</code>`, { parse_mode: 'HTML' });
            }
            
            renderDashboard(ctx);
            return ctx.scene.leave();
        }
    }
);

// ==========================================
// 5. BOT ROUTING & MIDDLEWARE
// ==========================================
const stage = new Scenes.Stage([setupWizard, kirimWizard]);
bot.use(session());
bot.use(stage.middleware());

bot.start(renderDashboard);
bot.command('menu', renderDashboard);

// Global Actions
bot.action('MENU_SETUP', (ctx) => { ctx.answerCbQuery(); ctx.scene.enter('SETUP_WIZARD'); });
bot.action('MENU_KIRIM', (ctx) => { ctx.answerCbQuery(); ctx.scene.enter('KIRIM_WIZARD'); });

bot.action('MENU_LANG', async (ctx) => {
    ctx.answerCbQuery();
    const buttons = Object.keys(templates).map(code => 
        [Markup.button.callback(templates[code].name, `SET_LANG_${code}`)]
    );
    buttons.push([Markup.button.callback('⬅️ Kembali ke Dashboard', 'BACK')]);
    
    await ctx.editMessageText(
        `🌐 <b>PENGATURAN BAHASA TEMPLATE</b>\n━━━━━━━━━━━━━━━━━━━━━━\nPilih bahasa yang akan digunakan untuk payload email selanjutnya:`, 
        { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) }
    );
});

bot.action(/^SET_LANG_(.+)$/, async (ctx) => {
    const lang = ctx.match[1];
    await dbRun('UPDATE users SET lang_code = ? WHERE user_id = ?', [lang, ctx.from.id]);
    ctx.answerCbQuery(`✅ Bahasa diperbarui ke ${templates[lang].name}`);
    renderDashboard(ctx);
});

bot.action('MENU_RESET', async (ctx) => {
    await dbRun('DELETE FROM users WHERE user_id = ?', [ctx.from.id]);
    ctx.answerCbQuery('🗑️ Kredensial telah dihapus dari sistem.', { show_alert: true });
    renderDashboard(ctx);
});

bot.action('BACK', async (ctx) => {
    ctx.answerCbQuery();
    if (ctx.scene.current) await ctx.scene.leave();
    renderDashboard(ctx);
});

// ==========================================
// 6. BACKGROUND WORKER: IMAP POLLING (ANTI-SPAM)
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
                // Fetch email WA yang statusnya UNREAD
                const messages = client.fetch({ from: 'support@support.whatsapp.com', unseen: true }, { envelope: true });
                let msgCount = 0;

                for await (let msg of messages) {
                    msgCount++;
                    
                    // Notifikasi sukses
                    await bot.telegram.sendMessage(
                        user.user_id, 
                        `🔔 <b>BALASAN DITERIMA</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `<b>Akun:</b> <code>${user.email_user}</code>\n` +
                        `<b>Subjek:</b> <i>${msg.envelope.subject}</i>\n━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `🗑 <i>Membersihkan thread dari server...</i>`,
                        { parse_mode: 'HTML' }
                    );

                    // ANTI SPAM FIX: Tandai Seen (Terbaca) sekaligus Deleted (Dihapus)
                    await client.messageFlagsAdd(msg.uid, ['\\Seen', '\\Deleted'], { uid: true });
                }

                if (msgCount > 0) {
                    // Eksekusi penghapusan permanen dari server
                    await client.mailboxExpunge();
                }

            } finally {
                lock.release();
            }
            await client.logout();

        } catch (error) {
            console.error(`[Worker Error] ${user.email_user}: ${error.message}`);
        }
    }
}

// Interval Polling: 3 Menit
setInterval(checkWhatsAppReplies, 3 * 60 * 1000);

// ==========================================
// 7. INITIALIZATION
// ==========================================
bot.launch().then(() => {
    console.log('[SYSTEM] Node Workspace Automation Active.');
    console.log('[SYSTEM] UI Engine Loaded. IMAP Polling started (180s interval).');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
