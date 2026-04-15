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
// 3. UI ENGINE (ANTI-STACKING)
// ==========================================
const bot = new Telegraf(process.env.BOT_TOKEN);

// Fungsi cerdas untuk memastikan selalu mengedit 1 pesan yang sama
const updateUI = async (ctx, text, keyboardLayout = []) => {
    const markup = keyboardLayout.length > 0 ? Markup.inlineKeyboard(keyboardLayout) : undefined;
    let msgId = ctx.session?.uiMsgId;

    // Jika dipicu dari klik tombol, update ID pesan terakhir
    if (ctx.callbackQuery?.message?.message_id) {
        msgId = ctx.callbackQuery.message.message_id;
        if (ctx.session) ctx.session.uiMsgId = msgId;
    }

    try {
        if (msgId) {
            await ctx.telegram.editMessageText(ctx.chat.id, msgId, null, text, { parse_mode: 'HTML', ...markup });
        } else {
            const msg = await ctx.reply(text, { parse_mode: 'HTML', ...markup });
            if (ctx.session) ctx.session.uiMsgId = msg.message_id;
        }
    } catch (error) {
        // Abaikan error jika teks sama persis
        if (error.description && error.description.includes('message is not modified')) return;
        
        // Jika pesan sebelumnya terhapus, kirim ulang sebagai *fallback*
        const msg = await ctx.reply(text, { parse_mode: 'HTML', ...markup });
        if (ctx.session) ctx.session.uiMsgId = msg.message_id;
    }
};

const showDashboard = async (ctx) => {
    const userData = await dbGet('SELECT * FROM users WHERE user_id = ?', [ctx.from.id]);
    const lang = userData?.lang_code || 'ID';
    
    const text = `<b>⌬ FIX MERAH | COMMAND CENTER ⌬</b>\n` +
                 `━━━━━━━━━━━━━━━━━━━━━━\n` +
                 `<b>[ NODE STATUS ]</b>\n` +
                 `⊛ Security : 🟢 <i>Encrypted</i>\n` +
                 `⊛ Account  : <code>${userData?.email_user || 'UNCONFIGURED'}</code>\n` +
                 `⊛ Template : <b>${templates[lang].name}</b>\n` +
                 `━━━━━━━━━━━━━━━━━━━━━━\n` +
                 `<i>Awaiting transmission request...</i>`;
    
    const keyboard = [
        [Markup.button.callback('⚡ EXECUTE FIX NOMOR', 'MENU_KIRIM')],
        [
            Markup.button.callback('⚙️ Gateway', 'MENU_SETUP'),
            Markup.button.callback('🌐 Template', 'MENU_LANG')
        ],
        [
            Markup.button.callback('🗑️ Purge', 'MENU_RESET'),
            Markup.button.callback('💎 License', 'MENU_PREMIUM')
        ]
    ];

    await updateUI(ctx, text, keyboard);
};

// ==========================================
// 4. SCENES (WIZARDS)
// ==========================================

