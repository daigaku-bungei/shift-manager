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
// ルートURL (/) は常にlogin.htmlを直接返す（CDNキャッシュの古いindex.htmlをバイパス）
app.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, '../public/login.html'));
});

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
            members: [],
            responses: [],
            pairings: [],
            schedules: [],
            invites: []
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
        return initial;
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
};

const writeData = (data) => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

// ownerId取得ヘルパー: ログインユーザーが管理者なら自分のID、スタッフなら自分のownerId
function getOwnerId(req) {
    const userId = req.cookies.user_session;
    if (!userId) return null;
    const data = readData();
    const user = data.members.find(m => m.id === userId);
    if (!user) return null;
    if (user.role === 'admin') return user.id;
    return user.ownerId || null;
}

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

    // 既に同じID（username）＋同じロールが使われていないかチェック
    const existingUser = data.members.find(m => m.username === username && m.role === role);
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
// 1.8. 招待トークンシステム
// ==========================================

// 招待トークン生成（管理者用）
app.post('/api/invite/create', (req, res) => {
    const data = readData();
    const userId = req.cookies.user_session;
    const admin = data.members.find(m => m.id === userId && m.role === 'admin');
    if (!admin) return res.status(403).json({ error: '管理者権限が必要です' });

    const token = crypto.randomBytes(12).toString('hex');
    if (!data.invites) data.invites = [];
    data.invites.push({
        token,
        createdBy: admin.id,
        ownerId: admin.id,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7日間
    });
    writeData(data);

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    const inviteUrl = `${protocol}://${host}/join/${token}`;
    res.json({ success: true, token, url: inviteUrl });
});

// 招待トークン一覧取得
app.get('/api/invites', (req, res) => {
    const data = readData();
    const invites = (data.invites || []).filter(inv => new Date(inv.expiresAt) > new Date());
    res.json(invites);
});

// 参加ページ表示
app.get('/join/:token', (req, res) => {
    const data = readData();
    if (!data.invites) data.invites = [];
    const invite = data.invites.find(inv => inv.token === req.params.token && new Date(inv.expiresAt) > new Date());
    if (!invite) {
        return res.status(404).send('<html><body style="font-family:sans-serif;text-align:center;padding:60px;"><h1>😢 招待リンクが無効です</h1><p>有効期限切れか、無効なリンクです。管理者に新しいリンクを発行してもらってください。</p><a href="/">ログインページへ</a></body></html>');
    }
    res.sendFile(path.join(__dirname, '../public/join.html'));
});

// トークン経由の参加API
app.post('/api/join', (req, res) => {
    const { token, method, name, username, password } = req.body;
    const data = readData();
    if (!data.invites) data.invites = [];

    const invite = data.invites.find(inv => inv.token === token && new Date(inv.expiresAt) > new Date());
    if (!invite) {
        return res.status(400).json({ success: false, message: '招待リンクが無効または期限切れです' });
    }

    if (method === 'register') {
        // 新規登録して参加
        if (!name || !password) {
            return res.status(400).json({ success: false, message: '名前とパスワードは必須です' });
        }
        const generatedUsername = 'user_' + Math.random().toString(36).substring(2, 8);
        const newUser = {
            id: Date.now().toString(),
            name: name,
            username: generatedUsername,
            password: password,
            role: 'staff',
            ownerId: invite.ownerId,
            joinedVia: 'invite',
            joinedAt: new Date().toISOString()
        };
        data.members.push(newUser);
        writeData(data);
        res.cookie('user_session', newUser.id, cookieOpts());
        return res.json({ success: true, message: '参加完了！', username: generatedUsername, redirectUrl: '/staff/index.html' });
    }

    if (method === 'login') {
        // 既存アカウントでログインして参加
        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'IDとパスワードは必須です' });
        }
        const user = data.members.find(m => m.username === username && m.password === password);
        if (!user) {
            return res.status(401).json({ success: false, message: 'IDまたはパスワードが違います' });
        }
        // pending なら staff に昇格
        if (user.role === 'pending') {
            user.role = 'staff';
            writeData(data);
        }
        res.cookie('user_session', user.id, cookieOpts());
        const redirectUrl = user.role === 'admin' ? '/admin/index.html' : '/staff/index.html';
        return res.json({ success: true, message: '参加完了！', redirectUrl });
    }

    res.status(400).json({ success: false, message: '不正なリクエストです' });
});

