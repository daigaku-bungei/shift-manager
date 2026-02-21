let currentUser = null;
let allShifts = [];
let allResponses = [];
let currentSubmittingShift = null;

// ==========================================
// 1. 初期設定 ＆ 画面の準備
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    await loadMyInfo();
    setupNavigation();
    await loadAllData();
});

// ▼ 自分のデータを取得
async function loadMyInfo() {
    try {
        const res = await fetch('/api/me', { credentials: 'include' });
        if (!res.ok) throw new Error('未ログイン');
        currentUser = await res.json();
        
        // ヘッダーに名前を表示
        document.getElementById('user-name-badge').textContent = currentUser.name + ' さん';

        // 🌟 追加：マイページに名前とIDをデカデカと表示する！
        if (document.getElementById('mypage-name')) {
            document.getElementById('mypage-name').textContent = currentUser.name;
            // サーバーから来るユーザーIDを表示（ログイン時に使ったIDです）
            document.getElementById('mypage-id').textContent = currentUser.username || currentUser.id;
        }
    } catch (error) {
        window.location.href = '/login.html';
    }
}

// ▼ 下部タブメニューの切り替え機能
function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const sections = document.querySelectorAll('.section');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navItems.forEach(n => n.classList.remove('active'));
            sections.forEach(s => s.classList.remove('active'));

            item.classList.add('active');
            const targetId = item.getAttribute('data-section') + '-section';
            document.getElementById(targetId).classList.add('active');
            
            // 画面を切り替えるついでに最新データを読み込む
            loadAllData();
        });
    });
}

// ==========================================
// 2. データの読み込み ＆ 画面の描画
// ==========================================
async function loadAllData() {
    try {
        const [shiftsRes, responsesRes] = await Promise.all([
            fetch('/api/shifts', { credentials: 'include' }),
            fetch('/api/responses', { credentials: 'include' })
        ]);
        allShifts = await shiftsRes.json();
        allResponses = await responsesRes.json();

        renderDashboard();
        renderAvailableShifts();
        renderMyShifts();
    } catch (error) {
        console.error('データの読み込み失敗:', error);
    }
}

// ▼ 締め切りまでの残り時間を計算する便利ツール
function getDeadlineInfo(deadlineStr) {
    if (!deadlineStr) return { text: '期限なし', isUrgent: false, isExpired: false };
    
    const now = new Date();
    const deadline = new Date(deadlineStr);
    const diffMs = deadline - now;
    
    if (diffMs < 0) return { text: '回答受付終了', isUrgent: false, isExpired: true };
    
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffDays > 0) return { text: `残り ${diffDays}日`, isUrgent: false, isExpired: false };
    if (diffHours > 0) return { text: `残り ${diffHours}時間`, isUrgent: true, isExpired: false };
    return { text: `まもなく終了！`, isUrgent: true, isExpired: false };
}

// ▼ ダッシュボードの描画
function renderDashboard() {
    if (!currentUser) return;
    const myRespondedShiftIds = allResponses.filter(r => r.userId === currentUser.id).map(r => r.shiftId);
    
    const pendingShifts = allShifts.filter(s => 
        !myRespondedShiftIds.includes(s.id) && 
        (!s.deadline || new Date(s.deadline) > new Date())
    );
    
    document.getElementById('stat-pending').textContent = pendingShifts.length;
    document.getElementById('stat-confirmed').textContent = myRespondedShiftIds.length;

    const dashboardList = document.getElementById('dashboard-shift-list');
    if (pendingShifts.length === 0) {
        dashboardList.innerHTML = '<div class="empty-state">現在、新しい募集はありません☕️</div>';
    } else {
        dashboardList.innerHTML = createShiftCardsHTML(pendingShifts.slice(0, 3));
    }
}

// ▼ シフト提出（未回答）一覧の描画
function renderAvailableShifts() {
    if (!currentUser) return;
    const myRespondedShiftIds = allResponses.filter(r => r.userId === currentUser.id).map(r => r.shiftId);
    const availableShifts = allShifts.filter(s => 
        !myRespondedShiftIds.includes(s.id) && 
        (!s.deadline || new Date(s.deadline) > new Date())
    );

    const list = document.getElementById('available-shifts-list');
    if (availableShifts.length === 0) {
        list.innerHTML = '<div class="empty-state">未提出の募集はすべて完了しました！🎉</div>';
    } else {
        list.innerHTML = createShiftCardsHTML(availableShifts);
    }
}

// ▼ カードのHTMLを作る共通関数
function createShiftCardsHTML(shiftsArray) {
    return shiftsArray.map(shift => {
        const deadlineInfo = getDeadlineInfo(shift.deadline);
        const badgeClass = deadlineInfo.isUrgent ? 'deadline-badge urgent' : 'deadline-badge';
        
        return `
        <div class="card shift-card">
            <h3 class="shift-title">${shift.title || '名称未設定'}</h3>
            <div class="shift-meta">
                <span>📝 ${shift.description || '詳細なし'}</span>
                ${shift.deadline ? `<span class="${badgeClass}">⏰ 期限: ${new Date(shift.deadline).toLocaleString('ja-JP', {month:'numeric', day:'numeric', hour:'numeric', minute:'numeric'})} (${deadlineInfo.text})</span>` : ''}
            </div>
            <button class="btn btn-primary" onclick="openSubmissionModal('${shift.id}')">
                回答を入力する 🚀
            </button>
        </div>
        `;
    }).join('');
}

