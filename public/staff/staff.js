let currentUser = null;
let allShifts = [];
let allResponses = [];


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
let mySchedules = [];

async function loadAllData() {
    try {
        const [shiftsRes, responsesRes, schedulesRes] = await Promise.all([
            fetch('/api/shifts', { credentials: 'include' }),
            fetch('/api/responses', { credentials: 'include' }),
            fetch('/api/me/schedules', { credentials: 'include' })
        ]);
        allShifts = await shiftsRes.json();
        allResponses = await responsesRes.json();

        if (schedulesRes.ok) {
            mySchedules = await schedulesRes.json();
        } else {
            mySchedules = [];
        }

        renderDashboard();
        renderAvailableShifts();
        renderMyCalendar();
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
        dashboardList.innerHTML = pendingShifts.slice(0, 3).map(shift => {
            const deadlineInfo = getDeadlineInfo(shift.deadline);
            return `
            <div class="card shift-card">
                <h3 style="font-size: 15px; font-weight: 800; margin-bottom: 6px;">${shift.title || '名称未設定'}</h3>
                <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 10px;">
                    📝 ${shift.description || '詳細なし'}
                    ${shift.deadline ? ` | ⏰ ${deadlineInfo.text}` : ''}
                </div>
                <button class="btn btn-primary" style="font-size: 13px; padding: 10px;" onclick="document.querySelector('[data-section=shifts]').click(); setTimeout(() => selectShiftForSubmission('${shift.id}'), 100);">
                    回答を入力する 🚀
                </button>
            </div>`;
        }).join('');
    }
}

// ▼ シフト提出（未回答）一覧の描画 → 2カラムレイアウト
let currentSelectedShift = null;
let currentSelectedDateIndex = null;
let slotResponses = {}; // { 'dateIndex-slotIndex': 'available'|'partial'|'unavailable' }
let shiftCalendarDate = new Date();

function renderAvailableShifts() {
    if (!currentUser) return;
    const myRespondedShiftIds = allResponses.filter(r => r.userId === currentUser.id).map(r => r.shiftId);
    const availableShifts = allShifts.filter(s =>
        !myRespondedShiftIds.includes(s.id) &&
        (!s.deadline || new Date(s.deadline) > new Date())
    );

    const tabsContainer = document.getElementById('shift-selector-tabs');
    const submitArea = document.getElementById('shift-submit-area');

    if (availableShifts.length === 0) {
        tabsContainer.innerHTML = '';
        submitArea.innerHTML = '<div class="empty-state">未提出の募集はすべて完了しました！🎉</div>';
        return;
    }

    // シフト選択タブを描画
    tabsContainer.innerHTML = availableShifts.map((shift, i) => {
        const isActive = currentSelectedShift && currentSelectedShift.id === shift.id;
        return `<button class="shift-tab ${isActive ? 'active' : ''}" onclick="selectShiftForSubmission('${shift.id}')">${shift.title || '名称未設定'}</button>`;
    }).join('');

    // 最初のシフトを自動選択
    if (!currentSelectedShift || !availableShifts.find(s => s.id === currentSelectedShift.id)) {
        selectShiftForSubmission(availableShifts[0].id);
    } else {
        render2ColumnLayout();
    }
}

function selectShiftForSubmission(shiftId) {
    currentSelectedShift = allShifts.find(s => s.id === shiftId);
    currentSelectedDateIndex = null;
    slotResponses = {};

    // タブのactive更新
    document.querySelectorAll('.shift-tab').forEach(tab => {
        tab.classList.toggle('active', tab.textContent === (currentSelectedShift.title || '名称未設定'));
    });

    // カレンダーの月をシフトの最初の日付に合わせる
    if (currentSelectedShift.dates && currentSelectedShift.dates.length > 0) {
        const firstDate = new Date(currentSelectedShift.dates[0].date);
        shiftCalendarDate = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
    }

    render2ColumnLayout();
}

