/**
 * シフト管理システム - データ層
 * JSONファイルによる永続化
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_FILE = path.join(__dirname, '../data.json');

const defaultData = {
  admins: [],
  staff: [],
  recruitments: [],
  responses: []
};

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return JSON.parse(JSON.stringify(defaultData));
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = {
  getData() {
    return loadData();
  },

  addAdmin({ id, name, password }) {
    const data = loadData();
    if (data.admins.some(a => a.id === id)) {
      throw new Error('このIDは既に使用されています');
    }
    data.admins.push({ id, name, password });
    saveData(data);
    return { id, name };
  },

  addStaff({ id, name, password, group }) {
    const data = loadData();
    if (data.staff.some(s => s.id === id)) {
      throw new Error('このIDは既に使用されています');
    }
    data.staff.push({ id, name, password, group: group || '' });
    saveData(data);
    return { id, name, group: group || '' };
  },

  createRecruitment({ title, slots, targetGroup }) {
    const data = loadData();
    const recruitment = {
      id: uuidv4(),
      title,
      slots,
      targetGroup: targetGroup || 'all',
      status: 'open',
      createdAt: new Date().toISOString()
    };
    data.recruitments.unshift(recruitment);
    saveData(data);
    return recruitment;
  },

  upsertResponse({ recruitmentId, slotId, staffId, availability, comment }) {
    const data = loadData();
    const idx = data.responses.findIndex(
      r => r.recruitmentId === recruitmentId && r.slotId === slotId && r.staffId === staffId
    );
    const response = {
      recruitmentId,
      slotId,
      staffId,
      availability,
      comment,
      updatedAt: new Date().toISOString()
    };
    if (idx >= 0) {
      data.responses[idx] = response;
    } else {
      data.responses.push(response);
    }
    saveData(data);
    return response;
  }
};
