require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3456;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

const LINE_CLIENT_ID = process.env.LINE_CLIENT_ID;
const LINE_CLIENT_SECRET = process.env.LINE_CLIENT_SECRET;
const CALLBACK_URL = `http://localhost:${PORT}/api/line/callback`;

// --- データベース操作 ---
const readData = () => {
    if (!fs.existsSync(DATA_FILE)) {
        const initial = { 
            shifts: [], 
            members: [
                { id: "1", name: "管理者", username: "admin", password: "admin123", role: "admin" },
                { id: "2", name: "スタッフ1", username: "staff1", password: "staff123", role: "staff" }
            ], 
            responses: [] 
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
        return initial;
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
};

const writeData = (data) => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

// ==========================================
// 1. 通常のログイン（ID/パスワード）
// ==========================================
app.post('/api/login', (req, res) => {
    const { userId, password, role } = req.body;
    const data = readData();
    const user = data.members.find(m => m.username === userId && m.password === password && m.role === role);

    if (user) {
        res.cookie('user_session', user.id, { httpOnly: true });
        res.json({ success: true, role: user.role });
    } else {
        res.status(401).json({ success: false, message: 'IDまたはパスワードが違います' });
    }
});

// ==========================================
// 1.5. 新規登録（ID/パスワード）
// ==========================================
app.post('/api/register', (req, res) => {
    const { username, password, name, role } = req.body;
    const data = readData();

    // 入力チェック
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'IDとパスワードは必須です' });
    }

    // 既に同じID（username）が使われていないかチェック
    const existingUser = data.members.find(m => m.username === username);
    if (existingUser) {
        return res.status(400).json({ success: false, message: 'このIDは既に使われています。別のIDを入力してください。' });
    }

    // 新しいユーザーデータを作成
    const newUser = {
        id: Date.now().toString(), // 現在の時刻を固有IDにする
        name: name || '名無しスタッフ', // 名前が空っぽならデフォルト名
        username: username,
        password: password,
        role: role || 'staff'
    };

    // データを追加して保存（data.json に書き込み）
    data.members.push(newUser);
    writeData(data);

    // 🌟 アカウント作成後、自動でログイン状態（クッキー発行）にする！
    res.cookie('user_session', newUser.id, { httpOnly: true });
    res.json({ success: true, message: 'アカウント作成成功！', role: newUser.role });
});
// ==========================================
// 2. LINEログイン（★招待リンク＆固有ID機能を追加！）
// ==========================================
app.get('/api/line/login', (req, res) => {
    const state = crypto.randomBytes(20).toString('hex');
    res.cookie('line_state', state, { httpOnly: true });
    
    // 【魔法の仕掛け】招待リンクから来た場合、その証拠をクッキーにこっそり持たせる
    if (req.query.invite === 'true') {
        res.cookie('invite_flag', 'true', { maxAge: 1800000, httpOnly: true }); // 30分有効
    }

    const lineAuthUrl = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${LINE_CLIENT_ID}&redirect_uri=${encodeURIComponent(CALLBACK_URL)}&state=${state}&scope=profile%20openid%20email&bot_prompt=normal`;
    res.redirect(lineAuthUrl);
});

app.get('/api/line/callback', async (req, res) => {
    const { code, state } = req.query;
    if (state !== req.cookies.line_state) return res.status(400).send('不正アクセス');

    try {
        const tokenRes = await axios.post('https://api.line.me/oauth2/v2.1/token', new URLSearchParams({
            grant_type: 'authorization_code', code, redirect_uri: CALLBACK_URL, client_id: LINE_CLIENT_ID, client_secret: LINE_CLIENT_SECRET
        }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        const profileRes = await axios.get('https://api.line.me/v2/profile', {
            headers: { Authorization: `Bearer ${tokenRes.data.access_token}` }
        });

        const lineUser = profileRes.data;
        const data = readData();

        let user = data.members.find(m => m.lineId === lineUser.userId);
        
        // クッキーから「招待リンク経由か？」をチェックして証拠を消す
        const isInvite = req.cookies.invite_flag === 'true';
        res.clearCookie('invite_flag');

        if (!user) {
            // 新規ユーザー登録：X(旧Twitter)のような固有のID（例: @a1b2c3）を自動で作る！
            const randomId = Math.random().toString(36).substring(2, 8);
            
            user = { 
                id: Date.now().toString(), 
                name: lineUser.displayName, 
                username: `@${randomId}`, // これが検索用のIDになります
                lineId: lineUser.userId, 
                picture: lineUser.pictureUrl,
                role: isInvite ? 'staff' : 'pending' // 招待なら即スタッフ、普通なら「承認待ち(pending)」
            };
            data.members.push(user);
            writeData(data);
        } else if (isInvite && user.role === 'pending') {
            // 既存の「承認待ち」ユーザーが招待リンクを踏み直したらスタッフに昇格！
            user.role = 'staff';
            writeData(data);
        }

        res.cookie('user_session', user.id, { httpOnly: true });
        
        // 保留状態なら専用の待機画面へ、スタッフならスタッフ画面へ
        if (user.role === 'pending') {
            res.send('<h1>登録完了！店長にあなたのID「' + user.username + '」を伝えて承認してもらってください。</h1>');
        } else {
            res.redirect('/staff/index.html');
        }
    } catch (err) { res.status(500).send('LINE連携失敗'); }
});

// ==========================================
// 3. 連携システムAPI (店長がIDで検索＆承認する機能)
// ==========================================
// ID検索機能
app.get('/api/members/search', (req, res) => {
    const { username } = req.query;
    const data = readData();
    const user = data.members.find(m => m.username === username);
    
    if (user) {
        res.json({ success: true, user: { name: user.name, username: user.username, role: user.role } });
    } else {
        res.json({ success: false, message: 'ユーザーが見つかりません' });
    }
});

// 追加（フォロー）機能
app.post('/api/members/approve', (req, res) => {
    const { username } = req.body;
    const data = readData();
    const userIndex = data.members.findIndex(m => m.username === username);
    
    if (userIndex !== -1) {
        data.members[userIndex].role = 'staff'; // 保留からスタッフに昇格
        writeData(data);
        res.json({ success: true, message: 'スタッフに追加しました！' });
    } else {
        res.status(404).json({ success: false, message: 'ユーザーが見つかりません' });
    }
});

// ==========================================
// 4. 業務API
// ==========================================
app.get('/api/me', (req, res) => {
    const userId = req.cookies.user_session;
    const data = readData();
    const user = data.members.find(m => m.id === userId);
    if (user) res.json(user);
    else res.status(401).json({ error: '未ログイン' });
});

app.get('/api/shifts', (req, res) => res.json(readData().shifts));

// これを /api/shifts の下あたりに追加してください！
app.get('/api/responses', (req, res) => {
    res.json(readData().responses || []);
});



app.post('/api/shifts', (req, res) => {
    const data = readData();
    const newShift = { id: Date.now().toString(), ...req.body, createdAt: new Date() };
    data.shifts.push(newShift);
    writeData(data);
    res.status(201).json(newShift);
});

app.get('/api/members', (req, res) => {
    const data = readData();
    res.json(data.members.map(({ password, ...m }) => m));
});

app.post('/api/melogout', (req, res) => {
    res.clearCookie('user_session');
    res.clearCookie('line_state');
    res.json({ success: true });
});

app.listen(PORT, () => console.log(`🚀 Urban Shift Studio 起動: http://localhost:${PORT}`));