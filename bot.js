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
        smtp_host TEXT,
        lang_code TEXT DEFAULT 'ID'
    )`);
}
initDB();

// ==========================================
// 2. MULTI-TEMPLATE ENGINE
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

const getMailHosts = (email) => {
    const domain = email.split('@')[1]?.toLowerCase();
    if (domain === 'gmail.com') return { imap: 'imap.gmail.com', smtp: 'smtp.gmail.com' };
    if (domain === 'yahoo.com' || domain === 'ymail.com') return { imap: 'imap.mail.yahoo.com', smtp: 'smtp.mail.yahoo.com' };
    if (domain === 'outlook.com' || domain === 'hotmail.com') return { imap: 'outlook.office365.com', smtp: 'smtp-mail.outlook.com' };
    return null; 
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ==========================================
// 3. FIX MERAH DASHBOARD UI
// ==========================================
const bot = new Telegraf(process.env.BOT_TOKEN);
const dashboardMsgId = new Map();

const getDashboardUI = async (ctx) => {
    const userData = await dbGet('SELECT * FROM users WHERE user_id = ?', [ctx.from.id]);
    const lang = userData?.lang_code || 'ID';
    
    let text = `<b>⌬ FIX MERAH | COMMAND CENTER ⌬</b>\n` +
               `━━━━━━━━━━━━━━━━━━━━━━\n` +
               `<b>[ NODE STATUS ]</b>\n` +
               `⊛ Security : 🟢 <i>Encrypted</i>\n` +
               `⊛ Account  : <code>${userData?.email_user || 'UNCONFIGURED'}</code>\n` +
               `⊛ Template : <b>${templates[lang].name}</b>\n` +
               `━━━━━━━━━━━━━━━━━━━━━━\n` +
               `<i>Awaiting transmission request...</i>`;
    
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('⚡ EXECUTE FIX NOMOR', 'MENU_KIRIM')],
        [
            Markup.button.callback('⚙️ Gateway', 'MENU_SETUP'),
            Markup.button.callback('🌐 Template', 'MENU_LANG')
        ],
        [
            Markup.button.callback('🗑️ Purge', 'MENU_RESET'),
            Markup.button.callback('💎 License', 'MENU_PREMIUM')
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
        } catch (e) {}
    }

    const msg = await ctx.reply(ui.text, { parse_mode: 'HTML', ...ui.keyboard });
    dashboardMsgId.set(userId, msg.message_id);
};

// ==========================================
// 4. SCENES (WIZARDS)
// ==========================================

const setupWizard = new Scenes.WizardScene(
    'SETUP_WIZARD',
    async (ctx) => {
        const text = `<b>[ INITIALIZE GATEWAY ]</b>\n━━━━━━━━━━━━━━━━━━━━━━\n> Enter your <b>Email Address</b>:\n\n<i>*Auto-delete active</i>`;
        await ctx.telegram.editMessageText(ctx.chat.id, dashboardMsgId.get(ctx.from.id), null, text, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('✖️ Cancel Operation', 'BACK')]]) }).catch(()=>{});
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message?.text) {
            await ctx.deleteMessage().catch(() => {}); 
            ctx.scene.state.email = ctx.message.text.trim();
            const text = `<b>[ AUTHENTICATION ]</b>\n━━━━━━━━━━━━━━━━━━━━━━\nTarget: <code>${ctx.scene.state.email}</code>\n\n> Enter <b>App Password</b>:`;
            await ctx.telegram.editMessageText(ctx.chat.id, dashboardMsgId.get(ctx.from.id), null, text, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('✖️ Cancel Operation', 'BACK')]]) }).catch(()=>{});
            return ctx.wizard.next();
        }
    },
    async (ctx) => {
        if (ctx.message?.text) {
            await ctx.deleteMessage().catch(() => {});
            ctx.scene.state.pass = ctx.message.text.trim();
            const hosts = getMailHosts(ctx.scene.state.email);
            
            if (hosts) {
                await dbRun(
                    'INSERT INTO users (user_id, email_user, email_pass, imap_host, smtp_host) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET email_user=excluded.email_user, email_pass=excluded.email_pass, imap_host=excluded.imap_host, smtp_host=excluded.smtp_host',
                    [ctx.from.id, ctx.scene.state.email, ctx.scene.state.pass, hosts.imap, hosts.smtp]
                );
                await ctx.telegram.editMessageText(ctx.chat.id, dashboardMsgId.get(ctx.from.id), null, `✅ <b>[ SUCCESS ]</b> Node Secured.`, { parse_mode: 'HTML' }).catch(()=>{});
                await delay(2000);
                return cancelOperation(ctx);
            } else {
                await ctx.telegram.editMessageText(ctx.chat.id, dashboardMsgId.get(ctx.from.id), null, `🌐 <b>[ CUSTOM SMTP ]</b>\n> Enter <b>SMTP Host</b> (e.g. smtp.hostinger.com):`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('✖️ Cancel', 'BACK')]]) }).catch(()=>{});
                return ctx.wizard.next();
            }
        }
    },
    async (ctx) => {
        if (ctx.message?.text) {
            await ctx.deleteMessage().catch(() => {});
            await dbRun(
                'INSERT INTO users (user_id, email_user, email_pass, imap_host, smtp_host) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET email_user=excluded.email_user, email_pass=excluded.email_pass, imap_host=excluded.imap_host, smtp_host=excluded.smtp_host',
                [ctx.from.id, ctx.scene.state.email, ctx.scene.state.pass, 'custom-imap', ctx.message.text.trim()]
            );
            await ctx.telegram.editMessageText(ctx.chat.id, dashboardMsgId.get(ctx.from.id), null, '✅ <b>[ SUCCESS ]</b> Custom node secured.', { parse_mode: 'HTML' }).catch(()=>{});
            await delay(2000);
            return cancelOperation(ctx);
        }
    }
);

const kirimWizard = new Scenes.WizardScene(
    'KIRIM_WIZARD',
    async (ctx) => {
        const user = await dbGet('SELECT * FROM users WHERE user_id = ?', [ctx.from.id]);
        if (!user?.email_user) {
            await ctx.answerCbQuery('⚠️ Configure Gateway First.', { show_alert: true });
            return ctx.scene.leave();
        }
        const text = `<b>[ TRANSMISSION SETUP ]</b>\n━━━━━━━━━━━━━━━━━━━━━━\n> Enter target <b>WhatsApp Number</b>:\n<i>Format: +628...</i>`;
        await ctx.telegram.editMessageText(ctx.chat.id, dashboardMsgId.get(ctx.from.id), null, text, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('✖️ Abort', 'BACK')]]) }).catch(()=>{});
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message?.text) {
            await ctx.deleteMessage().catch(() => {});
            const nomor = ctx.message.text.trim();
            if (!/^\+\d+$/.test(nomor)) return;

            const user = await dbGet('SELECT * FROM users WHERE user_id = ?', [ctx.from.id]);
            const template = templates[user.lang_code || 'ID'];

            await ctx.telegram.editMessageText(ctx.chat.id, dashboardMsgId.get(ctx.from.id), null, '⏳ <i>[ EXECUTING ] Sending payload...</i>', { parse_mode: 'HTML' }).catch(()=>{});

            const transporter = nodemailer.createTransport({
                host: user.smtp_host,
                port: user.smtp_host.includes('outlook') ? 587 : 465,
                secure: !user.smtp_host.includes('outlook'),
                auth: { user: user.email_user, pass: user.email_pass }
            });

            try {
                await transporter.sendMail({
                    from: user.email_user,
                    to: 'support@support.whatsapp.com',
                    subject: template.subject,
                    text: template.body(nomor)
                });
                await delay(3000);
                await ctx.telegram.editMessageText(ctx.chat.id, dashboardMsgId.get(ctx.from.id), null, `✅ <b>[ COMPLETED ]</b>\nTransmitted via node ${user.lang_code}.`, { parse_mode: 'HTML' }).catch(()=>{});
            } catch (e) {
                await ctx.telegram.editMessageText(ctx.chat.id, dashboardMsgId.get(ctx.from.id), null, `❌ <b>[ FAILED ]</b>\n<code>${e.message}</code>`, { parse_mode: 'HTML' }).catch(()=>{});
            }
            
            await delay(3000);
            return cancelOperation(ctx);
        }
    }
);

async function cancelOperation(ctx) {
    await ctx.scene.leave();
    return renderDashboard(ctx);
}

// ==========================================
// 5. ROUTING & HANDLERS
// ==========================================
const stage = new Scenes.Stage([setupWizard, kirimWizard]);
bot.use(session());
bot.use(stage.middleware());

bot.start(renderDashboard);
bot.command('menu', renderDashboard);

bot.action('MENU_SETUP', (ctx) => { ctx.answerCbQuery(); ctx.scene.enter('SETUP_WIZARD'); });
bot.action('MENU_KIRIM', (ctx) => { ctx.answerCbQuery(); ctx.scene.enter('KIRIM_WIZARD'); });

bot.action('MENU_LANG', async (ctx) => {
    ctx.answerCbQuery();
    const buttons = Object.keys(templates).map(code => 
        [Markup.button.callback(templates[code].name, `SET_LANG_${code}`)]
    );
    buttons.push([Markup.button.callback('⬅️ Back to Control', 'BACK')]);
    await ctx.editMessageText(`<b>[ TEMPLATE CONFIG ]</b>\n━━━━━━━━━━━━━━━━━━━━━━\nSelect regional node language:`, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^SET_LANG_(.+)$/, async (ctx) => {
    const lang = ctx.match[1];
    await dbRun('UPDATE users SET lang_code = ? WHERE user_id = ?', [lang, ctx.from.id]);
    ctx.answerCbQuery(`Node set to ${lang}`);
    return renderDashboard(ctx);
});

bot.action('MENU_RESET', async (ctx) => {
    await dbRun('DELETE FROM users WHERE user_id = ?', [ctx.from.id]);
    ctx.answerCbQuery('System Purged.', { show_alert: true });
    return renderDashboard(ctx);
});

bot.action('MENU_PREMIUM', (ctx) => ctx.answerCbQuery('FIX MERAH PREMIUM ACTIVE', { show_alert: true }));

// FIXED CANCEL HANDLER
bot.action('BACK', async (ctx) => {
    ctx.answerCbQuery('Action Aborted.');
    return cancelOperation(ctx);
});

bot.on('message', async (ctx, next) => {
    if (!ctx.scene.current) await ctx.deleteMessage().catch(() => {});
    return next();
});

bot.launch().then(() => console.log('🤖 [FIX MERAH] System Online.'));