function render2ColumnLayout() {
    if (!currentSelectedShift) return;

    const submitArea = document.getElementById('shift-submit-area');
    const deadlineInfo = getDeadlineInfo(currentSelectedShift.deadline);

    submitArea.innerHTML = `
        <div style="margin-bottom: 10px; font-size: 12px; color: var(--text-secondary);">
            ${currentSelectedShift.description ? `📝 ${currentSelectedShift.description}` : ''}
            ${currentSelectedShift.deadline ? ` | ⏰ ${deadlineInfo.text}` : ''}
        </div>
        <div class="shift-submit-layout">
            <div class="shift-left-panel" id="shift-left-panel">
                ${currentSelectedDateIndex !== null ? renderDateSlots() : renderDateList()}
            </div>
            <div class="shift-right-panel">
                <div class="panel-title">📅 カレンダー</div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <button onclick="shiftCalPrev()" style="background:none;border:none;font-size:16px;color:var(--accent-primary);cursor:pointer;font-weight:bold;">◀ 前月</button>
                    <div style="font-size: 14px; font-weight: 800;">${shiftCalendarDate.getFullYear()}年 ${shiftCalendarDate.getMonth() + 1}月</div>
                    <button onclick="shiftCalNext()" style="background:none;border:none;font-size:16px;color:var(--accent-primary);cursor:pointer;font-weight:bold;">次月 ▶</button>
                </div>
                <div class="shift-calendar" id="shift-calendar-grid"></div>
            </div>
        </div>
        <div style="margin-top: 14px;">
            <label style="display: block; margin-bottom: 6px; font-weight: bold; font-size: 13px;">備考・コメント</label>
            <textarea id="submission-comment" rows="2" placeholder="店長への伝言があれば..."></textarea>
        </div>
        <button class="btn btn-primary" onclick="submitShiftData()" style="margin-top: 12px; font-size: 14px; padding: 12px;">
            この内容で提出する 🚀
        </button>
    `;

    renderShiftCalendar();
}

// ── 左パネル: 候補日一覧 ──
function renderDateList() {
    if (!currentSelectedShift.dates || currentSelectedShift.dates.length === 0) {
        return '<div class="empty-state">日付が設定されていません</div>';
    }

    let html = '<div class="panel-title">📋 候補日一覧</div>';
    currentSelectedShift.dates.forEach((dateInfo, i) => {
        const d = new Date(dateInfo.date);
        const dateStr = d.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' });
        const hasAnswer = hasDateAnswer(i);

        html += `
            <div class="date-list-item ${hasAnswer ? 'answered' : ''}" onclick="selectDate(${i})">
                <div>
                    <div class="date-text">${dateStr}</div>
                    <div class="date-time">${dateInfo.startTime} 〜 ${dateInfo.endTime}</div>
                </div>
                <div style="display: flex; align-items: center; gap: 6px;">
                    ${hasAnswer ? '<span class="date-status" style="background: #d1fae5; color: #059669;">回答済</span>' : '<span class="date-status" style="background: #fef3c7; color: #d97706;">未回答</span>'}
                    <span style="color: var(--text-secondary);">▸</span>
                </div>
            </div>
        `;
    });
    return html;
}

function hasDateAnswer(dateIndex) {
    const slots = generateSlots(currentSelectedShift.dates[dateIndex]);
    return slots.some((_, slotIdx) => slotResponses[`${dateIndex}-${slotIdx}`]);
}

// ── 左パネル: コマ割り詳細 ──
function renderDateSlots() {
    const dateInfo = currentSelectedShift.dates[currentSelectedDateIndex];
    const d = new Date(dateInfo.date);
    const dateStr = d.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' });
    const slots = generateSlots(dateInfo);

    let html = `
        <button class="back-btn" onclick="backToDateList()">← 一覧に戻る</button>
        <div class="panel-title">🕐 ${dateStr} のコマ</div>
    `;

    slots.forEach((slot, slotIdx) => {
        const key = `${currentSelectedDateIndex}-${slotIdx}`;
        const currentStatus = slotResponses[key] || '';

        html += `
            <div class="slot-card">
                <div class="slot-time">${slot.start} 〜 ${slot.end}</div>
                <div class="availability-buttons">
                    <button class="avail-btn ${currentStatus === 'available' ? 'selected-circle' : ''}" 
                            onclick="setSlotResponse(${currentSelectedDateIndex}, ${slotIdx}, 'available')">◯ 行ける</button>
                    <button class="avail-btn ${currentStatus === 'partial' ? 'selected-triangle' : ''}" 
                            onclick="setSlotResponse(${currentSelectedDateIndex}, ${slotIdx}, 'partial')">△ 条件付き</button>
                    <button class="avail-btn ${currentStatus === 'unavailable' ? 'selected-cross' : ''}" 
                            onclick="setSlotResponse(${currentSelectedDateIndex}, ${slotIdx}, 'unavailable')">✕ むり</button>
                </div>
            </div>
        `;
    });

    return html;
}

