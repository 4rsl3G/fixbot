require('dotenv').config();
const { Telegraf, session, Scenes, Markup } = require('telegraf');
const nodemailer = require('nodemailer');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');

// ==========================================
// 1. DATABASE SETUP
// ==========================================
const db = new sqlite3.Database('./bot_database.db');
const dbRun = promisify(db.run).bind(db);
const dbGet = promisify(db.get).bind(db);

async function initDB() {
    await dbRun(`CREATE TABLE IF NOT EXISTS users (
        user_id INTEGER PRIMARY KEY,
        email_user TEXT,
        email_pass TEXT,
        imap_host TEXT,
        smtp_host TEXT
    )`);
}
initDB();

// ==========================================
// 2. HELPER & DELAY
// ==========================================
function getMailHosts(email) {
    const domain = email.split('@')[1]?.toLowerCase();
    if (domain === 'gmail.com') return { imap: 'imap.gmail.com', smtp: 'smtp.gmail.com' };
    if (domain === 'yahoo.com' || domain === 'ymail.com') return { imap: 'imap.mail.yahoo.com', smtp: 'smtp.mail.yahoo.com' };
    if (domain === 'outlook.com' || domain === 'hotmail.com') return { imap: 'outlook.office365.com', smtp: 'smtp-mail.outlook.com' };
    return null; 
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const templateEmail = (num) => `Halo Tim Dukungan WhatsApp,\n\nSaya ingin melaporkan masalah terkait nomor WhatsApp saya. Saat mencoba melakukan pendaftaran, setiap kali saya ingin masuk selalu muncul pesan “Login Tidak Tersedia Saat Ini”.\n\nSaya sangat berharap pihak WhatsApp dapat membantu agar saya bisa menggunakan kembali nomor saya ${num} tanpa muncul kendala tersebut.\n\nTerima kasih atas perhatian dan bantuannya.`;

// ==========================================
// 3. DASHBOARD ENGINE (REPLY KEYBOARD)
// ==========================================
const bot = new Telegraf(process.env.BOT_TOKEN);

// Variabel untuk menyimpan ID pesan Dashboard agar bisa di-edit (SPA Mode)
const dashboardMsgId = new Map();

const getDashboardText = async (ctx) => {
    const userData = await dbGet('SELECT * FROM users WHERE user_id = ?', [ctx.from.id]);
    
    let text = `⬛️ <b>WA SUPPORT WORKSPACE</b>\n` +
               `━━━━━━━━━━━━━━━━━━━━━━\n` +
               `<b>Sistem   :</b> ${userData?.email_user ? '🟢 Siap Operasi' : '🔴 Menunggu Setup'}\n` +
               `<b>Akun     :</b> <code>${userData?.email_user || 'Kosong'}</code>\n`;
               
    if (userData?.email_user) {
        text += `<b>SMTP     :</b> <code>${userData.smtp_host}</code>\n`;
    }

    text += `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `<i>Pilih menu di bawah ini:</i>`;
    return text;
};

// Pembuatan Reply Keyboard (Tombol Bawah Persis Seperti Gambar)
const mainKeyboard = Markup.keyboard([
    ['🚀 FIX NOMOR', '👑 PREMIUM'],
    ['📧 KELOLA EMAIL', '🤝 SHARING']
]).resize(); // resize() wajib agar tombol proporsional dan rapi

const renderDashboard = async (ctx) => {
    const text = await getDashboardText(ctx);
    const userId = ctx.from.id;

    // Jika dashboard sudah ada, edit saja agar tidak spam chat
    if (dashboardMsgId.has(userId)) {
        try {
            await ctx.telegram.editMessageText(ctx.chat.id, dashboardMsgId.get(userId), null, text, { parse_mode: 'HTML' });
            return;
        } catch (e) {
            // Jika gagal edit (misal terhapus), lanjut kirim baru
        }
    }

    // Kirim pesan baru sekaligus memunculkan Reply Keyboard di bawah layar
    const msg = await ctx.reply(text, { parse_mode: 'HTML', ...mainKeyboard });
    dashboardMsgId.set(userId, msg.message_id);
};

// ==========================================
// 4. SCENES WIZARD
// ==========================================
const setupWizard = new Scenes.WizardScene(
    'SETUP_WIZARD',
    async (ctx) => {
        const text = `🟢 <b>SETUP KREDENSIAL</b>\n━━━━━━━━━━━━━━━━━━━━━━\nSilakan ketik <b>Alamat Email</b> Anda.\n\n<i>(Ketik "Batal" untuk kembali)</i>`;
        await ctx.telegram.editMessageText(ctx.chat.id, dashboardMsgId.get(ctx.from.id), null, text, { parse_mode: 'HTML' }).catch(()=>{});
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message?.text) {
            await ctx.deleteMessage().catch(() => {}); 
            if (ctx.message.text.toLowerCase() === 'batal') return cancelScene(ctx);

            ctx.scene.state.email = ctx.message.text.trim();
            const text = `🟢 <b>SETUP KREDENSIAL</b>\n━━━━━━━━━━━━━━━━━━━━━━\nSilakan ketik <b>App Password</b> Anda.`;
            await ctx.telegram.editMessageText(ctx.chat.id, dashboardMsgId.get(ctx.from.id), null, text, { parse_mode: 'HTML' }).catch(()=>{});
            return ctx.wizard.next();
        }
    },
    async (ctx) => {
        if (ctx.message?.text) {
            await ctx.deleteMessage().catch(() => {});
            if (ctx.message.text.toLowerCase() === 'batal') return cancelScene(ctx);

            ctx.scene.state.pass = ctx.message.text.trim();
            const email = ctx.scene.state.email;
            const hosts = getMailHosts(email);
            
            if (hosts) {
                await dbRun(
                    'INSERT INTO users (user_id, email_user, email_pass, imap_host, smtp_host) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET email_user=excluded.email_user, email_pass=excluded.email_pass, imap_host=excluded.imap_host, smtp_host=excluded.smtp_host',
                    [ctx.from.id, email, ctx.scene.state.pass, hosts.imap, hosts.smtp]
                );
                await ctx.telegram.editMessageText(ctx.chat.id, dashboardMsgId.get(ctx.from.id), null, `✅ <b>Tersimpan!</b> Menggunakan server <code>${hosts.smtp}</code>.`, { parse_mode: 'HTML' }).catch(()=>{});
                await delay(1500);
                renderDashboard(ctx);
                return ctx.scene.leave();
            } else {
                await ctx.telegram.editMessageText(ctx.chat.id, dashboardMsgId.get(ctx.from.id), null, `🌐 <b>Domain Custom</b>\nKetik alamat server <b>SMTP</b>:`, { parse_mode: 'HTML' }).catch(()=>{});
                return ctx.wizard.next();
            }
        }
    },
    async (ctx) => {
        if (ctx.message?.text) {
            await ctx.deleteMessage().catch(() => {});
            if (ctx.message.text.toLowerCase() === 'batal') return cancelScene(ctx);

            ctx.scene.state.smtp = ctx.message.text.trim();
            await dbRun(
                'INSERT INTO users (user_id, email_user, email_pass, imap_host, smtp_host) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET email_user=excluded.email_user, email_pass=excluded.email_pass, imap_host=excluded.imap_host, smtp_host=excluded.smtp_host',
                [ctx.from.id, ctx.scene.state.email, ctx.scene.state.pass, 'custom-imap', ctx.scene.state.smtp]
            );

            await ctx.telegram.editMessageText(ctx.chat.id, dashboardMsgId.get(ctx.from.id), null, '✅ <b>Data SMTP disimpan!</b>', { parse_mode: 'HTML' }).catch(()=>{});
            await delay(1500);
            renderDashboard(ctx);
            return ctx.scene.leave();
        }
    }
);

const kirimWizard = new Scenes.WizardScene(
    'KIRIM_WIZARD',
    async (ctx) => {
        const user = await dbGet('SELECT * FROM users WHERE user_id = ?', [ctx.from.id]);
        if (!user?.email_user) {
            await ctx.reply('⚠️ Setup kelola email dulu!').then(m => setTimeout(() => ctx.deleteMessage(m.message_id).catch(()=>{}), 2000));
            return ctx.scene.leave();
        }
        const text = `🔵 <b>KIRIM BANDING BARU</b>\n━━━━━━━━━━━━━━━━━━━━━━\nKetik <b>Nomor WhatsApp</b> target.\n\n<i>Format: +628123456789</i>\n<i>(Ketik "Batal" untuk kembali)</i>`;
        await ctx.telegram.editMessageText(ctx.chat.id, dashboardMsgId.get(ctx.from.id), null, text, { parse_mode: 'HTML' }).catch(()=>{});
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message?.text) {
            await ctx.deleteMessage().catch(() => {});
            if (ctx.message.text.toLowerCase() === 'batal') return cancelScene(ctx);

            const nomor = ctx.message.text.trim();
            if (!/^\+\d+$/.test(nomor)) {
                const err = await ctx.reply('⚠️ <b>Format Invalid!</b> Gunakan kode negara (+62).', { parse_mode: 'HTML' });
                await delay(2000);
                await ctx.deleteMessage(err.message_id).catch(() => {});
                return;
            }

            const user = await dbGet('SELECT * FROM users WHERE user_id = ?', [ctx.from.id]);
            await ctx.telegram.editMessageText(ctx.chat.id, dashboardMsgId.get(ctx.from.id), null, '⏳ <i>Memproses payload SMTP...</i>', { parse_mode: 'HTML' }).catch(()=>{});

            const isOutlook = user.smtp_host.includes('outlook') || user.smtp_host.includes('office365');
            const transporter = nodemailer.createTransport({
                host: user.smtp_host,
                port: isOutlook ? 587 : 465,
                secure: !isOutlook,
                auth: { user: user.email_user, pass: user.email_pass }
            });

            try {
                await transporter.sendMail({
                    from: user.email_user,
                    to: 'support@support.whatsapp.com',
                    subject: 'login tidak tersedia',
                    text: templateEmail(nomor)
                });
                await delay(3000);
                await ctx.telegram.editMessageText(ctx.chat.id, dashboardMsgId.get(ctx.from.id), null, `✅ <b>TRANSMISI SUKSES</b>\nEmail banding untuk <code>${nomor}</code> terkirim.`, { parse_mode: 'HTML' }).catch(()=>{});
            } catch (e) {
                await ctx.telegram.editMessageText(ctx.chat.id, dashboardMsgId.get(ctx.from.id), null, `❌ <b>TRANSMISI GAGAL:</b>\n<code>${e.message}</code>`, { parse_mode: 'HTML' }).catch(()=>{});
            }
            
            await delay(3000);
            renderDashboard(ctx);
            return ctx.scene.leave();
        }
    }
);

const cancelScene = async (ctx) => {
    await ctx.scene.leave();
    renderDashboard(ctx);
};

// ==========================================
// 5. ROUTING & HANDLERS
// ==========================================
const stage = new Scenes.Stage([setupWizard, kirimWizard]);
bot.use(session());
bot.use(stage.middleware());

bot.start(renderDashboard);

// Handler untuk tombol Reply Keyboard
bot.hears('🚀 FIX NOMOR', async (ctx) => {
    await ctx.deleteMessage().catch(() => {}); // Hapus teks tombol yang terkirim
    ctx.scene.enter('KIRIM_WIZARD');
});

bot.hears('📧 KELOLA EMAIL', async (ctx) => {
    await ctx.deleteMessage().catch(() => {});
    ctx.scene.enter('SETUP_WIZARD');
});

bot.hears('🤝 SHARING', async (ctx) => {
    await ctx.deleteMessage().catch(() => {});
    await dbRun('DELETE FROM users WHERE user_id = ?', [ctx.from.id]);
    const notif = await ctx.reply('🔴 Data berhasil dihapus!');
    await delay(1500);
    await ctx.deleteMessage(notif.message_id).catch(()=>{});
    renderDashboard(ctx);
});

bot.hears('👑 PREMIUM', async (ctx) => {
    await ctx.deleteMessage().catch(() => {});
    const notif = await ctx.reply('👑 Anda masuk menggunakan lisensi PansaGroup.');
    await delay(2000);
    await ctx.deleteMessage(notif.message_id).catch(()=>{});
});

// Bersihkan teks bebas dari user jika mengetik sembarangan
bot.on('message', async (ctx, next) => {
    if (!ctx.scene.current) {
        await ctx.deleteMessage().catch(() => {});
    }
    return next();
});

bot.launch().then(() => console.log('[SYSTEM] 2x2 Reply Keyboard UI Active.'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
