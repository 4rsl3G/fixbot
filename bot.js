require('dotenv').config();
const { Telegraf, session, Scenes, Markup } = require('telegraf');
const nodemailer = require('nodemailer');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');

// ==========================================
// DATABASE SETUP (SQLite)
// ==========================================
const db = new sqlite3.Database('./bot_database.db');
const dbRun = promisify(db.run).bind(db);
const dbGet = promisify(db.get).bind(db);

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
        body: (num) => `Halo Tim Dukungan WhatsApp,\n\nSaya ingin melaporkan masalah terkait nomor WhatsApp saya. Saat mencoba melakukan pendaftaran, setiap kali saya ingin masuk selalu muncul pesan “Login Tidak Tersedia Saat Ini”.\n\nSaya sangat berharap pihak WhatsApp dapat membantu agar saya bisa menggunakan kembali nomor saya ${num} tanpa muncul kendala tersebut.\n\nTerima kasih.`
    },
    EN: {
        name: 'English 🇺🇸',
        subject: 'Login unavailable at the moment',
        body: (num) => `Hello WhatsApp Support Team,\n\nI am reporting an issue with my account. Every time I try to register or log in, I receive the message "Login unavailable at the moment".\n\nI hope you can help me restore access to my number ${num}. Thank you for your assistance.`
    },
    PT: {
        name: 'Portuguese 🇧🇷',
        subject: 'Login não disponível no momento',
        body: (num) => `Olá Equipe de Suporte do WhatsApp,\n\nEstou relatando um problema com meu número. Sempre que tento entrar, aparece a mensagem "Login não disponível no momento".\n\nEspero que possam me ajudar a voltar a usar meu número ${num}. Obrigado.`
    },
    ES: {
        name: 'Spanish 🇪🇸',
        subject: 'Inicio de sesión no disponible',
        body: (num) => `Hola Equipo de Soporte de WhatsApp,\n\nQuiero reportar un problema con mi número. Al intentar registrarme, aparece el mensaje "Inicio de sesión no disponible en este momento".\n\nEspero que puedan ayudarme a recuperar mi número ${num}. Gracias.`
    }
};

// ==========================================
// BOT LOGIC
// ==========================================
const bot = new Telegraf(process.env.BOT_TOKEN);

const showMainMenu = async (ctx) => {
    const userData = await dbGet('SELECT * FROM users WHERE user_id = ?', [ctx.from.id]);
    const lang = userData?.lang_code || 'ID';
    
    const text = `🖥 <b>DASHBOARD SUPORT WA</b>\n\n` +
                 `Status: ${userData?.email_user ? '✅ Terhubung' : '❌ Belum Setup'}\n` +
                 `Email: <code>${userData?.email_user || '-'}</code>\n` +
                 `Template: <b>${templates[lang].name}</b>`;
    
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('⚙️ Setup Email & App Pass', 'MENU_SETUP')],
        [Markup.button.callback('🌐 Pilih Bahasa Template', 'MENU_LANG')],
        [Markup.button.callback('📨 KIRIM BANDING SEKARANG', 'MENU_KIRIM')],
        [Markup.button.callback('🗑 Reset Config', 'MENU_RESET')]
    ]);

    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard }).catch(() => {});
    } else {
        await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
    }
};

// --- SCENE: SETUP ---
const setupWizard = new Scenes.WizardScene(
    'SETUP_WIZARD',
    async (ctx) => {
        await ctx.reply('📧 Masukkan Gmail Anda:');
        return ctx.wizard.next();
    },
    async (ctx) => {
        ctx.scene.state.email = ctx.message.text;
        await ctx.reply('🔑 Masukkan 16-digit App Password:');
        return ctx.wizard.next();
    },
    async (ctx) => {
        const pass = ctx.message.text;
        const email = ctx.scene.state.email;
        
        await dbRun(
            'INSERT INTO users (user_id, email_user, email_pass) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET email_user=excluded.email_user, email_pass=excluded.email_pass',
            [ctx.from.id, email, pass]
        );

        await ctx.reply('✅ Kredensial berhasil disimpan di database!');
        showMainMenu(ctx);
        return ctx.scene.leave();
    }
);

// --- SCENE: KIRIM ---
const kirimWizard = new Scenes.WizardScene(
    'KIRIM_WIZARD',
    async (ctx) => {
        const user = await dbGet('SELECT * FROM users WHERE user_id = ?', [ctx.from.id]);
        if (!user?.email_user) {
            await ctx.reply('⚠️ Setup email dulu!');
            return ctx.scene.leave();
        }
        await ctx.reply('📱 Masukkan nomor WA (contoh: +628xxx):');
        return ctx.wizard.next();
    },
    async (ctx) => {
        const nomor = ctx.message.text;
        const user = await dbGet('SELECT * FROM users WHERE user_id = ?', [ctx.from.id]);
        const lang = user.lang_code || 'ID';
        const template = templates[lang];

        const loading = await ctx.reply('🚀 Mengirim email...');

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
            await ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, null, `✅ Berhasil dikirim menggunakan template ${template.name}!`);
        } catch (e) {
            await ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, null, `❌ Error: ${e.message}`);
        }
        showMainMenu(ctx);
        return ctx.scene.leave();
    }
);

// ==========================================
// REGISTRATION
// ==========================================
const stage = new Scenes.Stage([setupWizard, kirimWizard]);
bot.use(session());
bot.use(stage.middleware());

bot.start(showMainMenu);

bot.action('MENU_SETUP', (ctx) => ctx.scene.enter('SETUP_WIZARD'));
bot.action('MENU_KIRIM', (ctx) => ctx.scene.enter('KIRIM_WIZARD'));

bot.action('MENU_LANG', async (ctx) => {
    const buttons = Object.keys(templates).map(code => 
        [Markup.button.callback(templates[code].name, `SET_LANG_${code}`)]
    );
    buttons.push([Markup.button.callback('🔙 Kembali', 'BACK')]);
    await ctx.editMessageText('🌐 Pilih Bahasa untuk Template Email:', Markup.inlineKeyboard(buttons));
});

// Handler Ganti Bahasa
bot.action(/^SET_LANG_(.+)$/, async (ctx) => {
    const lang = ctx.match[1];
    await dbRun('UPDATE users SET lang_code = ? WHERE user_id = ?', [lang, ctx.from.id]);
    ctx.answerCbQuery(`Bahasa diganti ke ${lang}`);
    showMainMenu(ctx);
});

bot.action('MENU_RESET', async (ctx) => {
    await dbRun('DELETE FROM users WHERE user_id = ?', [ctx.from.id]);
    ctx.answerCbQuery('Data dihapus!');
    showMainMenu(ctx);
});

bot.action('BACK', showMainMenu);

bot.launch().then(() => console.log('🚀 Bot SQLite Multilanguage Ready!'));