// ── コマ生成ロジック ──
function generateSlots(dateInfo) {
    const interval = parseInt(currentSelectedShift.slotInterval) || 60;
    const startMinutes = timeToMinutes(dateInfo.startTime);
    const endMinutes = timeToMinutes(dateInfo.endTime);
    const slots = [];

    for (let m = startMinutes; m < endMinutes; m += interval) {
        const slotEnd = Math.min(m + interval, endMinutes);
        slots.push({
            start: minutesToTime(m),
            end: minutesToTime(slotEnd)
        });
    }

    return slots;
}

function timeToMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

function minutesToTime(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ── カレンダー描画 ──
function renderShiftCalendar() {
    const grid = document.getElementById('shift-calendar-grid');
    if (!grid) return;

    const year = shiftCalendarDate.getFullYear();
    const month = shiftCalendarDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();

    // シフトの日付セット
    const shiftDateSet = new Set();
    if (currentSelectedShift && currentSelectedShift.dates) {
        currentSelectedShift.dates.forEach(d => {
            const dt = new Date(d.date);
            if (dt.getFullYear() === year && dt.getMonth() === month) {
                shiftDateSet.add(dt.getDate());
            }
        });
    }

    let html = ['日', '月', '火', '水', '木', '金', '土'].map(d => `<div class="cal-header">${d}</div>`).join('');

    // 空セル
    for (let i = 0; i < firstDay; i++) {
        html += '<div class="cal-day"></div>';
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const hasShift = shiftDateSet.has(day);
        const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
        const isSelected = currentSelectedDateIndex !== null && (() => {
            const selDate = new Date(currentSelectedShift.dates[currentSelectedDateIndex].date);
            return selDate.getFullYear() === year && selDate.getMonth() === month && selDate.getDate() === day;
        })();

        let classes = 'cal-day';
        if (hasShift) classes += ' has-shift';
        if (isToday) classes += ' today';
        if (isSelected) classes += ' selected';

        const onclick = hasShift ? `onclick="selectDateFromCalendar(${year}, ${month}, ${day})"` : '';

        html += `<div class="${classes}" ${onclick}>${day}</div>`;
    }

    grid.innerHTML = html;
}

function selectDateFromCalendar(year, month, day) {
    if (!currentSelectedShift || !currentSelectedShift.dates) return;
    const idx = currentSelectedShift.dates.findIndex(d => {
        const dt = new Date(d.date);
        return dt.getFullYear() === year && dt.getMonth() === month && dt.getDate() === day;
    });
    if (idx >= 0) selectDate(idx);
}

function selectDate(index) {
    currentSelectedDateIndex = index;
    const leftPanel = document.getElementById('shift-left-panel');
    if (leftPanel) leftPanel.innerHTML = renderDateSlots();
    renderShiftCalendar();
}

function backToDateList() {
    currentSelectedDateIndex = null;
    const leftPanel = document.getElementById('shift-left-panel');
    if (leftPanel) leftPanel.innerHTML = renderDateList();
    renderShiftCalendar();
}

function setSlotResponse(dateIdx, slotIdx, status) {
    const key = `${dateIdx}-${slotIdx}`;
    slotResponses[key] = status;
    // 再描画（左パネルのみ）
    const leftPanel = document.getElementById('shift-left-panel');
    if (leftPanel) leftPanel.innerHTML = renderDateSlots();
}

function shiftCalPrev() {
    shiftCalendarDate.setMonth(shiftCalendarDate.getMonth() - 1);
    render2ColumnLayout();
}

function shiftCalNext() {
    shiftCalendarDate.setMonth(shiftCalendarDate.getMonth() + 1);
    render2ColumnLayout();
}

// ==========================================
// 4. サーバーへ提出する機能
// ==========================================
async function submitShiftData() {
    if (!currentSelectedShift) return;

    // 全日付のスロット回答を集計
    const dailyResponses = [];
    let hasAnyAnswer = false;

    currentSelectedShift.dates.forEach((dateInfo, dateIdx) => {
        const slots = generateSlots(dateInfo);
        const slotData = slots.map((slot, slotIdx) => {
            const key = `${dateIdx}-${slotIdx}`;
            const status = slotResponses[key] || 'unavailable';
            if (slotResponses[key]) hasAnyAnswer = true;
            return {
                start: slot.start,
                end: slot.end,
                status: status
            };
        });

        dailyResponses.push({
            date: dateInfo.date,
            slots: slotData,
            // 後方互換: 全体ステータス判定
            status: slotData.every(s => s.status === 'available') ? 'available' :
                slotData.every(s => s.status === 'unavailable') ? 'unavailable' : 'partial'
        });
    });

    if (!hasAnyAnswer) {
        alert('少なくとも1つのコマに回答を入力してください');
        return;
    }

    if (!confirm('この内容で店長に提出しますか？')) return;

    const commentEl = document.getElementById('submission-comment');
    const payload = {
        shiftId: currentSelectedShift.id,
        userId: currentUser.id,
        userName: currentUser.name,
        comment: commentEl ? commentEl.value : '',
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
            currentSelectedShift = null;
            slotResponses = {};
            loadAllData();
        } else {
            alert('提出に失敗しました...');
        }
    } catch (error) {
        alert('通信エラーが発生しました。');
    }
}

