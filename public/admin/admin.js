// グローバル変数
let currentUser = null;
let shifts = [];
let members = [];
let responses = [];

// カレンダー関連の変数
let currentDate = new Date();
let selectedDates = new Map(); // キー: 日付文字列、値: {date, startTime, endTime}

// 初期化
document.addEventListener('DOMContentLoaded', async () => {
    await loadUserInfo();
    await loadDashboard();
    setupNavigation();
    setupForms();
});

// ナビゲーション設定
function setupNavigation() {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            const section = e.target.dataset.section;
            switchSection(section);
        });
    });
}

// セクション切り替え
function switchSection(sectionName) {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.dataset.section === sectionName) {
            link.classList.add('active');
        }
    });

    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });
    document.getElementById(`${sectionName}-section`).classList.add('active');

    switch(sectionName) {
        case 'dashboard': loadDashboard(); break;
        case 'shifts': loadShifts(); break;
        case 'members': loadMembers(); break;
        case 'responses': loadResponses(); break;
        case 'analytics': loadAnalytics(); break;
    }
}

// ユーザー情報読み込み
async function loadUserInfo() {
    try {
        const response = await fetch('/api/me', { credentials: 'include' });
        if (response.ok) {
            currentUser = await response.json();
            document.getElementById('admin-name').textContent = currentUser.name || '管理者';
        } else {
            window.location.href = '/login.html';
        }
    } catch (error) {
        console.error('ユーザー情報の取得に失敗:', error);
        window.location.href = '/login.html';
    }
}