const setupWizard = new Scenes.WizardScene(
    'SETUP_WIZARD',
    async (ctx) => {
        await updateUI(ctx, `<b>[ INITIALIZE GATEWAY ]</b>\n━━━━━━━━━━━━━━━━━━━━━━\n> Enter your <b>Email Address</b>:\n\n<i>*Auto-delete active</i>`, [[Markup.button.callback('✖️ Cancel Operation', 'CANCEL')]]);
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message?.text) {
            await ctx.deleteMessage().catch(() => {}); 
            ctx.scene.state.email = ctx.message.text.trim();
            await updateUI(ctx, `<b>[ AUTHENTICATION ]</b>\n━━━━━━━━━━━━━━━━━━━━━━\nTarget: <code>${ctx.scene.state.email}</code>\n\n> Enter <b>App Password</b>:`, [[Markup.button.callback('✖️ Cancel Operation', 'CANCEL')]]);
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
                await updateUI(ctx, `✅ <b>[ SUCCESS ]</b> Node Secured.`);
                await delay(2000);
                await ctx.scene.leave();
                return showDashboard(ctx);
            } else {
                await updateUI(ctx, `🌐 <b>[ CUSTOM SMTP ]</b>\n> Enter <b>SMTP Host</b> (e.g. smtp.hostinger.com):`, [[Markup.button.callback('✖️ Cancel', 'CANCEL')]]);
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
            await updateUI(ctx, `✅ <b>[ SUCCESS ]</b> Custom node secured.`);
            await delay(2000);
            await ctx.scene.leave();
            return showDashboard(ctx);
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
        await updateUI(ctx, `<b>[ TRANSMISSION SETUP ]</b>\n━━━━━━━━━━━━━━━━━━━━━━\n> Enter target <b>WhatsApp Number</b>:\n<i>Format: +628...</i>`, [[Markup.button.callback('✖️ Abort Execution', 'CANCEL')]]);
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message?.text) {
            await ctx.deleteMessage().catch(() => {});
            const nomor = ctx.message.text.trim();
            
            if (!/^\+\d+$/.test(nomor)) {
                const err = await ctx.reply('⚠️ Invalid Format!');
                await delay(1500);
                await ctx.deleteMessage(err.message_id).catch(()=>{});
                return; // Tetap di step ini
            }

            const user = await dbGet('SELECT * FROM users WHERE user_id = ?', [ctx.from.id]);
            const template = templates[user.lang_code || 'ID'];

            await updateUI(ctx, `⏳ <i>[ EXECUTING ] Routing payload via SMTP...</i>`);

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
                await updateUI(ctx, `✅ <b>[ TRANSMISSION COMPLETE ]</b>\nPayload successfully delivered for <code>${nomor}</code>.`);
            } catch (e) {
                await updateUI(ctx, `❌ <b>[ TRANSMISSION FAILED ]</b>\n<code>${e.message}</code>`);
            }
            
            await delay(3000);
            await ctx.scene.leave();
            return showDashboard(ctx);
        }
    }
);

// ==========================================
// 5. ROUTING & HANDLERS
// ==========================================

// PENTING: Session harus diregistrasi sebelum Stage!
bot.use(session());
bot.use((ctx, next) => {
    if (!ctx.session) ctx.session = {};
    return next();
});

const stage = new Scenes.Stage([setupWizard, kirimWizard]);

// GLOBAL CANCEL HANDLER: Mencegah tombol cancel macet saat di dalam Scene
stage.action('CANCEL', async (ctx) => {
    await ctx.answerCbQuery('Operation Aborted.');
    await ctx.scene.leave();
    return showDashboard(ctx);
});

bot.use(stage.middleware());

bot.start(showDashboard);
bot.command('menu', showDashboard);

bot.action('MENU_SETUP', (ctx) => { ctx.answerCbQuery(); ctx.scene.enter('SETUP_WIZARD'); });
bot.action('MENU_KIRIM', (ctx) => { ctx.answerCbQuery(); ctx.scene.enter('KIRIM_WIZARD'); });

bot.action('MENU_LANG', async (ctx) => {
    ctx.answerCbQuery();
    const buttons = Object.keys(templates).map(code => 
        [Markup.button.callback(templates[code].name, `SET_LANG_${code}`)]
    );
    buttons.push([Markup.button.callback('⬅️ Back to Control', 'CANCEL')]);
    await updateUI(ctx, `<b>[ TEMPLATE CONFIG ]</b>\n━━━━━━━━━━━━━━━━━━━━━━\nSelect regional node language:`, buttons);
});

bot.action(/^SET_LANG_(.+)$/, async (ctx) => {
    const lang = ctx.match[1];
    await dbRun('UPDATE users SET lang_code = ? WHERE user_id = ?', [lang, ctx.from.id]);
    ctx.answerCbQuery(`Template set to ${lang}`);
    return showDashboard(ctx);
});

bot.action('MENU_RESET', async (ctx) => {
    await dbRun('DELETE FROM users WHERE user_id = ?', [ctx.from.id]);
    ctx.answerCbQuery('System Purged.', { show_alert: true });
    return showDashboard(ctx);
});

bot.action('MENU_PREMIUM', (ctx) => ctx.answerCbQuery('FIX MERAH PREMIUM ACTIVE', { show_alert: true }));

// Hapus pesan teks nyasar jika user ngetik di luar perintah bot
bot.on('message', async (ctx, next) => {
    if (!ctx.scene.current) await ctx.deleteMessage().catch(() => {});
    return next();
});

bot.launch().then(() => console.log('🤖 [FIX MERAH] Session Engine Online.'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