// ==========================================
// 5. カレンダー＆確定シフトの表示
// ==========================================
let currentMyDate = new Date();
let selectedMyDateStr = null;

function renderMyCalendar() {
    if (!currentUser) return;

    const year = currentMyDate.getFullYear();
    const month = currentMyDate.getMonth();

    document.getElementById('my-calendar-month-year').textContent = `${year}年 ${month + 1}月`;

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPadding = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    const container = document.getElementById('my-calendar-days');
    let html = '';

    for (let i = 0; i < startPadding; i++) {
        html += `<div style="padding: 10px; background: rgba(0,0,0,0.02); border-radius: 8px;"></div>`;
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(year, month, d);
        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, '0');
        const dStr = String(dateObj.getDate()).padStart(2, '0');
        const currentDateStr = `${y}-${m}-${dStr}`;

        let shiftHtml = '';

        // 当該スタッフが割り当てられているシフト
        allShifts.forEach(shift => {
            if (shift.assigned_user_id === currentUser.id) {
                const shiftDates = shift.dates ? shift.dates.map(x => x.date) : [shift.date];
                if (shiftDates.includes(currentDateStr)) {
                    shiftHtml += `<div style="width: 6px; height: 6px; background: var(--accent-primary); border-radius: 50%; margin: 2px auto;"></div>`;
                }
            }
        });

        // 個人のプライベート予定
        const daySchedules = mySchedules.filter(s => s.date === currentDateStr);
        if (daySchedules.length > 0) {
            shiftHtml += `<div style="width: 6px; height: 6px; background: var(--warning); border-radius: 50%; margin: 2px auto;"></div>`;
        }

        const isSelected = selectedMyDateStr === currentDateStr;
        const bg = isSelected ? 'background: rgba(2, 132, 199, 0.1); border: 2px solid var(--accent-primary);' : 'background: var(--bg-secondary); border: 2px solid transparent;';

        html += `
            <div style="padding: 10px 0; border-radius: 8px; cursor: pointer; ${bg} transition: 0.2s;" onclick="showMyDayDetails('${currentDateStr}')">
                <div style="font-weight: bold; ${dateObj.getDay() === 0 ? 'color:var(--danger);' : dateObj.getDay() === 6 ? 'color:var(--accent-primary);' : ''}">${d}</div>
                <div style="height: 12px; display: flex; justify-content: center; gap: 2px; margin-top: 4px;">
                    ${shiftHtml}
                </div>
            </div>
        `;
    }

    container.innerHTML = html;

    if (selectedMyDateStr) {
        showMyDayDetails(selectedMyDateStr);
    }
}

function prevMyMonth() {
    currentMyDate.setMonth(currentMyDate.getMonth() - 1);
    renderMyCalendar();
}

function nextMyMonth() {
    currentMyDate.setMonth(currentMyDate.getMonth() + 1);
    renderMyCalendar();
}

