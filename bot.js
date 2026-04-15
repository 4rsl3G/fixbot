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
// 2. CORE SYSTEM HELPERS
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
// 3. ENTERPRISE DASHBOARD UI
// ==========================================
const bot = new Telegraf(process.env.BOT_TOKEN);
const dashboardMsgId = new Map();

const getDashboardUI = async (ctx) => {
    const userData = await dbGet('SELECT * FROM users WHERE user_id = ?', [ctx.from.id]);
    
    // Tampilan ala Terminal / Enterprise SaaS
    let text = `<b>⌬ FIX MERAH | PANSA GROUP ⌬</b>\n` +
               `━━━━━━━━━━━━━━━━━━━━━━\n` +
               `<b>[ SYSTEM STATUS ]</b>\n` +
               `⊛ Status  : ${userData?.email_user ? '🟢 <i>Active & Ready</i>' : '🔴 <i>Awaiting Setup</i>'}\n` +
               `⊛ Account : <code>${userData?.email_user || 'UNREGISTERED'}</code>\n` +
               `⊛ Gateway : <code>${userData?.smtp_host || 'N/A'}</code>\n` +
               `━━━━━━━━━━━━━━━━━━━━━━\n` +
               `<i>Standby for command execution...</i>`;
    
    // Layout Tombol Modern: 1 Primary (Lebar), 2 Secondary (Grid 2x2)
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('⚡ FIX MERAH', 'MENU_KIRIM')],
        [
            Markup.button.callback('⚙️ Setup Gateway', 'MENU_SETUP'),
            Markup.button.callback('🛡️ System Info', 'MENU_INFO')
        ],
        [
            Markup.button.callback('🗑️ Purge Data', 'MENU_RESET'),
            Markup.button.callback('💎 Premium', 'MENU_PREMIUM')
        ]
    ]);

    return { text, keyboard };
};

const renderDashboard = async (ctx) => {
    const ui = await getDashboardUI(ctx);
    const userId = ctx.from.id;

    if (dashboardMsgId.has(userId)) {
        try {
            await ctx.telegram.editMessageText(ctx.chat.id, dashboardMsgId.get(userId), null, ui.text, { parse_mode: 'HTML', ...ui.keyboard });
            return;
        } catch (e) { /* Abaikan jika pesan terhapus, lanjut buat baru */ }
    }

    const msg = await ctx.reply(ui.text, { parse_mode: 'HTML', ...ui.keyboard });
    dashboardMsgId.set(userId, msg.message_id);
};