// ==========================================
// 3. モーダル（日別の回答入力画面）の魔法
// ==========================================
function openSubmissionModal(shiftId) {
    currentSubmittingShift = allShifts.find(s => s.id === shiftId);
    if (!currentSubmittingShift) return;

    document.getElementById('modal-shift-title').textContent = currentSubmittingShift.title;
    document.getElementById('submission-comment').value = ''; 
    
    const container = document.getElementById('submission-days-container');
    container.innerHTML = '';

    if (currentSubmittingShift.dates && currentSubmittingShift.dates.length > 0) {
        currentSubmittingShift.dates.forEach((dateInfo, index) => {
            const dateStr = new Date(dateInfo.date).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', weekday: 'short' });
            
            const dayRow = document.createElement('div');
            dayRow.className = 'submission-row';
            dayRow.innerHTML = `
                <span class="date-label">${dateStr} (${dateInfo.startTime}〜${dateInfo.endTime})</span>
                
                <div class="availability-buttons" id="btn-group-${index}">
                    <button class="avail-btn circle" onclick="selectAvail(${index}, 'circle')">◯ 行ける</button>
                    <button class="avail-btn triangle" onclick="selectAvail(${index}, 'triangle')">△ 条件付き</button>
                    <button class="avail-btn cross selected-cross" onclick="selectAvail(${index}, 'cross')">✕ むり</button>
                </div>
                
                <div class="time-inputs" id="time-inputs-${index}">
                    <span style="font-size: 12px; color: var(--text-secondary);">入れる時間:</span>
                    <input type="time" class="time-input" id="start-${index}" value="${dateInfo.startTime}">
                    <span>〜</span>
                    <input type="time" class="time-input" id="end-${index}" value="${dateInfo.endTime}">
                </div>
            `;
            container.appendChild(dayRow);
        });
    } else {
        container.innerHTML = '<p>日付が設定されていません。</p>';
    }

    document.getElementById('submission-modal').classList.add('active');
}

function closeSubmissionModal() {
    document.getElementById('submission-modal').classList.remove('active');
    currentSubmittingShift = null;
}

function selectAvail(index, type) {
    const btnGroup = document.getElementById(`btn-group-${index}`);
    const timeInputs = document.getElementById(`time-inputs-${index}`);
    
    btnGroup.querySelectorAll('.avail-btn').forEach(btn => {
        btn.classList.remove('selected-circle', 'selected-triangle', 'selected-cross');
    });

    if (type === 'circle') btnGroup.querySelector('.circle').classList.add('selected-circle');
    if (type === 'triangle') btnGroup.querySelector('.triangle').classList.add('selected-triangle');
    if (type === 'cross') btnGroup.querySelector('.cross').classList.add('selected-cross');

    if (type === 'triangle') {
        timeInputs.classList.add('active');
    } else {
        timeInputs.classList.remove('active');
    }
}

// ==========================================
// 4. サーバーへ提出する機能
// ==========================================
async function submitShiftData() {
    if (!currentSubmittingShift) return;
    if (!confirm('この内容で店長に提出しますか？')) return;

    const dailyResponses = [];
    currentSubmittingShift.dates.forEach((dateInfo, index) => {
        const btnGroup = document.getElementById(`btn-group-${index}`);
        
        let status = 'unavailable'; 
        if (btnGroup.querySelector('.selected-circle')) status = 'available';
        if (btnGroup.querySelector('.selected-triangle')) status = 'partial';

        const responseData = {
            date: dateInfo.date,
            status: status
        };

        if (status === 'partial') {
            responseData.startTime = document.getElementById(`start-${index}`).value;
            responseData.endTime = document.getElementById(`end-${index}`).value;
        }

        dailyResponses.push(responseData);
    });

    const payload = {
        shiftId: currentSubmittingShift.id,
        userId: currentUser.id,
        userName: currentUser.name,
        comment: document.getElementById('submission-comment').value,
        dailyResponses: dailyResponses,
        submittedAt: new Date().toISOString()
    };

    try {
        const res = await fetch('/api/responses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            alert('🎉 シフトの提出が完了しました！');
            closeSubmissionModal();
            loadAllData(); 
        } else {
            alert('提出に失敗しました...');
        }
    } catch (error) {
        alert('通信エラーが発生しました。');
    }
}

// ==========================================
// 5. 確定シフトの表示
// ==========================================
function renderMyShifts() {
    if (!currentUser) return;
    const list = document.getElementById('my-shifts-list');
    const myResponses = allResponses.filter(r => r.userId === currentUser.id);

    if (myResponses.length === 0) {
        list.innerHTML = '<div class="empty-state">提出済みのシフトはありません</div>';
        return;
    }

    let html = '';
    myResponses.forEach(resp => {
        const shift = allShifts.find(s => s.id === resp.shiftId);
        if (shift) {
            html += `
            <div class="card" style="border-left: 4px solid var(--success);">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <h3 style="margin-bottom: 5px; font-size: 16px;">✅ ${shift.title}</h3>
                    <span style="background: rgba(16, 185, 129, 0.1); color: var(--success); padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">提出済み</span>
                </div>
                ${resp.comment ? `<p style="font-size: 12px; color: var(--text-secondary); margin-top: 5px;">💬 ${resp.comment}</p>` : ''}
            </div>
            `;
        }
    });
    list.innerHTML = html;
}
// ==========================================
// 6. ログアウト ＆ モーダル外側クリックで閉じる機能
// ==========================================

// ▼ ログアウト機能
async function logout() {
    try {
        await fetch('/api/melogout', { method: 'POST', credentials: 'include' });
        window.location.href = '/login.html';
    } catch (error) {
        window.location.href = '/login.html';
    }
}

// ▼ モーダルの外側（暗い部分）をクリックしたら閉じる魔法
window.addEventListener('click', (e) => {
    const modal = document.getElementById('submission-modal');
    // クリックした要素（e.target）が、モーダルの背景（modal自身）だった場合のみ閉じる
    if (e.target === modal) {
        closeSubmissionModal();
    }
});