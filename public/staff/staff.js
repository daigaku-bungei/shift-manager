let currentUser = null;
let allShifts = [];
let allResponses = [];
let mySchedules = [];
let allMembers = [];

// 回答データ
// slotResponses[dateIdx] = { mode: 'slot'|'time', slots: { slotIdx: true/false }, timeStart: '10:00', timeEnd: '18:00' }
let slotResponses = {};
let currentSelectedShift = null;
let expandedDateIdx = null; // 展開中の日付
let submissionMode = 'slot'; // 'slot' or 'time' (デフォルトはコマ割り)
let isDevMode = false;

// ==========================================
// 1. 初期設定
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    await loadMyInfo();
    setupNavigation();
    await checkDevMode();
    await loadAllData();
});

async function checkDevMode() {
    try {
        const res = await fetch('/api/env-mode');
        const data = await res.json();
        isDevMode = !data.isProduction;
    } catch (e) { isDevMode = false; }
}

async function loadMyInfo() {
    try {
        const res = await fetch('/api/me?role=staff', { credentials: 'include' });
        if (!res.ok) throw new Error('未ログイン');
        currentUser = await res.json();
        document.getElementById('user-name-badge').textContent = currentUser.name + ' さん';
        if (document.getElementById('mypage-name')) {
            document.getElementById('mypage-name').textContent = currentUser.name;
            document.getElementById('mypage-id').textContent = currentUser.username || currentUser.id;
        }
    } catch (error) {
        window.location.href = '/login.html';
    }
}

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
            loadAllData();
        });
    });
}

// ==========================================
// 2. データ読み込み
// ==========================================
async function loadAllData() {
    try {
        const [shiftsRes, responsesRes, schedulesRes, membersRes] = await Promise.all([
            fetch('/api/shifts', { credentials: 'include' }),
            fetch('/api/responses', { credentials: 'include' }),
            fetch('/api/me/schedules', { credentials: 'include' }),
            fetch('/api/members', { credentials: 'include' })
        ]);
        allShifts = await shiftsRes.json();
        allResponses = await responsesRes.json();
        mySchedules = schedulesRes.ok ? await schedulesRes.json() : [];
        allMembers = membersRes.ok ? await membersRes.json() : [];

        renderDashboard();
        renderShiftSubmitSection();
        renderMyCalendar();
    } catch (error) {
        console.error('データの読み込み失敗:', error);
    }
}

// ==========================================
// 3. ダッシュボード
// ==========================================
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

    // テストパネル描画
    renderTestPanel();
}

// ==========================================
// 4. シフト提出セクション
// ==========================================
function renderShiftSubmitSection() {
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

    tabsContainer.innerHTML = availableShifts.map(shift => {
        const isActive = currentSelectedShift && currentSelectedShift.id === shift.id;
        return `<button class="shift-tab ${isActive ? 'active' : ''}" onclick="selectShiftForSubmission('${shift.id}')">${shift.title || '名称未設定'}</button>`;
    }).join('');

    if (!currentSelectedShift || !availableShifts.find(s => s.id === currentSelectedShift.id)) {
        selectShiftForSubmission(availableShifts[0].id);
    } else {
        renderShiftSubmitAll();
    }
}

function selectShiftForSubmission(shiftId) {
    currentSelectedShift = allShifts.find(s => s.id === shiftId);
    slotResponses = {};
    expandedDateIdx = null;
    submissionMode = 'slot';
    window._selectedPositions = []; // ポジション希望リセット

    // 初期値: 全日程・全スロットを✕（行けない）で埋める
    if (currentSelectedShift && currentSelectedShift.dates) {
        currentSelectedShift.dates.forEach((dateInfo, i) => {
            const slots = generateSlots(dateInfo);
            const slotMap = {};
            slots.forEach((_, si) => { slotMap[si] = false; }); // false = ✕
            slotResponses[i] = { mode: 'slot', slots: slotMap, timeStart: dateInfo.startTime, timeEnd: dateInfo.endTime };
        });
    }

    document.querySelectorAll('.shift-tab').forEach(tab => {
        tab.classList.toggle('active', tab.textContent === (currentSelectedShift.title || '名称未設定'));
    });

    renderShiftSubmitAll();
}

