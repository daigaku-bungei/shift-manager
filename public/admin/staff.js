/**
 * 管理者 - スタッフ管理
 */

document.addEventListener('DOMContentLoaded', async () => {
  const session = await checkSession();
  if (!session || !requireAdmin(session)) return;

  document.getElementById('userName').textContent = `${session.name} さん`;
  document.getElementById('logoutBtn').addEventListener('click', logout);

  document.getElementById('staffForm').addEventListener('submit', addStaff);
  await loadStaff();
});

async function loadStaff() {
  const res = await fetch('/api/staff');
  const staff = await res.json();
  const container = document.getElementById('staffList');

  if (staff.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>スタッフが登録されていません</p></div>';
    return;
  }

  container.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>ID</th>
          <th>名前</th>
          <th>グループ</th>
        </tr>
      </thead>
      <tbody>
        ${staff.map(s => `
          <tr>
            <td>${escapeHtml(s.id)}</td>
            <td>${escapeHtml(s.name)}</td>
            <td>${escapeHtml(s.group || '-')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function addStaff(e) {
  e.preventDefault();
  const id = document.getElementById('staffId').value.trim();
  const name = document.getElementById('staffName').value.trim();
  const password = document.getElementById('staffPassword').value;
  const group = document.getElementById('staffGroup').value.trim();

  try {
    const res = await fetch('/api/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name, password, group })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'エラーが発生しました');
    }
    document.getElementById('staffForm').reset();
    await loadStaff();
    alert('スタッフを追加しました');
  } catch (err) {
    alert(err.message);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