// ダッシュボード読み込み
// シフト一覧読み込み（新・期限対応版！）
async function loadShifts() {
    try {
        const response = await fetch('/api/shifts', { credentials: 'include' });
        shifts = await response.json();

        const container = document.getElementById('shifts-list');

        if (shifts.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><h2>シフトがまだありません</h2><p>新規シフトを作成してください</p></div>';
            return;
        }

        container.innerHTML = shifts.map(shift => {
            const assignedMember = members.find(m => m.id === shift.assigned_user_id);
            
            // 🌟 追加：提出期限のラベルをカッコよく表示！
            let deadlineHtml = '';
            if (shift.deadline) {
                const dt = new Date(shift.deadline);
                const isExpired = dt < new Date();
                deadlineHtml = `<div style="display: inline-block; padding: 4px 8px; border-radius: 6px; font-size: 12px; font-weight: bold; margin-bottom: 12px; ${isExpired ? 'background: #fee2e2; color: #ef4444;' : 'background: #fffbeb; color: #d97706; border: 1px solid #fcd34d;'}">⏰ 提出期限: ${dt.toLocaleString('ja-JP', {month:'numeric', day:'numeric', hour:'numeric', minute:'numeric'})} ${isExpired ? '(終了)' : ''}</div>`;
            }

            return `
                <div class="card">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 15px;">
                        <div>
                            <h2 style="margin-bottom: 8px;">${shift.title}</h2>
                            ${deadlineHtml} ${shift.description ? `<p style="color: var(--text-secondary); margin-bottom: 10px;">${shift.description}</p>` : ''}
                            <div style="color: var(--text-secondary); font-size: 14px;">
                                ${shift.dates ? shift.dates.map(d => `<p>📅 ${formatDate(d.date)} ${d.startTime} - ${d.endTime}</p>`).join('') : `<p>📅 ${shift.date}</p>`}
                            </div>
                        </div>
                        <button class="btn btn-danger" onclick="deleteShift('${shift.id}')">削除</button>
                    </div>

                    ${assignedMember ? `
                        <div style="padding: 15px; background: var(--bg-tertiary); border-radius: 8px; margin-bottom: 15px;">
                            <strong>割当済:</strong> ${assignedMember.name} 
                            <span class="skill-badge skill-lv${assignedMember.skill_level}">Lv ${assignedMember.skill_level}</span>
                        </div>
                    ` : `
                        <div style="padding: 15px; background: rgba(245, 158, 11, 0.1); border: 1px solid var(--warning); border-radius: 8px; margin-bottom: 15px;">
                            <strong style="color: var(--warning);">未割当</strong>
                        </div>
                    `}
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('シフトの読み込みに失敗:', error);
        showAlert('シフトの読み込みに失敗しました', 'error');
    }
}

// 統計更新
function updateStats() {
    document.getElementById('stat-total-shifts').textContent = shifts.length;
    document.getElementById('stat-active-members').textContent = members.filter(m => m.role === 'staff').length;
    document.getElementById('stat-total-responses').textContent = responses.length;
    document.getElementById('stat-pending-shifts').textContent = shifts.filter(s => !s.assigned_user_id).length;
}

// 最近のシフト表示
function displayRecentShifts() {
    const container = document.getElementById('recent-shifts-list');
    const recentShifts = shifts.slice(-5).reverse();

    if (recentShifts.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">📅</div><p>シフトがまだありません</p></div>';
        return;
    }

    container.innerHTML = recentShifts.map(shift => `
        <div class="card" style="margin-bottom: 15px; padding: 15px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h3 style="margin-bottom: 5px;">${shift.title}</h3>
                    <p style="color: var(--text-secondary); font-size: 14px;">
                        ${shift.dates && shift.dates.length > 0 ? `${formatDate(shift.dates[0].date)} ${shift.dates[0].startTime} - ${shift.dates[0].endTime}` : (shift.date ? `${formatDate(shift.date)}` : '未定')}
                    </p>
                </div>
                <div>
                    ${shift.assigned_user_id ? `<span class="badge badge-success">割当済</span>` : `<span class="badge badge-warning">未割当</span>`}
                </div>
            </div>
        </div>
    `).join('');
}

// シフト一覧読み込み（高機能版を復元！）
async function loadShifts() {
    try {
        const response = await fetch('/api/shifts', { credentials: 'include' });
        shifts = await response.json();

        const container = document.getElementById('shifts-list');

        if (shifts.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><h2>シフトがまだありません</h2><p>新規シフトを作成してください</p></div>';
            return;
        }

        container.innerHTML = shifts.map(shift => {
            const assignedMember = members.find(m => m.id === shift.assigned_user_id);
            const shiftResponses = responses.filter(r => r.shift_id === shift.id);
            const availableCount = shiftResponses.filter(r => r.response === 'available').length;

            return `
                <div class="card">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 15px;">
                        <div>
                            <h2 style="margin-bottom: 8px;">${shift.title}</h2>
                            ${shift.description ? `<p style="color: var(--text-secondary); margin-bottom: 10px;">${shift.description}</p>` : ''}
                            <div style="color: var(--text-secondary); font-size: 14px;">
                                ${shift.dates ? shift.dates.map(d => `<p>📅 ${formatDate(d.date)} ${d.startTime} - ${d.endTime}</p>`).join('') : `<p>📅 ${shift.date}</p>`}
                            </div>
                            <p style="color: var(--text-secondary); font-size: 14px; margin-top: 5px;">
                                必要スキル: <span class="skill-badge skill-lv${shift.required_skill_level || 1}">Lv ${shift.required_skill_level || 1}</span>
                            </p>
                        </div>
                        <button class="btn btn-danger" onclick="deleteShift('${shift.id}')">削除</button>
                    </div>

                    ${assignedMember ? `
                        <div style="padding: 15px; background: var(--bg-tertiary); border-radius: 8px; margin-bottom: 15px;">
                            <strong>割当済:</strong> ${assignedMember.name} 
                            <span class="skill-badge skill-lv${assignedMember.skill_level}">Lv ${assignedMember.skill_level}</span>
                        </div>
                    ` : `
                        <div style="padding: 15px; background: rgba(245, 158, 11, 0.1); border: 1px solid var(--warning); border-radius: 8px; margin-bottom: 15px;">
                            <strong style="color: var(--warning);">未割当</strong>
                        </div>
                    `}

                    ${!assignedMember && availableCount > 0 ? `
                        <div style="margin-top: 15px;">
                            <strong style="margin-bottom: 10px; display: block;">「行ける」と回答したメンバー (${availableCount}名)</strong>
                            ${shiftResponses.filter(r => r.response === 'available').map(r => {
                                const member = members.find(m => m.id === r.user_id);
                                if (!member) return '';
                                
                                const reqSkill = shift.required_skill_level || 1;
                                const canAssign = member.skill_level >= reqSkill;
                                
                                return `
                                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background: var(--bg-tertiary); border-radius: 8px; margin-bottom: 8px;">
                                        <div>
                                            ${member.name} 
                                            <span class="skill-badge skill-lv${member.skill_level}">Lv ${member.skill_level}</span>
                                            ${!canAssign ? '<span class="badge badge-danger" style="margin-left: 10px;">スキル不足</span>' : ''}
                                        </div>
                                        ${canAssign ? `
                                            <button class="btn btn-success" style="padding: 6px 12px; font-size: 13px;" onclick="assignShift('${shift.id}', '${member.id}')">
                                                割り当て
                                            </button>
                                        ` : ''}
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('シフトの読み込みに失敗:', error);
        showAlert('シフトの読み込みに失敗しました', 'error');
    }
}

// シフト割り当て（復元！）
async function assignShift(shiftId, userId) {
    try {
        const response = await fetch(`/api/shifts/${shiftId}/assign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ user_id: userId })
        });

        if (response.ok) {
            showAlert('シフトを割り当てました', 'success');
            loadShifts();
            loadDashboard();
        } else {
            const error = await response.json();
            showAlert(error.error || 'シフトの割り当てに失敗しました', 'error');
        }
    } catch (error) {
        console.error('シフト割り当てエラー:', error);
        showAlert('シフトの割り当てに失敗しました', 'error');
    }
}

// メンバー一覧読み込み
async function loadMembers() {
    try {
        const response = await fetch('/api/members', { credentials: 'include' });
        members = await response.json();

        const tbody = document.getElementById('members-tbody');

        if (members.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 40px; color: var(--text-secondary);">メンバーがいません</td></tr>';
            return;
        }

        tbody.innerHTML = members.map(member => `
            <tr>
                <td>${member.name}</td>
                <td>${member.id}</td>
                <td><span class="skill-badge skill-lv3">${member.group || '未設定'}</span></td>
                <td style="color: var(--text-secondary);">-</td>
                <td>
                    <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 13px; margin-right: 5px;" onclick="openEditMemberModal('${member.id}')">編集</button>
                    ${member.role !== 'admin' ? `<button class="btn btn-danger" style="padding: 6px 12px; font-size: 13px;" onclick="deleteMember('${member.id}')">削除</button>` : ''}
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('メンバーの読み込みに失敗:', error);
        showAlert('メンバーの読み込みに失敗しました', 'error');
    }
}

// メンバー削除
async function deleteMember(memberId) {
    if (!confirm('このメンバーを削除してもよろしいですか？')) return;
    try {
        const response = await fetch(`/api/members/${memberId}`, { method: 'DELETE', credentials: 'include' });
        if (response.ok) {
            showAlert('メンバーを削除しました', 'success');
            loadMembers();
            loadDashboard();
        } else {
            showAlert('メンバーの削除に失敗しました', 'error');
        }
    } catch (error) {
        console.error('メンバー削除エラー:', error);
        showAlert('通信エラーが発生しました', 'error');
    }
}

// 編集モーダルを開く
function openEditMemberModal(memberId) {
    const member = members.find(m => m.id === memberId);
    if (!member) return;
    document.getElementById('edit-member-id').value = member.id;
    document.getElementById('edit-member-name').value = member.name;
    document.getElementById('edit-member-group').value = member.group || '';
    document.getElementById('edit-member-password').value = '';
    document.getElementById('edit-member-modal').classList.add('active');
}

// フォーム設定（メンバー追加・編集）
function setupForms() {
    const addForm = document.getElementById('add-member-form');
    if (addForm) {
        addForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData);
            data.role = 'staff';
            try {
                const response = await fetch('/api/meregister', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(data)
                });
                if (response.ok) {
                    showAlert('メンバーを追加しました', 'success');
                    closeModal('add-member-modal');
                    e.target.reset();
                    loadMembers();
                    loadDashboard();
                } else {
                    const error = await response.json();
                    showAlert(error.error || '追加に失敗しました', 'error');
                }
            } catch (error) {
                console.error('メンバー追加エラー:', error);
                showAlert('追加に失敗しました', 'error');
            }
        });
    }

    const editForm = document.getElementById('edit-member-form');
    if (editForm) {
        editForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData);
            const memberId = data.id;
            if (!data.password) delete data.password;
            try {
                const response = await fetch(`/api/members/${memberId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(data)
                });
                if (response.ok) {
                    showAlert('メンバー情報を更新しました！', 'success');
                    closeModal('edit-member-modal');
                    loadMembers();
                } else {
                    showAlert('更新に失敗しました', 'error');
                }
            } catch (error) {
                console.error('メンバー更新エラー:', error);
                showAlert('通信エラーが発生しました', 'error');
            }
        });
    }
}

// 回答状況読み込み（日別の◯△✕対応版！）
async function loadResponses() {
    try {
        const response = await fetch('/api/responses', { credentials: 'include' });
        responses = await response.json();

        const container = document.getElementById('responses-list');

        if (shifts.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">📝</div><p>シフトがまだありません</p></div>';
            return;
        }

        container.innerHTML = shifts.map(shift => {
            // 新しいデータ形式 (shiftId) に対応して回答を探す
            const shiftResponses = responses.filter(r => r.shiftId === shift.id || r.shift_id === shift.id);
            
            if (shiftResponses.length === 0) {
                return `
                <div class="card">
                    <h2 style="margin-bottom: 8px;">${shift.title}</h2>
                    <p style="color: var(--text-secondary);">まだ回答がありません</p>
                </div>`;
            }

            // 日別の回答をまとめるHTMLを作る
            let dailyHtml = '';
            if (shift.dates && shift.dates.length > 0) {
                shift.dates.forEach(dateInfo => {
                    const dateStr = formatDate(dateInfo.date);
                    
                    // この日の「行ける」「条件付き」「むり」の人を分ける箱
                    const available = [];
                    const partial = [];
                    const unavailable = [];

                    shiftResponses.forEach(r => {
                        if (!r.dailyResponses) return; // 古いデータはスキップ
                        const dayResp = r.dailyResponses.find(dr => dr.date === dateInfo.date);
                        if (dayResp) {
                            if (dayResp.status === 'available') available.push(r.userName);
                            if (dayResp.status === 'partial') partial.push(`${r.userName} (${dayResp.startTime}〜${dayResp.endTime})`);
                            if (dayResp.status === 'unavailable') unavailable.push(r.userName);
                        }
                    });

                    dailyHtml += `
                        <div style="margin-bottom: 15px; border: 1px solid var(--border-color); border-radius: 8px; padding: 10px;">
                            <h4 style="margin-bottom: 10px; background: var(--bg-tertiary); padding: 5px; border-radius: 4px;">📅 ${dateStr}</h4>
                            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
                                <div style="color: var(--success); font-size: 13px; background: rgba(16, 185, 129, 0.05); padding: 8px; border-radius: 4px;"><strong>◯ 行ける:</strong><br>${available.join('<br>') || 'なし'}</div>
                                <div style="color: var(--warning); font-size: 13px; background: rgba(245, 158, 11, 0.05); padding: 8px; border-radius: 4px;"><strong>△ 条件付き:</strong><br>${partial.join('<br>') || 'なし'}</div>
                                <div style="color: var(--danger); font-size: 13px; background: rgba(239, 68, 68, 0.05); padding: 8px; border-radius: 4px;"><strong>✕ むり:</strong><br>${unavailable.join('<br>') || 'なし'}</div>
                            </div>
                        </div>
                    `;
                });
            }

            return `
                <div class="card">
                    <h2 style="margin-bottom: 8px;">${shift.title}</h2>
                    <p style="color: var(--text-secondary); margin-bottom: 15px; font-size: 14px;">総回答数: ${shiftResponses.length}件</p>
                    <div>
                        ${dailyHtml}
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('回答の読み込みに失敗:', error);
        showAlert('回答の読み込みに失敗しました', 'error');
    }
}

// 分析読み込み（高機能版を復元！）
async function loadAnalytics() {
    try {
        const container = document.getElementById('workload-chart');

        const workloadData = members.filter(m => m.role === 'staff').map(member => {
            const memberShifts = shifts.filter(s => s.assigned_user_id === member.id);
            const totalHours = memberShifts.reduce((sum, shift) => {
                // シンプルな計算のための仮実装
                return sum + 5; 
            }, 0);

            return { member, hours: totalHours };
        }).sort((a, b) => b.hours - a.hours);

        const maxHours = Math.max(...workloadData.map(d => d.hours), 1);

        container.innerHTML = workloadData.map(data => `
            <div style="margin-bottom: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <div>
                        <strong>${data.member.name}</strong>
                        <span class="skill-badge skill-lv3" style="margin-left: 10px;">${data.member.group || '未設定'}</span>
                    </div>
                    <strong style="color: var(--accent-primary);">${data.hours.toFixed(1)}時間</strong>
                </div>
                <div style="background: var(--bg-tertiary); border-radius: 8px; overflow: hidden;">
                    <div style="background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary)); height: 12px; width: ${(data.hours / maxHours * 100)}%; transition: width 0.5s;"></div>
                </div>
            </div>
        `).join('');

        if (workloadData.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><p>データがありません</p></div>';
        }
    } catch (error) {
        console.error('分析の読み込みに失敗:', error);
        showAlert('分析の読み込みに失敗しました', 'error');
    }
}

// ========== カレンダー機能 ==========

// ========== カレンダー機能 ==========

// ドラッグ選択用の変数
let isDragging = false;
let dragStartDate = null;
let dragMode = 'select';

function openAddMemberModal() { document.getElementById('add-member-modal').classList.add('active'); }
function closeAddMemberModal() { closeModal('add-member-modal'); }

function openCreateShiftModal() {
    document.getElementById('create-shift-modal').classList.add('active');
    selectedDates.clear();
    currentDate = new Date();
    renderCalendar();
    updateSelectedDatesList();
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
}

function closeCreateShiftModal() {
    closeModal('create-shift-modal');
    document.getElementById('shift-title').value = '';
    document.getElementById('shift-description').value = '';
    selectedDates.clear();
}

function updateDateEntryTemplate() {
    const responseType = document.getElementById('response-type').value;
    const hint = document.getElementById('response-type-hint');
    const slotSettings = document.getElementById('slot-settings');

    if (responseType === 'timerange') {
        hint.textContent = 'ユーザーが「10:00〜15:00」のように自由に時間を入力する形式';
        slotSettings.style.display = 'none';
    } else {
        hint.textContent = '指定した時間範囲を30分/1時間単位に分割し、チェックボックスで選択する形式';
        slotSettings.style.display = 'block';
    }
}

function renderCalendar() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
    document.getElementById('calendar-month-year').textContent = `${year}年 ${monthNames[month]}`;

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDay = firstDay.getDay();
    const daysInMonth = lastDay.getDate();
    const prevMonthLastDay = new Date(year, month, 0).getDate();

    const calendarDays = document.getElementById('calendar-days');
    calendarDays.innerHTML = '';

    for (let i = startDay - 1; i >= 0; i--) {
        calendarDays.appendChild(createDayElement(prevMonthLastDay - i, 'other-month'));
    }

    const today = new Date();
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const dateStr = formatDateForCalendar(date);
        const isToday = date.toDateString() === today.toDateString();
        const isSelected = selectedDates.has(dateStr);
        const hasTime = isSelected && selectedDates.get(dateStr).startTime;

        calendarDays.appendChild(createDayElement(day, '', isToday, isSelected, hasTime, date));
    }

    const remainingDays = 42 - (startDay + daysInMonth);
    for (let day = 1; day <= remainingDays; day++) {
        calendarDays.appendChild(createDayElement(day, 'other-month'));
    }
}