// ▼ メイン描画
function renderShiftSubmitAll() {
    if (!currentSelectedShift || !currentSelectedShift.dates) return;
    const submitArea = document.getElementById('shift-submit-area');
    const deadlineInfo = getDeadlineInfo(currentSelectedShift.deadline);
    const dates = currentSelectedShift.dates;

    // 回答済み日数を計算
    let answeredCount = 0;
    dates.forEach((_, i) => {
        const resp = slotResponses[i];
        if (resp) {
            if (resp.mode === 'time') { answeredCount++; }
            else if (resp.slots && Object.values(resp.slots).some(v => v === true)) { answeredCount++; }
        }
    });
    const progressPct = dates.length > 0 ? Math.round((answeredCount / dates.length) * 100) : 0;

    let html = '';

    // 概要
    if (currentSelectedShift.description || currentSelectedShift.deadline) {
        html += `<div style="margin-bottom: 12px; font-size: 12px; color: var(--text-secondary);">
            ${currentSelectedShift.description ? `📝 ${currentSelectedShift.description}` : ''}
            ${currentSelectedShift.deadline ? ` | ⏰ ${deadlineInfo.text}` : ''}
        </div>`;
    }

    // ポジション希望（シフトにpositionsが設定されている場合のみ表示）
    const shiftPositions = currentSelectedShift.positions || [];
    const hasPositions = shiftPositions.length > 0 && !(shiftPositions.length === 1 && shiftPositions[0].name === '全体');
    if (hasPositions) {
        html += `
            <div style="margin-bottom: 14px; padding: 12px; background: rgba(29,155,240,0.05); border: 1px solid rgba(29,155,240,0.15); border-radius: 12px;">
                <div style="font-size: 13px; font-weight: 700; margin-bottom: 8px; color: var(--text-primary);">🏷️ 希望ポジション</div>
                <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                    ${shiftPositions.map((p, pi) => {
            const isSelected = (window._selectedPositions || []).includes(p.name);
            return `<button onclick="togglePositionPref(${pi}, '${p.name}')" 
                            class="position-pref-btn" 
                            style="padding: 6px 14px; border-radius: 9999px; font-size: 12px; font-weight: 700; cursor: pointer; transition: all 0.2s; border: 1.5px solid ${isSelected ? '#1d9bf0' : '#cfd9de'}; background: ${isSelected ? 'rgba(29,155,240,0.1)' : 'white'}; color: ${isSelected ? '#1d9bf0' : 'var(--text-secondary)'};">
                            ${isSelected ? '✓ ' : ''}${p.name}（${p.count}名）
                        </button>`;
        }).join('')}
                </div>
                <p style="font-size: 11px; color: var(--text-secondary); margin-top: 6px;">タップして希望するポジションを選んでください（複数選択可）</p>
            </div>
        `;
    }

    // モード切替タブ
    html += `
        <div class="mode-tabs">
            <button class="mode-tab ${submissionMode === 'slot' ? 'active' : ''}" onclick="switchMode('slot')">📊 コマ割り</button>
            <button class="mode-tab ${submissionMode === 'time' ? 'active' : ''}" onclick="switchMode('time')">🕐 時間指定</button>
        </div>
    `;

    // 進捗バー
    html += `
        <div class="progress-bar-container">
            <div class="progress-info">
                <span>回答の進捗（◯がある日をカウント）</span>
                <span>${answeredCount} / ${dates.length} 日</span>
            </div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${progressPct}%"></div>
            </div>
        </div>
    `;

    // 一括ボタン
    if (submissionMode === 'slot') {
        html += `
            <div class="bulk-actions">
                <button class="bulk-btn" onclick="bulkSetAllSlots(true)">✨ 全日程の全コマを◯</button>
                <button class="bulk-btn" onclick="bulkSetAllSlots(false)">全コマを✕に戻す</button>
            </div>
        `;
    } else {
        html += `
            <div class="bulk-actions">
                <button class="bulk-btn" onclick="bulkSetAllTime()">✨ 全日程をフル時間で◯</button>
                <button class="bulk-btn" onclick="bulkClearTime()">全て未回答に戻す</button>
            </div>
        `;
    }

    // 日付カード一覧
    dates.forEach((dateInfo, i) => {
        const d = new Date(dateInfo.date);
        const dayOfWeek = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
        const dateLabel = `${d.getMonth() + 1}/${d.getDate()}(${dayOfWeek})`;
        const timeLabel = `${dateInfo.startTime} 〜 ${dateInfo.endTime}`;
        const resp = slotResponses[i];

        let dayColor = '';
        if (d.getDay() === 0) dayColor = 'color: var(--danger);';
        else if (d.getDay() === 6) dayColor = 'color: var(--accent-primary);';

        // この日に◯のスロットがあるか判定
        let hasAvailable = false;
        let statusClass = 'status-unavailable';
        if (resp) {
            if (resp.mode === 'time') {
                hasAvailable = true;
                statusClass = 'status-available';
            } else if (resp.slots) {
                hasAvailable = Object.values(resp.slots).some(v => v);
                statusClass = hasAvailable ? 'status-partial' : 'status-unavailable';
                if (Object.values(resp.slots).every(v => v)) statusClass = 'status-available';
            }
        }

        const isExpanded = expandedDateIdx === i;

        if (submissionMode === 'slot') {
            // コマ割りモード: カード
            const slots = generateSlots(dateInfo);
            const availCount = resp ? Object.values(resp.slots).filter(v => v).length : 0;

            html += `
                <div class="day-answer-card ${statusClass}" id="day-card-${i}">
                    <div class="day-answer-top" onclick="toggleExpand(${i})" style="cursor: pointer;">
                        <div class="day-answer-info">
                            <div class="day-answer-date" style="${dayColor}">${dateLabel}</div>
                            <div class="day-answer-time">🕐 ${timeLabel}</div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 12px; font-weight: 700; color: ${availCount > 0 ? '#00ba7c' : 'var(--text-secondary)'};">${availCount}/${slots.length}コマ◯</span>
                            <span style="font-size: 16px; transition: transform 0.3s; transform: rotate(${isExpanded ? '180' : '0'}deg); color: var(--text-secondary);">▼</span>
                        </div>
                    </div>
                    <div class="slot-expand ${isExpanded ? 'open' : ''}">
                        <div class="slot-expand-inner">
                            <div style="display: flex; gap: 6px; margin-bottom: 8px;">
                                <button class="bulk-btn" style="font-size: 11px; padding: 4px 10px;" onclick="event.stopPropagation(); setAllSlotsForDay(${i}, true)">この日 全◯</button>
                                <button class="bulk-btn" style="font-size: 11px; padding: 4px 10px;" onclick="event.stopPropagation(); setAllSlotsForDay(${i}, false)">全✕</button>
                            </div>
                            <div class="slot-grid">
                                ${slots.map((slot, si) => {
                const isOn = resp && resp.slots[si];
                return `<button class="slot-chip ${isOn ? 'on' : 'off'}" onclick="event.stopPropagation(); toggleSlot(${i}, ${si})">${slot.start}〜${slot.end}</button>`;
            }).join('')}
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            // 時間指定モード
            html += `
                <div class="day-answer-card ${resp && resp.mode === 'time' ? 'status-available' : 'status-unavailable'}" id="day-card-${i}">
                    <div class="day-answer-top">
                        <div class="day-answer-info">
                            <div class="day-answer-date" style="${dayColor}">${dateLabel}</div>
                            <div class="day-answer-time">🕐 ${timeLabel}</div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <input type="time" class="partial-time-input" value="${resp?.timeStart || dateInfo.startTime}"
                                   onchange="setTimeRange(${i}, 'start', this.value)" style="width: 80px; font-size: 12px;">
                            <span style="color: var(--text-secondary); font-weight: 700; font-size: 12px;">〜</span>
                            <input type="time" class="partial-time-input" value="${resp?.timeEnd || dateInfo.endTime}"
                                   onchange="setTimeRange(${i}, 'end', this.value)" style="width: 80px; font-size: 12px;">
                            <button class="day-btn ${resp && resp.mode === 'time' ? 'active-circle' : ''}"
                                    onclick="toggleTimeDay(${i})" style="width: 40px; height: 32px; font-size: 12px;">
                                ${resp && resp.mode === 'time' ? '◯' : '✕'}
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }
    });

    // 希望シフト数（管理者がONにした場合のみ表示）
    if (currentSelectedShift.allow_preferred_count) {
        html += `
            <div style="margin-top: 14px; padding: 12px; background: rgba(29,155,240,0.06); border-radius: 10px; border: 1px solid rgba(29,155,240,0.15);">
                <label style="display: block; margin-bottom: 6px; font-weight: bold; font-size: 13px; color: var(--accent-primary);">🎯 希望シフト数（この期間で何回入りたいか）</label>
                <input type="number" id="preferred-count" min="0" max="${dates.length}" placeholder="例: 3" 
                       style="width: 100px; padding: 8px; border: 1px solid #cfd9de; border-radius: 8px; font-size: 14px; font-family: inherit;">
                <span style="font-size: 12px; color: var(--text-secondary); margin-left: 6px;">/ ${dates.length}日中</span>
            </div>
        `;
    }

    // 備考 + 提出
    html += `
        <div style="margin-top: 14px;">
            <label style="display: block; margin-bottom: 6px; font-weight: bold; font-size: 13px;">💬 備考・コメント</label>
            <textarea id="submission-comment" rows="2" placeholder="店長への伝言があれば..."></textarea>
        </div>
        <button class="btn btn-primary" onclick="submitShiftData()" style="margin-top: 12px; font-size: 14px; padding: 12px;">
            この内容で提出する 🚀
        </button>
    `;

    submitArea.innerHTML = html;
}

