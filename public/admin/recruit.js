/**
 * 管理者 - 新規募集作成
 */

let slotCount = 0;

document.addEventListener('DOMContentLoaded', async () => {
  const session = await checkSession();
  if (!session || !requireAdmin(session)) return;

  document.getElementById('userName').textContent = `${session.name} さん`;
  document.getElementById('logoutBtn').addEventListener('click', logout);

  await loadStaffGroups();
  addSlot();
  document.getElementById('addSlotBtn').addEventListener('click', addSlot);
  document.getElementById('recruitForm').addEventListener('submit', submitRecruitment);
});

async function loadStaffGroups() {
  const res = await fetch('/api/mestaff');
  const staff = await res.json();
  const groups = [...new Set(staff.map(s => s.group).filter(Boolean))];
  const select = document.getElementById('targetGroup');
  select.innerHTML = '<option value="all">全スタッフ</option>';
  groups.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g;
    opt.textContent = g;
    select.appendChild(opt);
  });
}

function addSlot() {
  const id = ++slotCount;
  const container = document.getElementById('slotsContainer');
  const div = document.createElement('div');
  div.className = 'slot-item';
  div.dataset.slotId = id;
  div.innerHTML = `
    <div class="form-group">
      <label>日付</label>
      <input type="date" class="form-control slot-date" required>
    </div>
    <div class="form-group">
      <label>開始</label>
      <input type="time" class="form-control slot-start" required>
    </div>
    <div class="form-group">
      <label>終了</label>
      <input type="time" class="form-control slot-end" required>
    </div>
    <div class="form-group">
      <label>必要人数</label>
      <input type="number" class="form-control slot-needed" value="1" min="1" style="width: 70px;">
    </div>
    <div class="form-group">
      <label>ポジション</label>
      <input type="text" class="form-control slot-position" placeholder="例: レジ">
    </div>
    <button type="button" class="btn btn-secondary btn-sm remove-slot">削除</button>
  `;
  container.appendChild(div);

  const today = new Date().toISOString().split('T')[0];
  div.querySelector('.slot-date').value = today;

  div.querySelector('.remove-slot').addEventListener('click', () => {
    if (container.querySelectorAll('.slot-item').length > 1) {
      div.remove();
    } else {
      alert('最低1つの募集枠が必要です');
    }
  });
}

async function submitRecruitment(e) {
  e.preventDefault();
  const title = document.getElementById('title').value.trim();
  const targetGroup = document.getElementById('targetGroup').value;
  const slotItems = document.querySelectorAll('.slot-item');

  const slots = [];
  for (const item of slotItems) {
    const date = item.querySelector('.slot-date').value;
    const start = item.querySelector('.slot-start').value;
    const end = item.querySelector('.slot-end').value;
    const needed = parseInt(item.querySelector('.slot-needed').value) || 1;
    const position = item.querySelector('.slot-position').value.trim();
    if (!date || !start || !end) {
      alert('すべての枠に日付・時間を入力してください');
      return;
    }
    slots.push({ date, start, end, needed, position });
  }

  try {
    const res = await fetch('/api/merecruitments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, slots, targetGroup })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'エラーが発生しました');
    }
    alert('募集を開始しました');
    window.location.href = '/admin/';
  } catch (err) {
    alert(err.message);
  }
}