// ==========================================
// 2. LINEログイン（★招待トークン連携対応）
// ==========================================
app.get('/api/line/login', (req, res) => {
    const state = crypto.randomBytes(20).toString('hex');
    res.cookie('line_state', state, { httpOnly: true });

    // 招待リンク or 招待トークン経由の場合
    if (req.query.invite === 'true') {
        res.cookie('invite_flag', 'true', { maxAge: 1800000, httpOnly: true });
    }
    if (req.query.token) {
        res.cookie('invite_token', req.query.token, { maxAge: 1800000, httpOnly: true });
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

        // 招待チェック: invite_flag または invite_token
        const isInvite = req.cookies.invite_flag === 'true';
        const inviteToken = req.cookies.invite_token;
        res.clearCookie('invite_flag');
        res.clearCookie('invite_token');

        // トークンが有効か確認 + ownerIdを取得
        let isValidToken = false;
        let tokenOwnerId = null;
        if (inviteToken && data.invites) {
            const foundInvite = data.invites.find(inv => inv.token === inviteToken && new Date(inv.expiresAt) > new Date());
            if (foundInvite) {
                isValidToken = true;
                tokenOwnerId = foundInvite.ownerId;
            }
        }
        const shouldAutoApprove = isInvite || isValidToken;

        if (!user) {
            const randomId = Math.random().toString(36).substring(2, 8);
            user = {
                id: Date.now().toString(),
                name: lineUser.displayName,
                username: `@${randomId}`,
                lineId: lineUser.userId,
                picture: lineUser.pictureUrl,
                role: 'staff', // LINE認証なら即スタッフ
                ownerId: tokenOwnerId || null,
                joinedVia: isValidToken ? 'invite_line' : 'line',
                joinedAt: new Date().toISOString()
            };
            data.members.push(user);
            writeData(data);
        } else if (user.role === 'pending') {
            // 既存pending→staff昇格
            user.role = 'staff';
            if (tokenOwnerId && !user.ownerId) user.ownerId = tokenOwnerId;
            writeData(data);
        }

        res.cookie('user_session', user.id, cookieOpts());
        res.redirect('/staff/index.html');
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
    if (!user) return res.status(401).json({ error: '未ログイン' });

    // roleクエリパラメータが指定されていたら、ロールもチェック
    const requiredRole = req.query.role;
    if (requiredRole && user.role !== requiredRole) {
        return res.status(403).json({ error: 'アクセス権限がありません', userRole: user.role });
    }

    res.json(user);
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

app.get('/api/shifts', (req, res) => {
    const ownerId = getOwnerId(req);
    const data = readData();
    const filtered = ownerId
        ? data.shifts.filter(s => s.ownerId === ownerId)
        : data.shifts;
    res.json(filtered);
});

// これを /api/shifts の下あたりに追加してください！
app.get('/api/responses', (req, res) => {
    const ownerId = getOwnerId(req);
    const data = readData();
    if (!ownerId) return res.json(data.responses || []);
    // 自分のシフトに紐づく回答のみ返す
    const myShiftIds = data.shifts.filter(s => s.ownerId === ownerId).map(s => s.id);
    const filtered = (data.responses || []).filter(r => myShiftIds.includes(r.shiftId) || myShiftIds.includes(r.shift_id));
    res.json(filtered);
});

// シフト回答を提出する
app.post('/api/responses', (req, res) => {
    const data = readData();
    const { shiftId, userId, userName, comment, dailyResponses, submittedAt } = req.body;

    if (!shiftId || !userId) {
        return res.status(400).json({ error: 'shiftId と userId は必須です' });
    }

    // 既存の回答があれば上書き、なければ追加
    const existingIndex = (data.responses || []).findIndex(
        r => (r.shiftId === shiftId || r.shift_id === shiftId) && (r.userId === userId || r.user_id === userId)
    );

    const newResponse = {
        id: Date.now().toString(),
        shiftId,
        shift_id: shiftId,
        userId,
        user_id: userId,
        userName,
        comment: comment || '',
        dailyResponses: dailyResponses || [],
        submittedAt: submittedAt || new Date().toISOString()
    };

    if (!data.responses) data.responses = [];

    if (existingIndex >= 0) {
        data.responses[existingIndex] = newResponse;
    } else {
        data.responses.push(newResponse);
    }

    writeData(data);
    res.status(201).json({ success: true, response: newResponse });
});


app.post('/api/shifts', (req, res) => {
    const data = readData();
    const ownerId = getOwnerId(req);
    const newShift = { id: Date.now().toString(), ...req.body, ownerId: ownerId, createdAt: new Date() };
    data.shifts.push(newShift);
    writeData(data);
    res.status(201).json(newShift);
});

// シフト編集
app.put('/api/shifts/:id', (req, res) => {
    const data = readData();
    const shiftIndex = data.shifts.findIndex(s => s.id === req.params.id);
    if (shiftIndex === -1) return res.status(404).json({ error: 'シフトが見つかりません' });

    const updatableFields = ['title', 'description', 'dates', 'deadline', 'responseType', 'slotInterval', 'required_skill_level', 'required_staff_count', 'allow_preferred_count'];
    updatableFields.forEach(field => {
        if (req.body[field] !== undefined) {
            data.shifts[shiftIndex][field] = req.body[field];
        }
    });
    data.shifts[shiftIndex].updatedAt = new Date().toISOString();

    writeData(data);
    res.json(data.shifts[shiftIndex]);
});

// シフト削除
app.delete('/api/shifts/:id', (req, res) => {
    const data = readData();
    const shiftIndex = data.shifts.findIndex(s => s.id === req.params.id);
    if (shiftIndex === -1) return res.status(404).json({ error: 'シフトが見つかりません' });

    // シフトを削除
    data.shifts.splice(shiftIndex, 1);

    // 紐づく回答データも削除
    if (data.responses) {
        data.responses = data.responses.filter(r => r.shiftId !== req.params.id && r.shift_id !== req.params.id);
    }

    writeData(data);
    res.json({ success: true });
});

// ─── スロット生成ヘルパー ───
function generateTimeSlots(startTime, endTime, intervalMin) {
    const slots = [];
    const interval = parseInt(intervalMin) || 30;
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    let cur = sh * 60 + sm;
    const end = eh * 60 + em;
    while (cur < end) {
        const next = Math.min(cur + interval, end);
        const s = `${String(Math.floor(cur / 60)).padStart(2, '0')}:${String(cur % 60).padStart(2, '0')}`;
        const e = `${String(Math.floor(next / 60)).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}`;
        slots.push(`${s}-${e}`);
        cur = next;
    }
    return slots;
}

// 手動シフト割り当て（スロット単位対応）
app.post('/api/shifts/:id/assign', (req, res) => {
    const data = readData();
    const shift = data.shifts.find(s => s.id === req.params.id);
    if (!shift) return res.status(404).json({ error: 'シフトが見つかりません' });

    const { user_id, date, slot } = req.body;

    if (date) {
        if (!shift.assignments) shift.assignments = [];
        const existing = shift.assignments.find(a => a.date === date && a.user_id === user_id && (slot ? a.slot === slot : !a.slot));
        if (!existing) {
            shift.assignments.push({ date, slot: slot || null, user_id, assignedAt: new Date().toISOString() });
        }
    } else {
        shift.assigned_user_id = user_id;
    }

    writeData(data);
    res.json({ success: true });
});

// 割り当て解除（スロット単位対応）
app.post('/api/shifts/:id/unassign', (req, res) => {
    const data = readData();
    const shift = data.shifts.find(s => s.id === req.params.id);
    if (!shift) return res.status(404).json({ error: 'シフトが見つかりません' });

    const { user_id, date, slot } = req.body;

    if (date && shift.assignments) {
        if (slot) {
            shift.assignments = shift.assignments.filter(a => !(a.date === date && a.slot === slot && a.user_id === user_id));
        } else {
            shift.assignments = shift.assignments.filter(a => !(a.date === date && a.user_id === user_id));
        }
    } else {
        shift.assigned_user_id = null;
    }

    writeData(data);
    res.json({ success: true });
});

// 自動シフト割り当てエンジン v3（スロット単位）
// 各日の各30分コマごとに、◯をつけたスタッフの中から必要人数分を公平に選ぶ
app.post('/api/shifts/auto-assign-all', (req, res) => {
    const data = readData();
    const ownerId = getOwnerId(req);
    let assignedCount = 0;
    const assignmentDetails = [];

    // ownerId対応: 自分のシフトとスタッフのみ対象
    const myShifts = ownerId
        ? data.shifts.filter(s => s.ownerId === ownerId)
        : data.shifts;
    const myStaff = ownerId
        ? data.members.filter(m => m.role === 'staff' && m.ownerId === ownerId)
        : data.members.filter(m => m.role === 'staff');

    // 全スタッフのスロット割り当て数を事前計算
    const memberSlotCounts = {};
    myStaff.forEach(m => { memberSlotCounts[m.id] = 0; });
    myShifts.forEach(s => {
        if (s.assignments) s.assignments.forEach(a => {
            memberSlotCounts[a.user_id] = (memberSlotCounts[a.user_id] || 0) + 1;
        });
    });

    myShifts.forEach(shift => {
        if (!shift.dates || shift.dates.length === 0) return;

        const requiredCount = parseInt(shift.required_staff_count) || 1;
        const interval = parseInt(shift.slotInterval) || 30;
        const shiftResponses = (data.responses || []).filter(r => r.shiftId === shift.id || r.shift_id === shift.id);
        if (!shift.assignments) shift.assignments = [];

        shift.dates.forEach(dateInfo => {
            const dateStr = dateInfo.date;
            const timeSlots = generateTimeSlots(dateInfo.startTime, dateInfo.endTime, interval);

            timeSlots.forEach(slotKey => {
                // このスロットに既に必要人数分 割り当て済みなら飛ばす
                const currentAssigned = shift.assignments.filter(a => a.date === dateStr && a.slot === slotKey);
                const needed = requiredCount - currentAssigned.length;
                if (needed <= 0) return;

                // スロットの開始・終了時間
                const [slotStart, slotEnd] = slotKey.split('-');
                const slotStartMin = parseInt(slotStart.split(':')[0]) * 60 + parseInt(slotStart.split(':')[1]);
                const slotEndMin = parseInt(slotEnd.split(':')[0]) * 60 + parseInt(slotEnd.split(':')[1]);

                // 候補者を評価
                let candidates = myStaff
                    .map(member => {
                        if (currentAssigned.some(a => a.user_id === member.id)) return null;

                        const userResponse = shiftResponses.find(r => r.userId === member.id || r.user_id === member.id);
                        if (!userResponse || !userResponse.dailyResponses) return null;

                        const daily = userResponse.dailyResponses.find(dr => dr.date === dateStr);
                        if (!daily) return null;
                        if (daily.status === 'unavailable') return null;

                        // スロットレベルのチェック
                        let canWorkSlot = false;
                        if (daily.status === 'available') {
                            canWorkSlot = true; // 全コマOK
                        } else if (daily.status === 'partial') {
                            // 個別スロットをチェック
                            if (daily.slots) {
                                // スロットインデックスから判定
                                const dateSlots = generateTimeSlots(dateInfo.startTime, dateInfo.endTime, interval);
                                const slotIdx = dateSlots.indexOf(slotKey);
                                if (slotIdx >= 0 && daily.slots[slotIdx] && daily.slots[slotIdx].status === 'available') {
                                    canWorkSlot = true;
                                }
                            }
                            // 時間指定モードの場合
                            if (daily.startTime && daily.endTime) {
                                const userStartMin = parseInt(daily.startTime.split(':')[0]) * 60 + parseInt(daily.startTime.split(':')[1]);
                                const userEndMin = parseInt(daily.endTime.split(':')[0]) * 60 + parseInt(daily.endTime.split(':')[1]);
                                if (slotStartMin >= userStartMin && slotEndMin <= userEndMin) {
                                    canWorkSlot = true;
                                }
                            }
                        }
                        if (!canWorkSlot) return null;

                        // スコア計算（公平分散）
                        let score = 0;
                        const currentCount = memberSlotCounts[member.id] || 0;
                        score -= currentCount * 10; // スロット数ベースで均等化

                        if (shift.allow_preferred_count && userResponse.preferredCount) {
                            const preferred = parseInt(userResponse.preferredCount);
                            const dayCount = shift.assignments.filter(a => a.user_id === member.id).length;
                            if (dayCount < preferred * timeSlots.length / shift.dates.length) score += 200;
                            else score -= 150;
                        }

                        score += Math.random() * 5; // ランダムシャッフル

                        // 相性ルール
                        if (data.pairings) {
                            const workingNow = shift.assignments.filter(a => a.date === dateStr && a.slot === slotKey).map(a => a.user_id);
                            data.pairings.forEach(rule => {
                                const isM1 = rule.member1_id === member.id;
                                const isM2 = rule.member2_id === member.id;
                                if (!isM1 && !isM2) return;
                                const otherId = isM1 ? rule.member2_id : rule.member1_id;
                                if (workingNow.includes(otherId)) {
                                    if (rule.type === 'pair') score += 80;
                                    if (rule.type === 'anti_pair') score -= 500;
                                }
                            });
                        }

                        return { memberId: member.id, memberName: member.name, score };
                    })
                    .filter(c => c !== null);

                candidates.sort((a, b) => b.score - a.score);
                const winners = candidates.slice(0, needed);

                winners.forEach(winner => {
                    shift.assignments.push({
                        date: dateStr,
                        slot: slotKey,
                        user_id: winner.memberId,
                        assignedAt: new Date().toISOString()
                    });
                    memberSlotCounts[winner.memberId] = (memberSlotCounts[winner.memberId] || 0) + 1;
                    assignedCount++;
                    assignmentDetails.push({
                        shiftTitle: shift.title,
                        date: dateStr,
                        slot: slotKey,
                        memberName: winner.memberName
                    });
                });
            });
        });
    });

    if (assignedCount > 0) writeData(data);
    res.json({ success: true, count: assignedCount, details: assignmentDetails });
});

app.get('/api/members', (req, res) => {
    const userId = req.cookies.user_session;
    if (!userId) return res.json([]);
    const data = readData();
    const currentUser = data.members.find(m => m.id === userId);
    if (!currentUser) return res.json([]);

    let filtered;
    if (currentUser.role === 'admin') {
        // 管理者: 自分自身 + 自分のownerId配下のスタッフのみ（他の管理者は非表示）
        filtered = data.members.filter(m =>
            m.id === currentUser.id ||
            (m.ownerId === currentUser.id && m.role !== 'admin')
        );
    } else {
        // スタッフ: 同じownerId配下のメンバーのみ
        const myOwnerId = currentUser.ownerId;
        if (!myOwnerId) return res.json([]);
        filtered = data.members.filter(m =>
            m.ownerId === myOwnerId || m.id === myOwnerId
        );
    }
    res.json(filtered.map(({ password, ...m }) => m));
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

// ==========================================
// 環境判定API（フロントエンドのテストボタン表示制御用）
// ==========================================
app.get('/api/env-mode', (req, res) => {
    const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RENDER;
    res.json({ isProduction });
});

// ==========================================
// テスト用クイックログインAPI
// ==========================================
app.post('/api/test-login', (req, res) => {
    // 本番環境ではアクセス不可
    const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RENDER;
    if (isProduction) {
        return res.status(404).json({ error: 'Not Found' });
    }

    const { role } = req.body;
    const data = readData();

    // テストアカウント定義（スタッフ5人分）
    const testAccounts = {
        admin: { username: 'admin', password: 'admin123', name: '管理者', role: 'admin' },
        staff1: { username: 'staff1', password: 'staff123', name: 'スタッフ1', role: 'staff' },
        staff2: { username: 'staff2', password: 'staff123', name: 'スタッフ2', role: 'staff' },
        staff3: { username: 'staff3', password: 'staff123', name: 'スタッフ3', role: 'staff' },
        staff4: { username: 'staff4', password: 'staff123', name: 'スタッフ4', role: 'staff' },
        staff5: { username: 'staff5', password: 'staff123', name: 'スタッフ5', role: 'staff' },
    };

    const account = testAccounts[role];
    if (!account) {
        return res.status(400).json({ error: '無効なロールです' });
    }

    // テストユーザーが存在するか検索
    let user = data.members.find(m => m.username === account.username && m.role === account.role);

    // 存在しなければ自動作成
    if (!user) {
        user = {
            id: Date.now().toString(),
            name: account.name,
            username: account.username,
            password: account.password,
            role: account.role
        };
        data.members.push(user);
        writeData(data);
    }

    // Cookieをセットしてログイン完了
    res.cookie('user_session', user.id, cookieOpts());
    const redirectUrl = role === 'admin' ? '/admin/index.html' : '/staff/index.html';
    res.json({ success: true, role: user.role, redirectUrl });
});

app.post('/api/melogout', (req, res) => {
    res.clearCookie('user_session');
    res.clearCookie('line_state');
    res.json({ success: true });
});

app.listen(PORT, () => console.log(`🚀 Urban Shift Studio 起動: http://localhost:${PORT}`));