// ==========================================
// 5. スロット操作
// ==========================================
function generateSlots(dateInfo) {
    const interval = parseInt(currentSelectedShift.slotInterval) || 60;
    const startMin = timeToMinutes(dateInfo.startTime);
    const endMin = timeToMinutes(dateInfo.endTime);
    const slots = [];
    for (let m = startMin; m < endMin; m += interval) {
        slots.push({ start: minutesToTime(m), end: minutesToTime(Math.min(m + interval, endMin)) });
    }
    return slots;
}

function timeToMinutes(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function minutesToTime(m) { return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }

function switchMode(mode) {
    submissionMode = mode;
    expandedDateIdx = null;
    // モード切替時にslotResponsesのmodeをリセット
    if (currentSelectedShift) {
        currentSelectedShift.dates.forEach((dateInfo, i) => {
            if (mode === 'slot') {
                const slots = generateSlots(dateInfo);
                const slotMap = {};
                slots.forEach((_, si) => { slotMap[si] = false; });
                slotResponses[i] = { mode: 'slot', slots: slotMap, timeStart: dateInfo.startTime, timeEnd: dateInfo.endTime };
            } else {
                slotResponses[i] = { mode: 'slot', slots: {}, timeStart: dateInfo.startTime, timeEnd: dateInfo.endTime }; // 未選択状態
            }
        });
    }
    renderShiftSubmitAll();
}

function toggleExpand(dateIdx) {
    expandedDateIdx = expandedDateIdx === dateIdx ? null : dateIdx;
    renderShiftSubmitAll();
}

function toggleSlot(dateIdx, slotIdx) {
    if (!slotResponses[dateIdx]) return;
    slotResponses[dateIdx].slots[slotIdx] = !slotResponses[dateIdx].slots[slotIdx];
    renderShiftSubmitAll();
}

function setAllSlotsForDay(dateIdx, value) {
    if (!slotResponses[dateIdx]) return;
    Object.keys(slotResponses[dateIdx].slots).forEach(k => { slotResponses[dateIdx].slots[k] = value; });
    renderShiftSubmitAll();
}

function bulkSetAllSlots(value) {
    Object.keys(slotResponses).forEach(i => {
        Object.keys(slotResponses[i].slots).forEach(k => { slotResponses[i].slots[k] = value; });
    });
    renderShiftSubmitAll();
}

function toggleTimeDay(dateIdx) {
    const resp = slotResponses[dateIdx];
    if (resp && resp.mode === 'time') {
        // 解除
        slotResponses[dateIdx] = { mode: 'slot', slots: {}, timeStart: resp.timeStart, timeEnd: resp.timeEnd };
    } else {
        // 時間指定ON
        const dateInfo = currentSelectedShift.dates[dateIdx];
        slotResponses[dateIdx] = {
            mode: 'time',
            slots: {},
            timeStart: resp?.timeStart || dateInfo.startTime,
            timeEnd: resp?.timeEnd || dateInfo.endTime
        };
    }
    renderShiftSubmitAll();
}

function setTimeRange(dateIdx, which, value) {
    if (!slotResponses[dateIdx]) return;
    if (which === 'start') slotResponses[dateIdx].timeStart = value;
    else slotResponses[dateIdx].timeEnd = value;
    // 入力中に自動的にtimeモードにする
    slotResponses[dateIdx].mode = 'time';
    renderShiftSubmitAll();
}

function bulkSetAllTime() {
    if (!currentSelectedShift) return;
    currentSelectedShift.dates.forEach((dateInfo, i) => {
        slotResponses[i] = { mode: 'time', slots: {}, timeStart: dateInfo.startTime, timeEnd: dateInfo.endTime };
    });
    renderShiftSubmitAll();
}

function bulkClearTime() {
    if (!currentSelectedShift) return;
    currentSelectedShift.dates.forEach((dateInfo, i) => {
        slotResponses[i] = { mode: 'slot', slots: {}, timeStart: dateInfo.startTime, timeEnd: dateInfo.endTime };
    });
    renderShiftSubmitAll();
}

// ==========================================
// 6. 提出
// ==========================================
// ポジション希望の切り替え
function togglePositionPref(index, posName) {
    if (!window._selectedPositions) window._selectedPositions = [];
    const idx = window._selectedPositions.indexOf(posName);
    if (idx >= 0) {
        window._selectedPositions.splice(idx, 1);
    } else {
        window._selectedPositions.push(posName);
    }
    renderCurrentShift(); // UIを再描画
}

async function submitShiftData() {
    if (!currentSelectedShift) return;
    const dates = currentSelectedShift.dates;

    const dailyResponses = dates.map((dateInfo, dateIdx) => {
        const resp = slotResponses[dateIdx];
        const interval = parseInt(currentSelectedShift.slotInterval) || 60;
        const startMin = timeToMinutes(dateInfo.startTime);
        const endMin = timeToMinutes(dateInfo.endTime);
        const slots = [];

        if (resp && resp.mode === 'time') {
            // 時間指定モード: 範囲内スロットをavailable
            const pStart = timeToMinutes(resp.timeStart);
            const pEnd = timeToMinutes(resp.timeEnd);
            for (let m = startMin; m < endMin; m += interval) {
                const slotEnd = Math.min(m + interval, endMin);
                slots.push({ start: minutesToTime(m), end: minutesToTime(slotEnd), status: (m >= pStart && slotEnd <= pEnd) ? 'available' : 'unavailable' });
            }
            return { date: dateInfo.date, slots, status: 'partial' };
        } else {
            // コマ割りモード
            let anyAvailable = false;
            let allAvailable = true;
            for (let m = startMin, si = 0; m < endMin; m += interval, si++) {
                const isOn = resp && resp.slots && resp.slots[si];
                slots.push({ start: minutesToTime(m), end: minutesToTime(Math.min(m + interval, endMin)), status: isOn ? 'available' : 'unavailable' });
                if (isOn) anyAvailable = true; else allAvailable = false;
            }
            return { date: dateInfo.date, slots, status: allAvailable ? 'available' : anyAvailable ? 'partial' : 'unavailable' };
        }
    });

    if (!confirm('この内容で店長に提出しますか？')) return;

    const commentEl = document.getElementById('submission-comment');
    const preferredEl = document.getElementById('preferred-count');
    const payload = {
        shiftId: currentSelectedShift.id,
        userId: currentUser.id,
        userName: currentUser.name,
        comment: commentEl ? commentEl.value : '',
        preferredCount: preferredEl ? (preferredEl.value || null) : null,
        positionPreferences: window._selectedPositions || [],
        dailyResponses,
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
        } else { alert('提出に失敗しました...'); }
    } catch (error) { alert('通信エラーが発生しました。'); }
}