function createDayElement(day, className = '', isToday = false, isSelected = false, hasTime = false, date = null) {
    const dayDiv = document.createElement('div');
    dayDiv.className = 'calendar-day';
    dayDiv.textContent = day;

    if (className) dayDiv.classList.add(className);
    if (isToday) dayDiv.classList.add('today');
    if (isSelected) dayDiv.classList.add('selected');
    if (hasTime) dayDiv.classList.add('has-time');

    if (date && !className) {
        // ▼▼ ドラッグ選択の魔法！ ▼▼
        dayDiv.addEventListener('mousedown', (e) => {
            e.preventDefault(); // テキスト選択防止
            isDragging = true;
            dragStartDate = new Date(date);
            const dateStr = formatDateForCalendar(date);
            // 最初の日が選択済みなら「解除モード」、未選択なら「選択モード」になる
            dragMode = selectedDates.has(dateStr) ? 'deselect' : 'select';
            processDragSelection(date);
        });

        dayDiv.addEventListener('mouseenter', () => {
            if (isDragging) {
                processDragSelection(date);
            }
        });
    }
    return dayDiv;
}

// ドラッグでなぞった範囲を処理する関数
function processDragSelection(currentDateObj) {
    if (!dragStartDate) return;
    
    const start = dragStartDate < currentDateObj ? dragStartDate : currentDateObj;
    const end = dragStartDate < currentDateObj ? currentDateObj : dragStartDate;
    
    // 一括設定欄の時間を取得
    const bulkStart = document.getElementById('bulk-start-time') ? document.getElementById('bulk-start-time').value : '09:00';
    const bulkEnd = document.getElementById('bulk-end-time') ? document.getElementById('bulk-end-time').value : '18:00';
    
    let loop = new Date(start);
    while (loop <= end) {
        const dStr = formatDateForCalendar(loop);
        if (dragMode === 'select') {
            if (!selectedDates.has(dStr)) {
                selectedDates.set(dStr, {
                    date: dStr,
                    startTime: bulkStart,
                    endTime: bulkEnd
                });
            }
        } else {
            selectedDates.delete(dStr);
        }
        loop.setDate(loop.getDate() + 1);
    }
    
    renderCalendar();
    updateSelectedDatesList();
}

