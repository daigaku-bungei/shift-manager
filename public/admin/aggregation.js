/**
 * 管理者 - 回答集約表示
 * スタッフ間の回答は互いに見えず、管理者のみが一覧として確認可能
 */

document.addEventListener('DOMContentLoaded', async () => {
  const session = await checkSession();
  if (!session || !requireAdmin(session)) return;

  document.getElementById('userName').textContent = `${session.name} さん`;
  document.getElementById('logoutBtn').addEventListener('click', logout);

  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (!id) {
    alert('募集IDが指定されていません');
    window.location.href = '/admin/';
    return;
  }

  await loadAggregation(id);
});

async function loadAggregation(id) {
  const res = await fetch(`/api/merecruitments/${id}/aggregation`);
  if (!res.ok) {
    alert('募集が見つかりません');
    window.location.href = '/admin/';
    return;
  }

  const { recruitment, aggregation } = await res.json();

  document.getElementById('recruitmentTitle').textContent = recruitment.title;

  const container = document.getElementById('aggregationContainer');

  container.innerHTML = aggregation.map(slot => `
    <div class="agg-slot">
      <div class="agg-slot-header">
        ${slot.date} ${slot.start} - ${slot.end}
        ${slot.position ? `（${escapeHtml(slot.position)}）` : ''}
        必要: ${slot.needed}名
      </div>
      <div class="agg-groups">
        <div class="agg-group">
          <h4><span class="badge-o">○ 可能</span> (${slot.responses.o.length}名)</h4>
          <ul>
            ${slot.responses.o.length ? slot.responses.o.map(r => `<li>${escapeHtml(r.staffName)}${r.comment ? ` <small>(${escapeHtml(r.comment)})</small>` : ''}</li>`).join('') : '<li style="color: var(--text-muted);">なし</li>'}
          </ul>
        </div>
        <div class="agg-group">
          <h4><span class="badge-triangle">△ 要相談</span> (${slot.responses.triangle.length}名)</h4>
          <ul>
            ${slot.responses.triangle.length ? slot.responses.triangle.map(r => `<li>${escapeHtml(r.staffName)}${r.comment ? ` <small>(${escapeHtml(r.comment)})</small>` : ''}</li>`).join('') : '<li style="color: var(--text-muted);">なし</li>'}
          </ul>
        </div>
        <div class="agg-group">
          <h4><span class="badge-x">× 不可</span> (${slot.responses.x.length}名)</h4>
          <ul>
            ${slot.responses.x.length ? slot.responses.x.map(r => `<li>${escapeHtml(r.staffName)}${r.comment ? ` <small>(${escapeHtml(r.comment)})</small>` : ''}</li>`).join('') : '<li style="color: var(--text-muted);">なし</li>'}
          </ul>
        </div>
      </div>
      ${slot.noResponse.length ? `
        <div style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid var(--border);">
          <h4 style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem;">未回答 (${slot.noResponse.length}名)</h4>
          <span style="font-size: 0.9rem;">${slot.noResponse.map(r => escapeHtml(r.staffName)).join(', ')}</span>
        </div>
      ` : ''}
    </div>
  `).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