// ==========================================
// 7. テストパネル（DEV環境のみ）
// ==========================================
function renderTestPanel() {
    const container = document.getElementById('test-panel');
    if (!container) return;
    if (!isDevMode) { container.style.display = 'none'; return; }
    container.style.display = 'block';

    // 現在の回答状況サマリー
    const staffMembers = allMembers.filter(m => m.role === 'staff');
    const shiftsWithDates = allShifts.filter(s => s.dates && s.dates.length > 0);

    let statusHtml = '';
    shiftsWithDates.forEach(shift => {
        const shiftResps = allResponses.filter(r => r.shiftId === shift.id);
        const reqCount = parseInt(shift.required_staff_count) || 1;
        statusHtml += `<div style="margin-bottom: 8px;">
            <strong>${shift.title || '名称未設定'}</strong>
            <span style="font-size: 12px; color: var(--text-secondary);"> — 回答: ${shiftResps.length}/${staffMembers.length}名 | 必要人数: ${reqCount}名/日</span>
            ${shift.assignments && shift.assignments.length > 0 ?
                `<span style="font-size: 12px; color: #00ba7c; margin-left: 6px;">📌 ${shift.assignments.length}件割当済</span>` : ''}
            ${shift.allow_preferred_count ? '<span style="font-size: 11px; color: var(--accent-primary); margin-left: 4px;">🎯希望数ON</span>' : ''}
        </div>`;
        // 割り当て詳細
        if (shift.assignments && shift.assignments.length > 0) {
            statusHtml += '<div style="margin-left: 12px; margin-bottom: 8px;">';
            shift.assignments.forEach(a => {
                const member = allMembers.find(m => m.id === a.user_id);
                const d = new Date(a.date);
                statusHtml += `<div style="font-size: 11px; color: var(--text-secondary);">📅 ${d.getMonth() + 1}/${d.getDate()} → ${member?.name || '不明'}</div>`;
            });
            statusHtml += '</div>';
        }
    });

    container.innerHTML = `
        <h3 style="font-size: 16px; margin-bottom: 12px;">🧪 テストパネル <span style="font-size: 11px; color: var(--danger); font-weight: normal;">(DEV環境のみ)</span></h3>
        <div class="card" style="padding: 14px;">
            <div style="margin-bottom: 12px; font-size: 13px; font-weight: 700;">📊 現在の状況</div>
            ${statusHtml || '<div style="font-size: 12px; color: var(--text-secondary);">シフトがありません</div>'}
            <hr style="border: none; border-top: 1px dashed var(--border-color); margin: 12px 0;">
            <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                <button class="btn btn-primary" onclick="testBulkSubmit()" style="width: auto; padding: 8px 16px; font-size: 13px; border-radius: 10px;">
                    🤖 全スタッフ分ランダム回答
                </button>
                <button class="btn btn-primary" onclick="testAutoAssign()" style="width: auto; padding: 8px 16px; font-size: 13px; border-radius: 10px; background: #00ba7c;">
                    ⚡ 自動割り当て実行
                </button>
                <button class="btn" onclick="testClearAssignments()" style="width: auto; padding: 8px 16px; font-size: 13px; border-radius: 10px; background: rgba(244,33,46,0.06); color: var(--danger); border: 1px solid rgba(244,33,46,0.2);">
                    🗑️ 割り当てクリア
                </button>
            </div>
            <div id="test-result" style="margin-top: 12px; font-size: 12px;"></div>
        </div>
    `;
}

