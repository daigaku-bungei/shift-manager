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
        case 'dashboard':
            loadDashboard();
            break;
        case 'shifts':
            loadShifts();
            break;
        case 'members':
            loadMembers();
            break;
        case 'responses':
            loadResponses();
            break;
        case 'analytics':
            loadAnalytics();
            break;
    }
}

// ユーザー情報読み込み
async function loadUserInfo() {
    try {
        const response = await fetch('/api/me', {
            credentials: 'include'
        });
        
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
async function loadDashboard() {
    try {
        const shiftsRes = await fetch('/api/shifts', { credentials: 'include' });
        shifts = await shiftsRes.json();

        const membersRes = await fetch('/api/members', { credentials: 'include' });
        members = await membersRes.json();

        const responsesRes = await fetch('/api/responses', { credentials: 'include' });
        responses = await responsesRes.json();

        updateStats();
        displayRecentShifts();
    } catch (error) {
        console.error('ダッシュボードの読み込みに失敗:', error);
        showAlert('データの読み込みに失敗しました', 'error');
    }
}

// 統計更新
function updateStats() {
    document.getElementById('stat-total-shifts').textContent = shifts.length;
    document.getElementById('stat-active-members').textContent = members.length;
    document.getElementById('stat-total-responses').textContent = responses.length;
    document.getElementById('stat-pending-shifts').textContent = shifts.filter(s => !s.assigned_user_id).length;
}

// 最近のシフト表示
function displayRecentShifts() {
    const container = document.getElementById('recent-shifts-list');
    const recentShifts = shifts.slice(-5).reverse();

    if (recentShifts.length === 0) {
        container.innerHTML = '<div class="empty-state">シフトがまだありません</div>';
        return;
    }

    container.innerHTML = recentShifts.map(shift => `
        <div class="card" style="margin-bottom: 15px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h3 style="margin-bottom: 5px;">${shift.title}</h3>
                    <p style="color: var(--text-secondary); font-size: 14px;">
                        ${shift.date} ${shift.start_time || ''} ${shift.end_time ? '- ' + shift.end_time : ''}
                    </p>
                </div>
            </div>
        </div>
    `).join('');
}

// シフト一覧読み込み
async function loadShifts() {
    try {
        const response = await fetch('/api/shifts', { credentials: 'include' });
        shifts = await response.json();

        const container = document.getElementById('shifts-list');

        if (shifts.length === 0) {
            container.innerHTML = '<div class="empty-state">シフトがまだありません</div>';
            return;
        }

        container.innerHTML = shifts.map(shift => `
            <div class="card">
                <div style="display: flex; justify-content: space-between; align-items: start;">
                    <div>
                        <h2 style="margin-bottom: 8px;">${shift.title}</h2>
                        ${shift.description ? `<p style="color: var(--text-secondary); margin-bottom: 10px;">${shift.description}</p>` : ''}
                        <p style="color: var(--text-secondary); font-size: 14px;">
                            📅 ${shift.date} ${shift.start_time || ''} ${shift.end_time ? '- ' + shift.end_time : ''}
                        </p>
                    </div>
                    <button class="btn btn-danger" onclick="deleteShift('${shift.id}')">削除</button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('シフトの読み込みに失敗:', error);
        showAlert('シフトの読み込みに失敗しました', 'error');
    }
}

// メンバー一覧読み込み
async function loadMembers() {
    try {
        const response = await fetch('/api/members', { credentials: 'include' });
        members = await response.json();

        const container = document.getElementById('members-list');

        if (members.length === 0) {
            container.innerHTML = '<div class="empty-state">メンバーがいません</div>';
            return;
        }

        container.innerHTML = members.map(member => `
            <div class="card">
                <h3>${member.name}</h3>
                <p style="color: var(--text-secondary);">ID: ${member.id}</p>
            </div>
        `).join('');
    } catch (error) {
        console.error('メンバーの読み込みに失敗:', error);
    }
}

// 回答状況読み込み
async function loadResponses() {
    try {
        const response = await fetch('/api/responses', { credentials: 'include' });
        responses = await response.json();

        const container = document.getElementById('responses-list');

        if (responses.length === 0) {
            container.innerHTML = '<div class="empty-state">回答がまだありません</div>';
            return;
        }

        container.innerHTML = '<div class="card"><h3>回答一覧</h3><p>回答数: ' + responses.length + '件</p></div>';
    } catch (error) {
        console.error('回答の読み込みに失敗:', error);
    }
}

// 分析読み込み
async function loadAnalytics() {
    const container = document.getElementById('workload-chart');
    container.innerHTML = '<div class="empty-state">データを分析中...</div>';
}

// ========== カレンダー機能 ==========

// シフト作成モーダルを開く
function openCreateShiftModal() {
    document.getElementById('create-shift-modal').classList.add('active');
    selectedDates.clear();
    currentDate = new Date();
    renderCalendar();
    updateSelectedDatesList();
}

// モーダルを閉じる
function closeCreateShiftModal() {
    document.getElementById('create-shift-modal').classList.remove('active');
    document.getElementById('shift-title').value = '';
    document.getElementById('shift-description').value = '';
    selectedDates.clear();
}

// カレンダーをレンダリング
function renderCalendar() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    // 月年を表示
    const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
    document.getElementById('calendar-month-year').textContent = `${year}年 ${monthNames[month]}`;

    // カレンダーの日付を生成
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDay = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    // 前月の日数
    const prevMonthLastDay = new Date(year, month, 0).getDate();

    const calendarDays = document.getElementById('calendar-days');
    calendarDays.innerHTML = '';

    // 前月の末尾日付
    for (let i = startDay - 1; i >= 0; i--) {
        const day = prevMonthLastDay - i;
        const dayDiv = createDayElement(day, 'other-month');
        calendarDays.appendChild(dayDiv);
    }

    // 今月の日付
    const today = new Date();
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const dateStr = formatDateForCalendar(date);
        const isToday = date.toDateString() === today.toDateString();
        const isSelected = selectedDates.has(dateStr);
        const hasTime = isSelected && selectedDates.get(dateStr).startTime;

        const dayDiv = createDayElement(day, '', isToday, isSelected, hasTime, date);
        calendarDays.appendChild(dayDiv);
    }

    // 次月の最初の日付
    const remainingDays = 42 - (startDay + daysInMonth);
    for (let day = 1; day <= remainingDays; day++) {
        const dayDiv = createDayElement(day, 'other-month');
        calendarDays.appendChild(dayDiv);
    }
}

// 日付要素を作成
function createDayElement(day, className = '', isToday = false, isSelected = false, hasTime = false, date = null) {
    const dayDiv = document.createElement('div');
    dayDiv.className = 'calendar-day';
    dayDiv.textContent = day;

    if (className) dayDiv.classList.add(className);
    if (isToday) dayDiv.classList.add('today');
    if (isSelected) dayDiv.classList.add('selected');
    if (hasTime) dayDiv.classList.add('has-time');

    if (date && !className) {
        dayDiv.onclick = () => toggleDateSelection(date);
    }

    return dayDiv;
}

// 日付選択のトグル
function toggleDateSelection(date) {
    const dateStr = formatDateForCalendar(date);

    if (selectedDates.has(dateStr)) {
        selectedDates.delete(dateStr);
    } else {
        selectedDates.set(dateStr, {
            date: dateStr,
            startTime: '09:00',
            endTime: '18:00'
        });
    }

    renderCalendar();
    updateSelectedDatesList();
}

// 選択された日付リストを更新
function updateSelectedDatesList() {
    const section = document.getElementById('selected-dates-section');
    const list = document.getElementById('selected-dates-list');

    if (selectedDates.size === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';

    // 日付順にソート
    const sortedDates = Array.from(selectedDates.entries()).sort((a, b) => 
        new Date(a[0]) - new Date(b[0])
    );

    list.innerHTML = sortedDates.map(([dateStr, data]) => `
        <div class="selected-date-item">
            <div class="selected-date-header">
                <div class="selected-date-title">${formatDateDisplay(dateStr)}</div>
                <button class="remove-date-btn" onclick="removeDate('${dateStr}')">×</button>
            </div>
            <div class="time-inputs">
                <div class="form-group" style="margin-bottom: 0;">
                    <label class="form-label" style="font-size: 12px;">開始時間</label>
                    <input type="time" class="form-control" value="${data.startTime}" 
                           onchange="updateTime('${dateStr}', 'startTime', this.value)">
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                    <label class="form-label" style="font-size: 12px;">終了時間</label>
                    <input type="time" class="form-control" value="${data.endTime}" 
                           onchange="updateTime('${dateStr}', 'endTime', this.value)">
                </div>
            </div>
        </div>
    `).join('');
}

// 日付を削除
function removeDate(dateStr) {
    selectedDates.delete(dateStr);
    renderCalendar();
    updateSelectedDatesList();
}

// 時間を更新
function updateTime(dateStr, field, value) {
    if (selectedDates.has(dateStr)) {
        selectedDates.get(dateStr)[field] = value;
    }
}

// 前月へ
function previousMonth() {
    currentDate.setMonth(currentDate.getMonth() - 1);
    renderCalendar();
}

// 次月へ
function nextMonth() {
    currentDate.setMonth(currentDate.getMonth() + 1);
    renderCalendar();
}

// 日付フォーマット（カレンダー用）
function formatDateForCalendar(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// 日付フォーマット（表示用）
function formatDateDisplay(dateStr) {
    const date = new Date(dateStr);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    const dayName = dayNames[date.getDay()];
    return `${month}月${day}日(${dayName})`;
}

// ========== シフト作成 ==========

async function createComplexShift() {
    const title = document.getElementById('shift-title').value.trim();
    const description = document.getElementById('shift-description').value.trim();

    if (!title) {
        showAlert('業務名・イベント名を入力してください', 'error');
        return;
    }

    if (selectedDates.size === 0) {
        showAlert('カレンダーから日付を選択してください', 'error');
        return;
    }

    // 選択された日付を配列に変換
    const dates = Array.from(selectedDates.values());

    try {
        // 各日付に対してシフトを作成
        for (const dateData of dates) {
            const shiftData = {
                title: title,
                description: description,
                date: dateData.date,
                start_time: dateData.startTime,
                end_time: dateData.endTime
            };

            const response = await fetch('/api/shifts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(shiftData)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'シフトの作成に失敗しました');
            }
        }

        showAlert(`${dates.length}件のシフトを作成しました`, 'success');
        closeCreateShiftModal();
        loadDashboard();
        loadShifts();
    } catch (error) {
        console.error('シフト作成エラー:', error);
        showAlert(error.message || 'シフトの作成に失敗しました', 'error');
    }
}

// シフト削除
async function deleteShift(shiftId) {
    if (!confirm('このシフトを削除してもよろしいですか？')) return;

    try {
        const response = await fetch(`/api/shifts/${shiftId}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        if (response.ok) {
            showAlert('シフトを削除しました', 'success');
            loadShifts();
            loadDashboard();
        } else {
            showAlert('シフトの削除に失敗しました', 'error');
        }
    } catch (error) {
        console.error('シフト削除エラー:', error);
        showAlert('シフトの削除に失敗しました', 'error');
    }
}

// アラート表示
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
        await fetch('/api/logout', {
            method: 'POST',
            credentials: 'include'
        });
        window.location.href = '/login.html';
    } catch (error) {
        console.error('ログアウトエラー:', error);
        window.location.href = '/login.html';
    }
}
