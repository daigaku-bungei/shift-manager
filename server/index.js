/**
 * シフト管理システム - バックエンドサーバー
 * リクエスト回答型のシフト集約システム
 */

const express = require('express');
const session = require('express-session');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3456;

// ミドルウェア
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));
app.use(session({
  secret: 'shift-manager-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// 認証ミドルウェア
const requireAdmin = (req, res, next) => {
  if (req.session?.role !== 'admin') {
    return res.status(403).json({ error: '管理者権限が必要です' });
  }
  next();
};

const requireStaff = (req, res, next) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'ログインが必要です' });
  }
  next();
};

// ========== 認証 API ==========

// ログイン
app.post('/api/login', (req, res) => {
  const { userId, password, role } = req.body;
  const data = db.getData();

  if (role === 'admin') {
    const admin = data.admins.find(a => a.id === userId && a.password === password);
    if (!admin) {
      return res.status(401).json({ error: 'IDまたはパスワードが正しくありません' });
    }
    req.session.userId = admin.id;
    req.session.role = 'admin';
    req.session.userName = admin.name;
    return res.json({ success: true, role: 'admin', name: admin.name });
  }

  if (role === 'staff') {
    const staff = data.staff.find(s => s.id === userId && s.password === password);
    if (!staff) {
      return res.status(401).json({ error: 'IDまたはパスワードが正しくありません' });
    }
    req.session.userId = staff.id;
    req.session.role = 'staff';
    req.session.userName = staff.name;
    return res.json({ success: true, role: 'staff', name: staff.name });
  }

  res.status(400).json({ error: '無効なリクエストです' });
});

// ログアウト
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// セッション確認
app.get('/api/session', (req, res) => {
  if (!req.session?.userId) {
    return res.json({ loggedIn: false });
  }
  res.json({
    loggedIn: true,
    userId: req.session.userId,
    role: req.session.role,
    name: req.session.userName
  });
});

// ========== 管理者 API ==========

// スタッフ一覧取得
app.get('/api/staff', requireAdmin, (req, res) => {
  const data = db.getData();
  res.json(data.staff.map(s => ({ id: s.id, name: s.name, group: s.group || '' })));
});

// スタッフ追加
app.post('/api/staff', requireAdmin, (req, res) => {
  const { id, name, password, group } = req.body;
  if (!id || !name || !password) {
    return res.status(400).json({ error: 'ID、名前、パスワードは必須です' });
  }
  const staff = db.addStaff({ id, name, password, group: group || '' });
  res.json(staff);
});

// 募集一覧取得
app.get('/api/recruitments', requireAdmin, (req, res) => {
  const data = db.getData();
  res.json(data.recruitments);
});

// 募集作成
app.post('/api/recruitments', requireAdmin, (req, res) => {
  const { title, slots, targetGroup } = req.body;
  if (!title || !slots || !Array.isArray(slots) || slots.length === 0) {
    return res.status(400).json({ error: 'タイトルと募集枠は必須です' });
  }
  const recruitment = db.createRecruitment({
    title,
    slots: slots.map(s => ({
      id: uuidv4(),
      date: s.date,
      start: s.start,
      end: s.end,
      needed: s.needed || 1,
      position: s.position || ''
    })),
    targetGroup: targetGroup || 'all'
  });
  res.json(recruitment);
});

// 募集の回答集約取得（管理者のみ）
app.get('/api/recruitments/:id/aggregation', requireAdmin, (req, res) => {
  const data = db.getData();
  const recruitment = data.recruitments.find(r => r.id === req.params.id);
  if (!recruitment) {
    return res.status(404).json({ error: '募集が見つかりません' });
  }
  const responses = data.responses.filter(r => r.recruitmentId === req.params.id);
  const staff = data.staff;
  const aggregation = recruitment.slots.map(slot => {
    const slotResponses = responses.filter(r => r.slotId === slot.id);
    const byAvailability = { o: [], triangle: [], x: [] };
    slotResponses.forEach(r => {
      const s = staff.find(st => st.id === r.staffId);
      const entry = { staffId: r.staffId, staffName: s?.name || '不明', comment: r.comment };
      if (r.availability === 'o') byAvailability.o.push(entry);
      else if (r.availability === 'triangle') byAvailability.triangle.push(entry);
      else byAvailability.x.push(entry);
    });
    const noResponse = staff
      .filter(s => !slotResponses.some(r => r.staffId === s.id))
      .map(s => ({ staffId: s.id, staffName: s.name }));
    return {
      ...slot,
      responses: byAvailability,
      noResponse
    };
  });
  res.json({ recruitment, aggregation });
});

// ========== スタッフ API ==========

// 自分宛の募集一覧取得
app.get('/api/my-recruitments', requireStaff, (req, res) => {
  const data = db.getData();
  const staffId = req.session.userId;
  const staff = data.staff.find(s => s.id === staffId);
  const recruitments = data.recruitments
    .filter(r => r.status === 'open')
    .filter(r => r.targetGroup === 'all' || (staff?.group && r.targetGroup === staff.group))
    .map(r => ({
      ...r,
      myResponses: data.responses.filter(res => res.recruitmentId === r.id && res.staffId === staffId)
    }));
  res.json(recruitments);
});

// 回答送信
app.post('/api/responses', requireStaff, (req, res) => {
  const { recruitmentId, slotId, availability, comment } = req.body;
  if (!recruitmentId || !slotId || !availability) {
    return res.status(400).json({ error: '募集ID、枠ID、可否は必須です' });
  }
  if (!['o', 'triangle', 'x'].includes(availability)) {
    return res.status(400).json({ error: '可否は o, triangle, x のいずれかです' });
  }
  const response = db.upsertResponse({
    recruitmentId,
    slotId,
    staffId: req.session.userId,
    availability,
    comment: comment || ''
  });
  res.json(response);
});

// ========== 初期セットアップ ==========

// 初期管理者・スタッフが存在しない場合に作成
function ensureInitialData() {
  const data = db.getData();
  if (data.admins.length === 0) {
    db.addAdmin({ id: 'admin', name: '管理者', password: 'admin123' });
    console.log('初期管理者を作成しました: admin / admin123');
  }
  if (data.staff.length === 0) {
    db.addStaff({ id: 'staff1', name: 'スタッフ1', password: 'staff123', group: '' });
    db.addStaff({ id: 'staff2', name: 'スタッフ2', password: 'staff123', group: '' });
    console.log('サンプルスタッフを作成しました: staff1, staff2 / staff123');
  }
}

// サーバー起動
ensureInitialData();

app.listen(PORT, () => {
  console.log(`シフト管理システムが起動しました: http://localhost:${PORT}`);
});