async function testBulkSubmit() {
    const resultEl = document.getElementById('test-result');
    resultEl.textContent = '🔄 全スタッフ分のランダム回答を生成中...';

    const staffMembers = allMembers.filter(m => m.role === 'staff');
    const shiftsWithDates = allShifts.filter(s => s.dates && s.dates.length > 0);

    let submitCount = 0;
    for (const shift of shiftsWithDates) {
        for (const member of staffMembers) {
            // 既に回答済みならスキップ
            const alreadySubmitted = allResponses.some(r => r.shiftId === shift.id && r.userId === member.id);
            if (alreadySubmitted) continue;

            const interval = parseInt(shift.slotInterval) || 60;
            const dailyResponses = shift.dates.map(dateInfo => {
                const startMin = timeToMinutes(dateInfo.startTime);
                const endMin = timeToMinutes(dateInfo.endTime);
                const slots = [];
                let anyAvailable = false;
                let allAvailable = true;

                for (let m = startMin; m < endMin; m += interval) {
                    // 60%の確率で◯
                    const isOn = Math.random() < 0.6;
                    slots.push({ start: minutesToTime(m), end: minutesToTime(Math.min(m + interval, endMin)), status: isOn ? 'available' : 'unavailable' });
                    if (isOn) anyAvailable = true; else allAvailable = false;
                }

                return { date: dateInfo.date, slots, status: allAvailable ? 'available' : anyAvailable ? 'partial' : 'unavailable' };
            });

            await fetch('/api/responses', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    shiftId: shift.id,
                    userId: member.id,
                    userName: member.name,
                    comment: '[テスト自動生成]',
                    dailyResponses,
                    submittedAt: new Date().toISOString()
                })
            });
            submitCount++;
        }
    }

    resultEl.innerHTML = `<span style="color: #00ba7c; font-weight: 700;">✅ ${submitCount}件の回答を自動生成しました！</span>`;
    await loadAllData();
}