// ==========================================
// 4. INTERACTIVE TERMINAL SCENES
// ==========================================
const setupWizard = new Scenes.WizardScene(
    'SETUP_WIZARD',
    async (ctx) => {
        const text = `<b>[ INITIALIZE SETUP ]</b>\n━━━━━━━━━━━━━━━━━━━━━━\n> Please enter your <b>Email Address</b>:\n\n<i>*Awaiting input...</i>`;
        await ctx.telegram.editMessageText(ctx.chat.id, dashboardMsgId.get(ctx.from.id), null, text, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('✖️ Cancel Operation', 'BACK')]]) }).catch(()=>{});
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message?.text) {
            await ctx.deleteMessage().catch(() => {}); 
            ctx.scene.state.email = ctx.message.text.trim();
            
            const text = `<b>[ AUTHENTICATION ]</b>\n━━━━━━━━━━━━━━━━━━━━━━\nTarget: <code>${ctx.scene.state.email}</code>\n\n> Please enter your <b>App Password</b>:\n\n<i>*Awaiting input...</i>`;
            await ctx.telegram.editMessageText(ctx.chat.id, dashboardMsgId.get(ctx.from.id), null, text, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('✖️ Cancel Operation', 'BACK')]]) }).catch(()=>{});
            return ctx.wizard.next();
        }
    },
    async (ctx) => {
        if (ctx.message?.text) {
            await ctx.deleteMessage().catch(() => {});
            ctx.scene.state.pass = ctx.message.text.trim();
            const email = ctx.scene.state.email;
            const hosts = getMailHosts(email);
            
            if (hosts) {
                await dbRun(
                    'INSERT INTO users (user_id, email_user, email_pass, imap_host, smtp_host) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET email_user=excluded.email_user, email_pass=excluded.email_pass, imap_host=excluded.imap_host, smtp_host=excluded.smtp_host',
                    [ctx.from.id, email, ctx.scene.state.pass, hosts.imap, hosts.smtp]
                );
                await ctx.telegram.editMessageText(ctx.chat.id, dashboardMsgId.get(ctx.from.id), null, `✅ <b>[ SUCCESS ]</b>\nGateway locked to <code>${hosts.smtp}</code>.`, { parse_mode: 'HTML' }).catch(()=>{});
                await delay(2000);
                renderDashboard(ctx);
                return ctx.scene.leave();
            } else {
                await ctx.telegram.editMessageText(ctx.chat.id, dashboardMsgId.get(ctx.from.id), null, `🌐 <b>[ CUSTOM DOMAIN ]</b>\n> Enter custom <b>SMTP Server</b> address:`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('✖️ Cancel Operation', 'BACK')]]) }).catch(()=>{});
                return ctx.wizard.next();
            }
        }
    },
    async (ctx) => {
        if (ctx.message?.text) {
            await ctx.deleteMessage().catch(() => {});
            ctx.scene.state.smtp = ctx.message.text.trim();
            
            await dbRun(
                'INSERT INTO users (user_id, email_user, email_pass, imap_host, smtp_host) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET email_user=excluded.email_user, email_pass=excluded.email_pass, imap_host=excluded.imap_host, smtp_host=excluded.smtp_host',
                [ctx.from.id, ctx.scene.state.email, ctx.scene.state.pass, 'custom-imap', ctx.scene.state.smtp]
            );

            await ctx.telegram.editMessageText(ctx.chat.id, dashboardMsgId.get(ctx.from.id), null, '✅ <b>[ SUCCESS ]</b> Custom node secured.', { parse_mode: 'HTML' }).catch(()=>{});
            await delay(2000);
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
            await ctx.answerCbQuery('⚠️ [ ERROR ] Gateway not configured. Setup required.', { show_alert: true });
            return ctx.scene.leave();
        }
        const text = `<b>[ TARGET ACQUISITION ]</b>\n━━━━━━━━━━━━━━━━━━━━━━\n> Enter target <b>WhatsApp Number</b>.\n<i>(Format: +628...)</i>\n\n<i>*Awaiting input...</i>`;
        await ctx.telegram.editMessageText(ctx.chat.id, dashboardMsgId.get(ctx.from.id), null, text, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('✖️ Abort Execution', 'BACK')]]) }).catch(()=>{});
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message?.text) {
            await ctx.deleteMessage().catch(() => {});
            const nomor = ctx.message.text.trim();

            if (!/^\+\d+$/.test(nomor)) {
                const err = await ctx.reply('⚠️ <b>[ FATAL ]</b> Invalid format. Use country code (+62).', { parse_mode: 'HTML' });
                await delay(2500);
                await ctx.deleteMessage(err.message_id).catch(() => {});
                return;
            }

            const user = await dbGet('SELECT * FROM users WHERE user_id = ?', [ctx.from.id]);
            await ctx.telegram.editMessageText(ctx.chat.id, dashboardMsgId.get(ctx.from.id), null, '⏳ <i>[ EXECUTING ] Routing payload via SMTP...</i>', { parse_mode: 'HTML' }).catch(()=>{});

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
                await ctx.telegram.editMessageText(ctx.chat.id, dashboardMsgId.get(ctx.from.id), null, `✅ <b>[ TRANSMISSION COMPLETE ]</b>\nPayload successfully delivered for <code>${nomor}</code>.`, { parse_mode: 'HTML' }).catch(()=>{});
            } catch (e) {
                await ctx.telegram.editMessageText(ctx.chat.id, dashboardMsgId.get(ctx.from.id), null, `❌ <b>[ TRANSMISSION FAILED ]</b>\n<code>${e.message}</code>`, { parse_mode: 'HTML' }).catch(()=>{});
            }
            
            await delay(3500);
            renderDashboard(ctx);
            return ctx.scene.leave();
        }
    }
);

// ==========================================
// 5. ROUTING & EVENT HANDLERS
// ==========================================
const stage = new Scenes.Stage([setupWizard, kirimWizard]);
bot.use(session());
bot.use(stage.middleware());

bot.start(renderDashboard);
bot.command('menu', renderDashboard);

// Action Buttons
bot.action('MENU_SETUP', (ctx) => { ctx.answerCbQuery(); ctx.scene.enter('SETUP_WIZARD'); });
bot.action('MENU_KIRIM', (ctx) => { ctx.answerCbQuery(); ctx.scene.enter('KIRIM_WIZARD'); });

bot.action('MENU_INFO', async (ctx) => {
    ctx.answerCbQuery();
    const user = await dbGet('SELECT * FROM users WHERE user_id = ?', [ctx.from.id]);
    const info = `🛡️ <b>[ SYSTEM INFO ]</b>\nNode ID: <code>${ctx.from.id}</code>\nSaaS Architecture: Node.js + Telegraf\nMemory State: Optimal`;
    await ctx.reply(info, { parse_mode: 'HTML' }).then(m => setTimeout(() => ctx.deleteMessage(m.message_id).catch(()=>{}), 5000));
});

bot.action('MENU_RESET', async (ctx) => {
    await dbRun('DELETE FROM users WHERE user_id = ?', [ctx.from.id]);
    ctx.answerCbQuery('🗑️ [ PURGED ] System data wiped.', { show_alert: true });
    renderDashboard(ctx);
});

bot.action('MENU_PREMIUM', (ctx) => {
    ctx.answerCbQuery('💎 License Active: Authorized Node', { show_alert: true });
});

bot.action('BACK', async (ctx) => {
    ctx.answerCbQuery('Action aborted.');
    if (ctx.scene.current) await ctx.scene.leave();
    renderDashboard(ctx);
});

// Auto-delete stray messages
bot.on('message', async (ctx, next) => {
    if (!ctx.scene.current) {
        await ctx.deleteMessage().catch(() => {});
    }
    return next();
});

bot.launch().then(() => console.log('[SYSTEM] Enterprise SaaS Dashboard Active.'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
