/**
 * スタッフ - 回答入力画面
 * スタッフ間の回答内容は互いに見えず、管理者のみが一覧として確認可能
 */

document.addEventListener('DOMContentLoaded', async () => {
  const session = await checkSession();
  if (!session || !requireStaff(session)) return;

  document.getElementById('userName').textContent = `${session.name} さん`;
  document.getElementById('logoutBtn').addEventListener('click', logout);

  await loadMyRecruitments();
});

async function loadMyRecruitments() {
  const res = await fetch('/api/my-recruitments');
  const recruitments = await res.json();
  const container = document.getElementById('recruitmentList');

  if (recruitments.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <p>現在、回答する募集がありません</p>
      </div>
    `;
    return;
  }

  container.innerHTML = recruitments.map(r => `
    <div class="card">
      <h3 style="margin-bottom: 1rem;">${escapeHtml(r.title)}</h3>
      ${r.slots.map(slot => {
        const myRes = r.myResponses.find(mr => mr.slotId === slot.id);
        return `
          <div class="response-slot">
            <div class="response-slot-header">
              ${slot.date} ${slot.start} - ${slot.end}
              ${slot.position ? `（${escapeHtml(slot.position)}）` : ''}
            </div>
            <div class="response-buttons" data-recruitment-id="${r.id}" data-slot-id="${slot.id}">
              <button type="button" class="response-btn ${myRes?.availability === 'o' ? 'selected-o' : ''}" data-availability="o">○ 可能</button>
              <button type="button" class="response-btn ${myRes?.availability === 'triangle' ? 'selected-triangle' : ''}" data-availability="triangle">△ 要相談</button>
              <button type="button" class="response-btn ${myRes?.availability === 'x' ? 'selected-x' : ''}" data-availability="x">× 不可</button>
            </div>
            <div class="form-group" style="margin-top: 0.5rem;">
              <input type="text" class="form-control response-comment" placeholder="コメント（任意）" value="${escapeHtml(myRes?.comment || '')}">
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `).join('');

  // 回答ボタンイベント
  container.querySelectorAll('.response-buttons').forEach(btnGroup => {
    const recruitmentId = btnGroup.dataset.recruitmentId;
    const slotId = btnGroup.dataset.slotId;
    const commentInput = btnGroup.closest('.response-slot').querySelector('.response-comment');

    btnGroup.querySelectorAll('.response-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btnGroup.querySelectorAll('.response-btn').forEach(b => {
          b.classList.remove('selected-o', 'selected-triangle', 'selected-x');
        });
        btn.classList.add(`selected-${btn.dataset.availability}`);

        await submitResponse(recruitmentId, slotId, btn.dataset.availability, commentInput.value);
      });
    });

    commentInput.addEventListener('change', async () => {
      const selectedBtn = btnGroup.querySelector('.response-btn.selected-o, .response-btn.selected-triangle, .response-btn.selected-x');
      if (selectedBtn) {
        await submitResponse(recruitmentId, slotId, selectedBtn.dataset.availability, commentInput.value);
      }
    });
  });
}

async function submitResponse(recruitmentId, slotId, availability, comment) {
  try {
    await fetch('/api/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recruitmentId,
        slotId,
        availability,
        comment: comment || ''
      })
    });
  } catch (err) {
    alert('回答の送信に失敗しました');
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