async function testAutoAssign() {
    const resultEl = document.getElementById('test-result');
    resultEl.textContent = '🔄 自動割り当てを実行中...';

    try {
        const res = await fetch('/api/shifts/auto-assign-all', { method: 'POST', credentials: 'include' });
        const result = await res.json();

        if (result.count > 0) {
            let detailHtml = `<span style="color: #00ba7c; font-weight: 700;">✅ ${result.count}件を割り当てました！</span><br>`;
            if (result.details) {
                result.details.forEach(d => {
                    const dateObj = new Date(d.date);
                    detailHtml += `<div style="margin-top: 2px;">📅 ${dateObj.getMonth() + 1}/${dateObj.getDate()} (${d.shiftTitle}) → <strong>${d.memberName}</strong></div>`;
                });
            }
            resultEl.innerHTML = detailHtml;
        } else {
            resultEl.innerHTML = '<span style="color: var(--warning); font-weight: 700;">⚠️ 割り当て候補がありません（回答がないか、全て✕の可能性）</span>';
        }
        await loadAllData();
    } catch (e) {
        resultEl.innerHTML = '<span style="color: var(--danger);">❌ エラーが発生しました</span>';
    }
}

async function testClearAssignments() {
    if (!confirm('全ての割り当てをクリアしますか？（回答データは残ります）')) return;
    const resultEl = document.getElementById('test-result');

    // 各シフトのassignmentsをクリア（PUT APIで更新）
    for (const shift of allShifts) {
        if (shift.assignments && shift.assignments.length > 0) {
            for (const a of [...shift.assignments]) {
                await fetch(`/api/shifts/${shift.id}/unassign`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ user_id: a.user_id, date: a.date })
                });
            }
        }
    }

    resultEl.innerHTML = '<span style="color: #00ba7c; font-weight: 700;">✅ 割り当てをクリアしました</span>';
    await loadAllData();
}

