/**
 * 管理者 - 募集一覧
 */

document.addEventListener('DOMContentLoaded', async () => {
  const session = await checkSession();
  if (!session || !requireAdmin(session)) return;

  document.getElementById('userName').textContent = `${session.name} さん`;

  document.getElementById('logoutBtn').addEventListener('click', logout);

  await loadRecruitments();
});

async function loadRecruitments() {
  const res = await fetch('/api/recruitments');
  const recruitments = await res.json();
  const container = document.getElementById('recruitmentList');

  if (recruitments.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <p>募集がありません</p>
        <a href="/admin/recruit.html" class="btn btn-primary" style="margin-top: 1rem;">新規募集を作成</a>
      </div>
    `;
    return;
  }

  container.innerHTML = recruitments.map(r => `
    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 1rem;">
        <div>
          <h3 style="margin-bottom: 0.5rem;">${escapeHtml(r.title)}</h3>
          <p style="font-size: 0.85rem; color: var(--text-muted);">
            対象: ${r.targetGroup === 'all' ? '全員' : r.targetGroup} | 
            枠数: ${r.slots.length} | 
            ステータス: <span class="badge-${r.status === 'open' ? 'o' : 'x'}">${r.status === 'open' ? '募集中' : '締切'}</span>
          </p>
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <a href="/admin/aggregation.html?id=${r.id}" class="btn btn-primary btn-sm">回答集約を見る</a>
        </div>
      </div>
      <div style="margin-top: 1rem; font-size: 0.9rem;">
        ${r.slots.slice(0, 3).map(s => `${s.date} ${s.start}-${s.end} (${s.needed}名)`).join(' | ')}
        ${r.slots.length > 3 ? `... 他${r.slots.length - 3}枠` : ''}
      </div>
    </div>
  `).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
