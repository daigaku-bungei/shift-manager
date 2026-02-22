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
app.set('trust proxy', 1); // Render等のリバースプロキシ環境でHTTPSプロトコルを正しく判別するために追加
// HTMLファイルはキャッシュしない。その他の静的ファイルは1時間キャッシュ
app.use(express.static(path.join(__dirname, '../public'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));

const LINE_CLIENT_ID = process.env.LINE_CLIENT_ID;
const LINE_CLIENT_SECRET = process.env.LINE_CLIENT_SECRET;


// --- データベース操作 ---
const readData = () => {
    if (!fs.existsSync(DATA_FILE)) {
        const initial = {
            shifts: [],
            members: [
                { id: "1", name: "管理者", username: "admin", password: "admin123", role: "admin" },
                { id: "2", name: "スタッフ1", username: "staff1", password: "staff123", role: "staff" }
            ],
            responses: [],
            pairings: [],
            schedules: []
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
        return initial;
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
};

const writeData = (data) => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

// Cookie設定ヘルパー：本番環境では secure+SameSite=Lax、ローカルでは無制限
const cookieOpts = () => {
    const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER;
    return {
        httpOnly: true,
        sameSite: isProduction ? 'lax' : 'lax',
        secure: isProduction ? true : false,
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7日間有効
    };
};

// ==========================================
// 1. 通常のログイン（ID/パスワード）
// ==========================================
app.post('/api/login', (req, res) => {
    const { userId, password, role } = req.body;
    const data = readData();
    const user = data.members.find(m => m.username === userId && m.password === password && m.role === role);

    if (user) {
        res.cookie('user_session', user.id, cookieOpts());
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
    res.cookie('user_session', newUser.id, cookieOpts());
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

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    const callbackUrl = `${protocol}://${host}/api/line/callback`;
    const lineAuthUrl = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${LINE_CLIENT_ID}&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${state}&scope=profile%20openid%20email&bot_prompt=normal`;
    res.redirect(lineAuthUrl);
});

app.get('/api/line/callback', async (req, res) => {
    const { code, state } = req.query;
    if (state !== req.cookies.line_state) return res.status(400).send('不正アクセス');

    try {
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.get('host');
        const callbackUrl = `${protocol}://${host}/api/line/callback`;
        const tokenRes = await axios.post('https://api.line.me/oauth2/v2.1/token', new URLSearchParams({
            grant_type: 'authorization_code', code, redirect_uri: callbackUrl, client_id: LINE_CLIENT_ID, client_secret: LINE_CLIENT_SECRET
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

        res.cookie('user_session', user.id, cookieOpts());

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

// 個人の予定（プライベートスケジュール）API
app.get('/api/me/schedules', (req, res) => {
    const userId = req.cookies.user_session;
    if (!userId) return res.status(401).json({ error: '未ログイン' });
    const data = readData();
    const mySchedules = (data.schedules || []).filter(s => s.userId === userId);
    res.json(mySchedules);
});

app.post('/api/me/schedules', (req, res) => {
    const userId = req.cookies.user_session;
    if (!userId) return res.status(401).json({ error: '未ログイン' });
    const data = readData();
    if (!data.schedules) data.schedules = [];

    const newSchedule = {
        id: Date.now().toString(),
        userId,
        date: req.body.date,
        title: req.body.title
    };
    data.schedules.push(newSchedule);
    writeData(data);
    res.status(201).json(newSchedule);
});

app.delete('/api/me/schedules/:id', (req, res) => {
    const userId = req.cookies.user_session;
    if (!userId) return res.status(401).json({ error: '未ログイン' });
    const data = readData();
    if (data.schedules) {
        data.schedules = data.schedules.filter(s => !(s.id === req.params.id && s.userId === userId));
        writeData(data);
    }
    res.json({ success: true });
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

// 手動シフト割り当て
app.post('/api/shifts/:id/assign', (req, res) => {
    const data = readData();
    const shift = data.shifts.find(s => s.id === req.params.id);
    if (!shift) return res.status(404).json({ error: 'シフトが見つかりません' });
    shift.assigned_user_id = req.body.user_id;
    writeData(data);
    res.json({ success: true });
});

// 自動シフト作成エンジン (Auto-Assign All)
app.post('/api/shifts/auto-assign-all', (req, res) => {
    const data = readData();
    let assignedCount = 0;

    // 未割当のシフトを取得
    const unassignedShifts = data.shifts.filter(s => !s.assigned_user_id);

    unassignedShifts.forEach(shift => {
        // このシフトへの全回答
        const shiftResponses = data.responses.filter(r => r.shiftId === shift.id || r.shift_id === shift.id);
        const reqSkill = shift.required_skill_level || 1;

        // 候補者のスコアリング
        let candidates = data.members.filter(m => m.role === 'staff' && (m.skill_level || 1) >= reqSkill).map(member => {
            let score = 0;
            let canWork = false;

            // 1. 希望状況のスコア化 (◎=100, △=50, ×=-1000)
            const userResponse = shiftResponses.find(r => r.userId === member.id || r.user_id === member.id);
            if (userResponse && userResponse.dailyResponses) {
                // シフトの全日程で判断（簡単のため最初の日程を基準とするか、平均をとる）
                const mainDate = shift.dates ? shift.dates[0].date : shift.date;
                const daily = userResponse.dailyResponses.find(dr => dr.date === mainDate);
                if (daily) {
                    if (daily.status === 'available') { score += 100; canWork = true; }
                    else if (daily.status === 'partial') { score += 50; canWork = true; }
                    else { score -= 1000; }
                }
            }

            // 回答がない、または✕なら候補から除外
            if (!canWork) return null;

            // 2. 公平分散ロジック (現状の割当数が多いほどスコアを下げる)
            const currentWorkload = data.shifts.filter(s => s.assigned_user_id === member.id).length;
            score -= (currentWorkload * 30);

            // 3. 相性ルールの適用
            const shiftDate = shift.dates ? shift.dates[0].date : shift.date;
            // 同じ日に既にシフトに入っている人を抽出
            const workingToday = data.shifts.filter(s => s.assigned_user_id && (s.dates ? s.dates[0].date : s.date) === shiftDate).map(s => s.assigned_user_id);

            if (data.pairings) {
                data.pairings.forEach(rule => {
                    const isM1 = rule.member1_id === member.id;
                    const isM2 = rule.member2_id === member.id;
                    if (!isM1 && !isM2) return;

                    const otherId = isM1 ? rule.member2_id : rule.member1_id;

                    // 相手が今日働く場合
                    if (workingToday.includes(otherId)) {
                        if (rule.type === 'pair') score += 80; // 一緒にする
                        if (rule.type === 'anti_pair') score -= 500; // 絶対に避ける
                    }
                });
            }

            return { memberId: member.id, score };
        }).filter(c => c !== null);

        // スコア順にソートして一番高い人を割り当て
        candidates.sort((a, b) => b.score - a.score);

        if (candidates.length > 0) {
            shift.assigned_user_id = candidates[0].memberId;
            assignedCount++;
        }
    });

    if (assignedCount > 0) writeData(data);
    res.json({ success: true, count: assignedCount });
});

app.get('/api/members', (req, res) => {
    const data = readData();
    res.json(data.members.map(({ password, ...m }) => m));
});

// メンバー削除
app.delete('/api/members/:id', (req, res) => {
    const data = readData();
    const initLen = data.members.length;
    data.members = data.members.filter(m => m.id !== req.params.id);
    if (data.members.length < initLen) {
        writeData(data);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'メンバーが見つかりません' });
    }
});

// メンバー編集（名前、グループ等）
app.put('/api/members/:id', (req, res) => {
    const data = readData();
    const idx = data.members.findIndex(m => m.id === req.params.id);
    if (idx !== -1) {
        data.members[idx] = { ...data.members[idx], ...req.body };
        writeData(data);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'メンバーが見つかりません' });
    }
});

// メンバースキルレベル更新
app.put('/api/members/:id/skill', (req, res) => {
    const data = readData();
    const idx = data.members.findIndex(m => m.id === req.params.id);
    if (idx !== -1) {
        data.members[idx].skill_level = req.body.skill_level;
        writeData(data);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'メンバーが見つかりません' });
    }
});

// ==========================================
// 相性（ペアリング）ルール API
// ==========================================
app.get('/api/pairings', (req, res) => {
    const data = readData();
    res.json(data.pairings || []);
});

app.post('/api/pairings', (req, res) => {
    const data = readData();
    if (!data.pairings) data.pairings = [];
    const newPairing = {
        id: Date.now().toString(),
        member1_id: req.body.member1_id,
        member2_id: req.body.member2_id,
        type: req.body.type
    };
    data.pairings.push(newPairing);
    writeData(data);
    res.json(newPairing);
});

app.delete('/api/pairings/:id', (req, res) => {
    const data = readData();
    if (data.pairings) {
        data.pairings = data.pairings.filter(p => p.id !== req.params.id);
        writeData(data);
    }
    res.json({ success: true });
});

app.post('/api/melogout', (req, res) => {
    res.clearCookie('user_session');
    res.clearCookie('line_state');
    res.json({ success: true });
});

app.listen(PORT, () => console.log(`🚀 Urban Shift Studio 起動: http://localhost:${PORT}`));