// ==========================================
// 8. カレンダー＆確定シフト
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
        allShifts.forEach(shift => {
            if (shift.assignments) {
                const myAssignment = shift.assignments.find(a => a.user_id === currentUser.id && a.date === currentDateStr);
                if (myAssignment) {
                    shiftHtml += `<div style="width: 6px; height: 6px; background: var(--accent-primary); border-radius: 50%; margin: 2px auto;"></div>`;
                }
            }
            if (shift.assigned_user_id === currentUser.id) {
                const shiftDates = shift.dates ? shift.dates.map(x => x.date) : [shift.date];
                if (shiftDates.includes(currentDateStr)) {
                    shiftHtml += `<div style="width: 6px; height: 6px; background: var(--accent-primary); border-radius: 50%; margin: 2px auto;"></div>`;
                }
            }
        });

        const daySchedules = mySchedules.filter(s => s.date === currentDateStr);
        if (daySchedules.length > 0) {
            shiftHtml += `<div style="width: 6px; height: 6px; background: var(--warning); border-radius: 50%; margin: 2px auto;"></div>`;
        }

        const isSelected = selectedMyDateStr === currentDateStr;
        const bg = isSelected ? 'background: rgba(2, 132, 199, 0.1); border: 2px solid var(--accent-primary);' : 'background: var(--bg-secondary); border: 2px solid transparent;';

        html += `
            <div style="padding: 10px 0; border-radius: 8px; cursor: pointer; ${bg} transition: 0.2s;" onclick="showMyDayDetails('${currentDateStr}')">
                <div style="font-weight: bold; ${dateObj.getDay() === 0 ? 'color:var(--danger);' : dateObj.getDay() === 6 ? 'color:var(--accent-primary);' : ''}">${d}</div>
                <div style="height: 12px; display: flex; justify-content: center; gap: 2px; margin-top: 4px;">${shiftHtml}</div>
            </div>
        `;
    }
    container.innerHTML = html;
    if (selectedMyDateStr) showMyDayDetails(selectedMyDateStr);
}

function prevMyMonth() { currentMyDate.setMonth(currentMyDate.getMonth() - 1); renderMyCalendar(); }
function nextMyMonth() { currentMyDate.setMonth(currentMyDate.getMonth() + 1); renderMyCalendar(); }