function showMyDayDetails(dateStr) {
    selectedMyDateStr = dateStr;
    renderMyCalendar(); // update selection highlight

    const detailsDiv = document.getElementById('my-day-details');
    const title = document.getElementById('my-day-details-title');
    const content = document.getElementById('my-day-details-content');

    detailsDiv.style.display = 'block';

    const [y, m, d] = dateStr.split('-');
    title.textContent = `${y}年 ${parseInt(m)}月 ${parseInt(d)}日の予定`;

    let html = '';

    // 確定シフト
    const dayShifts = allShifts.filter(shift => shift.assigned_user_id === currentUser.id && (shift.dates ? shift.dates.some(x => x.date === dateStr) : shift.date === dateStr));

    dayShifts.forEach(shift => {
        let timeStr = '時間未定';
        if (shift.dates) {
            const dateInfo = shift.dates.find(x => x.date === dateStr);
            if (dateInfo) timeStr = `${dateInfo.startTime} 〜 ${dateInfo.endTime}`;
        }
        html += `
            <div style="background: rgba(255, 255, 255, 0.8); border-left: 4px solid var(--accent-primary); padding: 12px; border-radius: 8px; margin-bottom: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                <div style="font-size: 12px; color: var(--accent-primary); font-weight: bold; margin-bottom: 4px;">🏢 確定シフト</div>
                <div style="font-weight: bold; margin-bottom: 4px; font-size: 16px;">${shift.title}</div>
                <div style="font-size: 13px; color: var(--text-secondary);">⏰ ${timeStr}</div>
                ${shift.description ? `<div style="font-size: 12px; color: var(--text-secondary); margin-top: 5px;">📝 ${shift.description}</div>` : ''}
            </div>
        `;
    });

    // 個人の予定
    const daySchedules = mySchedules.filter(s => s.date === dateStr);
    daySchedules.forEach(schedule => {
        html += `
            <div style="background: rgba(255, 255, 255, 0.8); border-left: 4px solid var(--warning); padding: 12px; border-radius: 8px; margin-bottom: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); display: flex; justify-content: space-between; align-items: start;">
                <div>
                    <div style="font-size: 12px; color: var(--warning); font-weight: bold; margin-bottom: 4px;">👤 プライベート設定予定</div>
                    <div style="font-weight: bold; font-size: 15px;">${schedule.title}</div>
                </div>
                <button onclick="deletePersonalSchedule('${schedule.id}')" style="background:none; border:none; color: var(--danger); cursor: pointer; padding: 4px 8px; font-size: 16px;">🗑️</button>
            </div>
        `;
    });

    if (dayShifts.length === 0 && daySchedules.length === 0) {
        html = '<div style="color: var(--text-secondary); font-size: 13px; text-align: center; padding: 20px;">予定はありません</div>';
    }

    content.innerHTML = html;
}

function openScheduleModal() {
    document.getElementById('schedule-date').value = selectedMyDateStr || '';
    document.getElementById('schedule-title').value = '';
    document.getElementById('schedule-modal').classList.add('active');
}

function closeScheduleModal() {
    document.getElementById('schedule-modal').classList.remove('active');
}

async function savePersonalSchedule() {
    const date = document.getElementById('schedule-date').value;
    const title = document.getElementById('schedule-title').value;
    if (!date || !title) return alert('全ての項目を入力してください');

    try {
        const res = await fetch('/api/me/schedules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ date, title })
        });
        if (res.ok) {
            closeScheduleModal();
            loadAllData(); // Reload schedules
        } else {
            alert('保存に失敗しました');
        }
    } catch (e) {
        alert('通信エラーが発生しました');
    }
}

async function deletePersonalSchedule(id) {
    if (!confirm('予定を削除しますか？')) return;
    try {
        const res = await fetch(`/api/me/schedules/${id}`, { method: 'DELETE', credentials: 'include' });
        if (res.ok) {
            loadAllData();
        }
    } catch (e) {
        alert('通信エラーが発生しました');
    }
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

// ▼ モーダルの外側（暗い部分）をクリックしたら閉じる
window.addEventListener('click', (e) => {
    const scheduleModal = document.getElementById('schedule-modal');
    if (e.target === scheduleModal) {
        closeScheduleModal();
    }
});