// 一括時間を適用する関数
function applyBulkTime() {
    const bulkStart = document.getElementById('bulk-start-time').value;
    const bulkEnd = document.getElementById('bulk-end-time').value;
    
    selectedDates.forEach((data, dateStr) => {
        data.startTime = bulkStart;
        data.endTime = bulkEnd;
    });
    
    updateSelectedDatesList();
}

function updateSelectedDatesList() {
    const section = document.getElementById('selected-dates-section');
    const list = document.getElementById('selected-dates-list');

    if (selectedDates.size === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    const sortedDates = Array.from(selectedDates.entries()).sort((a, b) => new Date(a[0]) - new Date(b[0]));

    // 横1行の超コンパクトデザイン！
    list.innerHTML = sortedDates.map(([dateStr, data]) => `
        <div class="selected-date-item">
            <div class="selected-date-header">
                <div class="selected-date-title">${formatDateDisplay(dateStr)}</div>
            </div>
            <div class="time-inputs">
                <input type="time" class="form-control" value="${data.startTime}" onchange="updateTime('${dateStr}', 'startTime', this.value)">
                <span style="color: var(--text-secondary); font-weight: bold; font-size: 12px;">〜</span>
                <input type="time" class="form-control" value="${data.endTime}" onchange="updateTime('${dateStr}', 'endTime', this.value)">
            </div>
            <button class="remove-date-btn" onclick="removeDate('${dateStr}')" title="削除">×</button>
        </div>
    `).join('');
}

function removeDate(dateStr) {
    selectedDates.delete(dateStr);
    renderCalendar();
    updateSelectedDatesList();
}

function updateTime(dateStr, field, value) {
    if (selectedDates.has(dateStr)) selectedDates.get(dateStr)[field] = value;
}

function previousMonth() { currentDate.setMonth(currentDate.getMonth() - 1); renderCalendar(); }
function nextMonth() { currentDate.setMonth(currentDate.getMonth() + 1); renderCalendar(); }

function formatDateForCalendar(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatDateDisplay(dateStr) {
    const date = new Date(dateStr);
    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    return `${date.getMonth() + 1}月${date.getDate()}日(${dayNames[date.getDay()]})`;
}

// ========== ユーティリティ ==========
function formatDate(dateString) {
    const date = new Date(dateString);
    if (isNaN(date)) return dateString;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}/${month}/${day}`;
}

function showAlert(message, type = 'success') {
    const container = document.getElementById('alert-container');
    const alert = document.createElement('div');
    alert.className = `alert alert-${type}`;
    alert.textContent = message;
    container.appendChild(alert);
    setTimeout(() => {
        alert.style.opacity = '0';
        setTimeout(() => alert.remove(), 300);
    }, 3000);
}

// ログアウト
async function logout() {
    try {
        // Claudeが勝手に変えていたのを、元の正しい '/api/melogout' に戻します！
        await fetch('/api/melogout', { method: 'POST', credentials: 'include' });
        window.location.href = '/login.html';
    } catch (error) {
        console.error('ログアウトエラー:', error);
        window.location.href = '/login.html';
    }
}

// 外側クリックとドラッグ終了の魔法
window.addEventListener('mouseup', (e) => {
    // ドラッグ終了
    if (isDragging) {
        isDragging = false;
        renderCalendar();
        updateSelectedDatesList();
    }
    // モーダルの外側クリック
    if (e.target.classList.contains('modal')) {
        e.target.classList.remove('active');
    }
});
// ========== シフト一括作成機能 ==========
async function createComplexShift() {
    const title = document.getElementById('shift-title').value.trim();
    const description = document.getElementById('shift-description').value.trim();
    const responseType = document.getElementById('response-type') ? document.getElementById('response-type').value : 'slot';
    const slotInterval = document.getElementById('slot-interval') ? document.getElementById('slot-interval').value : '30';
    
    // 🌟 1. HTMLから期限のデータを取得する！
    const deadline = document.getElementById('shift-deadline') ? document.getElementById('shift-deadline').value : '';

    // 🌟 2. 期限が空っぽの時はエラーを出すように変更！
    if (!title || !deadline) {
        showAlert('業務名・イベント名と、提出期限を必ず入力してください', 'error');
        return;
    }

    if (selectedDates.size === 0) {
        showAlert('カレンダーから日付を選択してください', 'error');
        return;
    }

    const dates = Array.from(selectedDates.values());

    const newShiftData = {
        title: title,
        description: description,
        responseType: responseType,
        slotInterval: slotInterval,
        deadline: deadline, // 🌟 3. サーバーに送るデータ（ボール）に期限を入れる！
        dates: dates, 
        required_skill_level: 1 
    };

    try {
        const response = await fetch('/api/shifts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(newShiftData)
        });

        if (response.ok) {
            showAlert('シフトを作成して公開しました！', 'success');
            closeCreateShiftModal();
            // 🌟 4. 次開いた時のために期限の入力欄を空に戻しておく
            if(document.getElementById('shift-deadline')) document.getElementById('shift-deadline').value = '';
            loadShifts();
            loadDashboard();
        } else {
            showAlert('シフトの作成に失敗しました', 'error');
        }
    } catch (error) {
        console.error('シフト作成エラー:', error);
        showAlert('通信エラーが発生しました', 'error');
    }
}

// シフト削除
async function deleteShift(shiftId) {
    if (!confirm('このシフトを削除してもよろしいですか？')) return;
    try {
        const response = await fetch(`/api/shifts/${shiftId}`, { method: 'DELETE', credentials: 'include' });
        if (response.ok) {
            showAlert('シフトを削除しました', 'success');
            loadShifts();
            loadDashboard();
        } else {
            showAlert('シフトの削除に失敗しました', 'error');
        }
    } catch (error) {
        console.error('シフト削除エラー:', error);
    }
}
// ==========================================
// ID検索 ＆ スタッフ追加（案1の機能）
// ==========================================

// ① IDを検索する機能
async function searchStaff() {
    const targetId = document.getElementById('search-staff-id').value.trim();
    if (!targetId) return alert('IDを入力してください！');

    try {
        const response = await fetch(`/api/members/search?username=${encodeURIComponent(targetId)}`);
        const result = await response.json();

        if (result.success) {
            // 見つかったら結果エリアを表示！
            document.getElementById('search-result-name').textContent = result.user.name + ' さん';
            document.getElementById('search-result-id').textContent = result.user.username;
            
            // 状態によって表示を変える
            if (result.user.role === 'staff' || result.user.role === 'admin') {
                document.getElementById('search-result-area').innerHTML = '<p style="color: var(--success); font-weight: bold;">✅ すでにスタッフとして登録済みです！</p>';
            }
            document.getElementById('search-result-area').style.display = 'block';
        } else {
            alert('ユーザーが見つかりません。IDが間違っていないか確認してください。');
            document.getElementById('search-result-area').style.display = 'none';
        }
    } catch (error) {
        alert('検索中にエラーが発生しました。');
    }
}

// ② 見つかった人をスタッフとして承認（追加）する機能
async function approveStaff() {
    const targetId = document.getElementById('search-result-id').textContent;

    try {
        const response = await fetch('/api/members/approve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: targetId })
        });
        const result = await response.json();

        if (result.success) {
            alert('🎉 スタッフの追加が完了しました！');
            closeAddMemberModal();
            // もしメンバー一覧を再読み込みする関数(loadMembers等)があればここで呼ぶ
            location.reload(); // 一旦ページ更新で反映させます
        } else {
            alert(result.message);
        }
    } catch (error) {
        alert('追加中にエラーが発生しました。');
    }
}