function showMyDayDetails(dateStr) {
    selectedMyDateStr = dateStr;
    renderMyCalendar();
    const detailsDiv = document.getElementById('my-day-details');
    const title = document.getElementById('my-day-details-title');
    const content = document.getElementById('my-day-details-content');
    detailsDiv.style.display = 'block';
    const [y, m, d] = dateStr.split('-');
    title.textContent = `${y}年 ${parseInt(m)}月 ${parseInt(d)}日の予定`;

    let html = '';
    // 割り当て済みシフト
    allShifts.forEach(shift => {
        let isAssigned = false;
        let timeStr = '時間未定';

        if (shift.assignments) {
            const myA = shift.assignments.find(a => a.user_id === currentUser.id && a.date === dateStr);
            if (myA) { isAssigned = true; const di = shift.dates?.find(x => x.date === dateStr); if (di) timeStr = `${di.startTime} 〜 ${di.endTime}`; }
        }
        if (shift.assigned_user_id === currentUser.id) {
            const shiftDates = shift.dates ? shift.dates.map(x => x.date) : [shift.date];
            if (shiftDates.includes(dateStr)) { isAssigned = true; const di = shift.dates?.find(x => x.date === dateStr); if (di) timeStr = `${di.startTime} 〜 ${di.endTime}`; }
        }

        if (isAssigned) {
            html += `
                <div style="background: rgba(255,255,255,0.8); border-left: 4px solid var(--accent-primary); padding: 12px; border-radius: 8px; margin-bottom: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                    <div style="font-size: 12px; color: var(--accent-primary); font-weight: bold; margin-bottom: 4px;">🏢 確定シフト</div>
                    <div style="font-weight: bold; margin-bottom: 4px; font-size: 16px;">${shift.title}</div>
                    <div style="font-size: 13px; color: var(--text-secondary);">⏰ ${timeStr}</div>
                </div>
            `;
        }
    });

    const daySchedules = mySchedules.filter(s => s.date === dateStr);
    daySchedules.forEach(schedule => {
        html += `
            <div style="background: rgba(255,255,255,0.8); border-left: 4px solid var(--warning); padding: 12px; border-radius: 8px; margin-bottom: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); display: flex; justify-content: space-between; align-items: start;">
                <div>
                    <div style="font-size: 12px; color: var(--warning); font-weight: bold; margin-bottom: 4px;">👤 プライベート予定</div>
                    <div style="font-weight: bold; font-size: 15px;">${schedule.title}</div>
                </div>
                <button onclick="deletePersonalSchedule('${schedule.id}')" style="background:none; border:none; color: var(--danger); cursor: pointer; padding: 4px 8px; font-size: 16px;">🗑️</button>
            </div>
        `;
    });

    if (html === '') html = '<div style="color: var(--text-secondary); font-size: 13px; text-align: center; padding: 20px;">予定はありません</div>';
    content.innerHTML = html;
}

// ==========================================
// 9. 個人の予定管理
// ==========================================
function openScheduleModal() {
    document.getElementById('schedule-date').value = selectedMyDateStr || '';
    document.getElementById('schedule-title').value = '';
    document.getElementById('schedule-modal').classList.add('active');
}
function closeScheduleModal() { document.getElementById('schedule-modal').classList.remove('active'); }

async function savePersonalSchedule() {
    const date = document.getElementById('schedule-date').value;
    const title = document.getElementById('schedule-title').value;
    if (!date || !title) return alert('全ての項目を入力してください');
    try {
        const res = await fetch('/api/me/schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ date, title }) });
        if (res.ok) { closeScheduleModal(); loadAllData(); } else { alert('保存に失敗しました'); }
    } catch (e) { alert('通信エラーが発生しました'); }
}

async function deletePersonalSchedule(id) {
    if (!confirm('予定を削除しますか？')) return;
    try {
        const res = await fetch(`/api/me/schedules/${id}`, { method: 'DELETE', credentials: 'include' });
        if (res.ok) loadAllData();
    } catch (e) { alert('通信エラーが発生しました'); }
}

// ==========================================
// 10. ログアウト ＆ モーダル
// ==========================================
async function logout() {
    try { await fetch('/api/melogout', { method: 'POST', credentials: 'include' }); } catch (e) { }
    window.location.href = '/login.html';
}

window.addEventListener('click', (e) => {
    if (e.target === document.getElementById('schedule-modal')) closeScheduleModal();
});