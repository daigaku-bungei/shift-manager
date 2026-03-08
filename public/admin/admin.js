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

    switch (sectionName) {
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
        const response = await fetch('/api/me?role=admin', { credentials: 'include' });
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
    document.getElementById('stat-active-members').textContent = members.filter(m => m.role === 'staff').length;
    document.getElementById('stat-total-responses').textContent = responses.length;
    // assigned_user_idまたはassignmentsがあるものは割当済み
    const assignedCount = shifts.filter(s => s.assigned_user_id || (s.assignments && s.assignments.length > 0)).length;
    document.getElementById('stat-pending-shifts').textContent = shifts.length - assignedCount;
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
                    ${(shift.assigned_user_id || (shift.assignments && shift.assignments.length > 0)) ? `<span class="badge badge-success">割当済</span>` : `<span class="badge badge-warning">未割当</span>`}
                </div>
            </div>
        </div>
    `).join('');
}

// スロット生成（クライアント側）
function generateTimeSlotsClient(startTime, endTime, intervalMin) {
    const slots = [];
    const interval = parseInt(intervalMin) || 30;
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    let cur = sh * 60 + sm;
    const end = eh * 60 + em;
    while (cur < end) {
        const next = Math.min(cur + interval, end);
        const s = `${String(Math.floor(cur / 60)).padStart(2, '0')}:${String(cur % 60).padStart(2, '0')}`;
        const e = `${String(Math.floor(next / 60)).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}`;
        slots.push({ key: `${s}-${e}`, start: s, end: e });
        cur = next;
    }
    return slots;
}

// シフト一覧読み込み（タイムライン・グリッド方式）
async function loadShifts() {
    try {
        const response = await fetch('/api/shifts', { credentials: 'include' });
        shifts = await response.json();
        if (members.length === 0) {
            const membersRes = await fetch('/api/members', { credentials: 'include' });
            members = await membersRes.json();
        }
        const responsesRes = await fetch('/api/responses', { credentials: 'include' });
        responses = await responsesRes.json();
        const container = document.getElementById('shifts-list');
        if (shifts.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><h2>シフトがまだありません</h2><p>新規シフトを作成してください</p></div>';
            return;
        }
        container.innerHTML = shifts.map(shift => {
            const shiftResponses = responses.filter(r => r.shift_id === shift.id || r.shiftId === shift.id);
            const dateCols = (shift.dates && shift.dates.length > 0) ? shift.dates : [];
            const staffMembers = members.filter(m => m.role === 'staff');
            const assignments = shift.assignments || [];
            const requiredCount = parseInt(shift.required_staff_count) || 1;
            const interval = parseInt(shift.slotInterval) || 30;
            let deadlineHtml = '';
            if (shift.deadline) {
                const dt = new Date(shift.deadline);
                const isExpired = dt < new Date();
                deadlineHtml = `<span style="display:inline-block;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:bold;${isExpired ? 'background:#fee2e2;color:#ef4444;' : 'background:#fffbeb;color:#d97706;'}">⏰ ${dt.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })} ${isExpired ? '(終了)' : ''}</span>`;
            }
            let gridHtml = '';
            if (dateCols.length > 0) {
                let allSlotKeys = new Set();
                const dateSlotMap = {};
                dateCols.forEach(d => {
                    const slots = generateTimeSlotsClient(d.startTime, d.endTime, interval);
                    dateSlotMap[d.date] = slots;
                    slots.forEach(s => allSlotKeys.add(s.key));
                });
                const sortedSlots = Array.from(allSlotKeys).sort();
                const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
                let rowIdx = 0;
                gridHtml = `<div style="overflow-x:auto;margin-top:14px;border-radius:12px;border:1px solid var(--border-color);box-shadow:0 1px 4px rgba(0,0,0,0.04);">
                    <table style="width:100%;border-collapse:collapse;font-size:13px;white-space:nowrap;">
                    <thead>
                        <tr style="background:linear-gradient(180deg,#f8fafc,#f1f5f9);border-bottom:2px solid var(--border-color);">
                            <th style="padding:10px 14px;border-right:2px solid var(--border-color);text-align:left;position:sticky;left:0;background:linear-gradient(180deg,#f8fafc,#f1f5f9);z-index:3;min-width:80px;font-size:12px;color:#64748b;">⏰ 時間</th>
                            ${dateCols.map(d => {
                    const dateObj = new Date(d.date);
                    const dn = dayNames[dateObj.getDay()];
                    const isSun = dateObj.getDay() === 0;
                    const isSat = dateObj.getDay() === 6;
                    const colColor = isSun ? 'color:#ef4444;' : isSat ? 'color:#3b82f6;' : '';
                    return `<th style="padding:10px 14px;border-right:1px solid var(--border-color);min-width:150px;text-align:center;${colColor}">
                                    <div style="font-size:15px;font-weight:800;letter-spacing:0.5px;">${dateObj.getMonth() + 1}/${dateObj.getDate()}</div>
                                    <div style="font-size:10px;color:#94a3b8;font-weight:600;margin-top:2px;">(${dn}) ${d.startTime}~${d.endTime}</div>
                                </th>`;
                }).join('')}
                        </tr>
                    </thead>
                    <tbody>
                    ${sortedSlots.map((slotKey, si) => {
                    const [slotStart, slotEnd] = slotKey.split('-');
                    const isEven = si % 2 === 0;
                    const rowBg = isEven ? '#ffffff' : '#f8fafc';
                    const timeBg = isEven ? '#f1f5f9' : '#e8edf2';
                    return `<tr style="border-bottom:1px solid #e2e8f0;">
                            <td style="padding:8px 12px;border-right:2px solid var(--border-color);font-weight:800;position:sticky;left:0;background:${timeBg};z-index:2;font-size:13px;color:#475569;vertical-align:middle;text-align:center;line-height:1.2;">
                                ${slotStart}<span style="font-size:10px;color:#94a3b8;font-weight:500;display:block;">~${slotEnd}</span>
                            </td>
                            ${dateCols.map(d => {
                        const dateSlots = dateSlotMap[d.date] || [];
                        const hasSlot = dateSlots.some(s => s.key === slotKey);
                        if (!hasSlot) return `<td style="padding:6px;border-right:1px solid #e2e8f0;background:#f1f5f9;text-align:center;"><span style="opacity:0.15;">—</span></td>`;
                        const slotAssignments = assignments.filter(a => a.date === d.date && a.slot === slotKey);
                        const legacyAssignments = assignments.filter(a => a.date === d.date && !a.slot);
                        const allAssigned = [...slotAssignments];
                        legacyAssignments.forEach(la => { if (!allAssigned.some(a => a.user_id === la.user_id)) allAssigned.push(la); });
                        const isShort = allAssigned.length < requiredCount;
                        const isFull = allAssigned.length >= requiredCount;
                        let bg = rowBg;
                        if (isShort && allAssigned.length === 0) bg = 'rgba(239,68,68,0.07)';
                        else if (isShort) bg = 'rgba(251,191,36,0.08)';
                        else if (isFull) bg = 'rgba(16,185,129,0.06)';
                        let cellContent = '';
                        allAssigned.forEach(a => {
                            const mn = staffMembers.find(m => m.id === a.user_id)?.name || '?';
                            cellContent += `<div style="display:inline-flex;align-items:center;gap:4px;margin:2px 3px;padding:4px 10px;border-radius:8px;font-size:12px;font-weight:700;background:rgba(29,155,240,0.1);color:#1d9bf0;border:1px solid rgba(29,155,240,0.18);white-space:nowrap;">
                                        ${mn}
                                        <button onclick="unassignSlot('${shift.id}','${a.user_id}','${d.date}','${slotKey}')" style="background:none;border:none;cursor:pointer;color:#ef4444;font-size:11px;padding:0 1px;opacity:0.6;" title="解除">✕</button>
                                    </div>`;
                        });
                        if (isShort) {
                            const needed = requiredCount - allAssigned.length;
                            cellContent += `<div style="margin-top:3px;font-size:11px;color:#ef4444;font-weight:700;letter-spacing:0.3px;">⚠ あと${needed}人</div>`;
                            const assignedIds = allAssigned.map(a => a.user_id);
                            const cands = staffMembers.filter(m => !assignedIds.includes(m.id));
                            if (cands.length > 0) {
                                cellContent += `<select onchange="if(this.value)assignSlot('${shift.id}',this.value,'${d.date}','${slotKey}')" style="margin-top:3px;padding:3px 4px;font-size:11px;border:1px solid #e2e8f0;border-radius:6px;width:100%;background:white;cursor:pointer;color:#64748b;">
                                            <option value="">+ スタッフ追加...</option>
                                            ${cands.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
                                        </select>`;
                            }
                        }
                        return `<td style="padding:6px 8px;border-right:1px solid #e2e8f0;background:${bg};vertical-align:top;text-align:center;min-height:44px;">${cellContent || '<span style="opacity:0.12;font-size:11px;">—</span>'}</td>`;
                    }).join('')}
                        </tr>`;
                }).join('')}
                    </tbody>
                    </table>
                </div>`;
            }
            const respondedIds = shiftResponses.map(r => r.userId || r.user_id);
            const noResponseStaff = staffMembers.filter(m => !respondedIds.includes(m.id));
            let totalSlots = 0, filledSlots = 0;
            dateCols.forEach(d => { const slots = generateTimeSlotsClient(d.startTime, d.endTime, interval); slots.forEach(s => { totalSlots++; const assigned = assignments.filter(a => a.date === d.date && a.slot === s.key).length; if (assigned >= requiredCount) filledSlots++; }); });
            const fillRate = totalSlots > 0 ? Math.round(filledSlots / totalSlots * 100) : 0;
            return `<div class="card" style="border-left:4px solid var(--accent-primary);padding:15px;margin-bottom:16px;"><div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px dashed var(--border-color);padding-bottom:10px;margin-bottom:10px;"><h2 style="font-size:16px;font-weight:800;margin:0;">${shift.title}</h2><div style="display:flex;gap:8px;align-items:center;">${deadlineHtml}<button class="btn btn-primary" style="padding:4px 10px;font-size:12px;" onclick="openEditShiftModal('${shift.id}')">編集</button><button class="btn btn-danger" style="padding:4px 10px;font-size:12px;" onclick="deleteShift('${shift.id}')">削除</button></div></div>${shift.description ? `<p style="color:var(--text-secondary);font-size:12px;margin-bottom:8px;">📝 ${shift.description}</p>` : ''}<div style="display:flex;gap:10px;font-size:12px;margin-bottom:8px;flex-wrap:wrap;"><span style="padding:3px 8px;border-radius:6px;background:rgba(29,155,240,0.1);color:var(--accent-primary);font-weight:700;">回答 ${shiftResponses.length}/${staffMembers.length}</span><span style="padding:3px 8px;border-radius:6px;background:rgba(0,186,124,0.1);color:var(--success);font-weight:700;">必要 ${requiredCount}名/コマ</span><span style="padding:3px 8px;border-radius:6px;background:${fillRate >= 100 ? 'rgba(0,186,124,0.1);color:var(--success)' : 'rgba(244,33,46,0.08);color:var(--danger)'};font-weight:700;">充足率 ${fillRate}%</span>${assignments.length > 0 ? `<span style="padding:3px 8px;border-radius:6px;background:rgba(0,186,124,0.1);color:var(--success);font-weight:700;">📌 ${assignments.length}件割当</span>` : ''} ${noResponseStaff.length > 0 ? `<span style="padding:3px 8px;border-radius:6px;background:rgba(244,33,46,0.08);color:var(--danger);font-weight:700;">未回答: ${noResponseStaff.map(m => m.name).join(', ')}</span>` : ''}</div>${gridHtml}</div>`;
        }).join('');
    } catch (error) {
        console.error('シフトの読み込みに失敗:', error);
        showAlert('シフトの読み込みに失敗しました', 'error');
    }
}

// スロット単位の手動割り当て
async function assignSlot(shiftId, userId, date, slot) {
    try {
        const res = await fetch(`/api/shifts/${shiftId}/assign`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ user_id: userId, date, slot }) });
        if (res.ok) { showAlert('割り当てました！', 'success'); loadShifts(); } else { showAlert('割り当てに失敗しました', 'error'); }
    } catch (e) { showAlert('通信エラー', 'error'); }
}

// スロット単位の割り当て解除
async function unassignSlot(shiftId, userId, date, slot) {
    try {
        const res = await fetch(`/api/shifts/${shiftId}/unassign`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ user_id: userId, date, slot }) });
        if (res.ok) { showAlert('解除しました', 'success'); loadShifts(); } else { showAlert('解除に失敗しました', 'error'); }
    } catch (e) { showAlert('通信エラー', 'error'); }
}

// シフト表PDFエクスポート（クリーンHTMLテーブル → html2canvas → jsPDF）
async function exportAllShiftsPDF() {
    if (shifts.length === 0) {
        showAlert('出力するシフトがありません', 'warning');
        return;
    }

    const btn = document.querySelector('button[onclick="exportAllShiftsPDF()"]');
    if (btn) { btn.disabled = true; btn.textContent = '生成中...'; }

    try {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        const margin = 8;
        const staffMembers = members.filter(m => m.role === 'staff');
        const dayNames = ['日', '月', '火', '水', '木', '金', '土'];

        for (let si = 0; si < shifts.length; si++) {
            if (si > 0) pdf.addPage();
            const shift = shifts[si];
            const dateCols = (shift.dates && shift.dates.length > 0) ? shift.dates : [];
            const assignments = shift.assignments || [];
            const requiredCount = parseInt(shift.required_staff_count) || 1;
            const interval = parseInt(shift.slotInterval) || 30;

            // 全スロットキー
            let allSlotKeys = new Set();
            const dateSlotMap = {};
            dateCols.forEach(d => {
                const slots = generateTimeSlotsClient(d.startTime, d.endTime, interval);
                dateSlotMap[d.date] = slots;
                slots.forEach(s => allSlotKeys.add(s.key));
            });
            const sortedSlots = Array.from(allSlotKeys).sort();

            // ── 裏でクリーンなHTMLテーブルを構築 ──
            const container = document.createElement('div');
            container.style.cssText = 'position:fixed;top:-9999px;left:-9999px;background:#fff;padding:24px 20px;font-family:"Hiragino Kaku Gothic ProN","Hiragino Sans",Meiryo,sans-serif;';

            // タイトルヘッダー
            const title = document.createElement('div');
            title.style.cssText = 'margin-bottom:12px;';
            title.innerHTML = `
                <div style="font-size:20px;font-weight:bold;color:#1a1a1a;margin-bottom:4px;">${shift.title || 'シフト表'}</div>
                <div style="font-size:11px;color:#666;display:flex;gap:16px;">
                    <span>必要人数: ${requiredCount}名/コマ</span>
                    <span>コマ: ${interval}分</span>
                    <span>出力日時: ${new Date().toLocaleString('ja-JP')}</span>
                </div>
            `;
            container.appendChild(title);

            if (dateCols.length === 0 || sortedSlots.length === 0) {
                const noData = document.createElement('p');
                noData.textContent = 'データがありません';
                noData.style.cssText = 'color:#999;font-size:14px;';
                container.appendChild(noData);
            } else {
                // テーブル生成
                const table = document.createElement('table');
                table.style.cssText = 'border-collapse:collapse;width:100%;font-size:11px;';

                // ヘッダー
                const thead = document.createElement('thead');
                const headerRow = document.createElement('tr');
                const thTime = document.createElement('th');
                thTime.textContent = '時間';
                thTime.style.cssText = 'border:1px solid #999;padding:6px 8px;background:#e8e8e8;font-weight:bold;text-align:center;min-width:70px;color:#333;';
                headerRow.appendChild(thTime);

                dateCols.forEach(d => {
                    const dt = new Date(d.date);
                    const th = document.createElement('th');
                    th.textContent = `${dt.getMonth() + 1}/${dt.getDate()} (${dayNames[dt.getDay()]})`;
                    const isSun = dt.getDay() === 0;
                    const isSat = dt.getDay() === 6;
                    th.style.cssText = `border:1px solid #999;padding:6px 10px;background:#e8e8e8;font-weight:bold;text-align:center;min-width:100px;color:${isSun ? '#d00' : isSat ? '#06c' : '#333'};`;
                    headerRow.appendChild(th);
                });
                thead.appendChild(headerRow);
                table.appendChild(thead);

                // ボディ
                const tbody = document.createElement('tbody');
                sortedSlots.forEach((slotKey, ri) => {
                    const tr = document.createElement('tr');
                    const [slotStart, slotEnd] = slotKey.split('-');

                    // 時間セル
                    const tdTime = document.createElement('td');
                    tdTime.textContent = `${slotStart}~${slotEnd}`;
                    tdTime.style.cssText = `border:1px solid #999;padding:5px 8px;background:${ri % 2 === 0 ? '#f5f5f5' : '#eee'};font-weight:bold;text-align:center;color:#444;white-space:nowrap;`;
                    tr.appendChild(tdTime);

                    dateCols.forEach(d => {
                        const td = document.createElement('td');
                        const dateSlots = dateSlotMap[d.date] || [];
                        if (!dateSlots.some(s => s.key === slotKey)) {
                            td.textContent = '—';
                            td.style.cssText = `border:1px solid #ccc;padding:5px 6px;text-align:center;background:#f0f0f0;color:#bbb;`;
                        } else {
                            const slotAssigns = assignments.filter(a => a.date === d.date && a.slot === slotKey);
                            const legacyAssigns = assignments.filter(a => a.date === d.date && !a.slot);
                            const allAssigned = [...slotAssigns];
                            legacyAssigns.forEach(la => {
                                if (!allAssigned.some(a => a.user_id === la.user_id)) allAssigned.push(la);
                            });
                            const shortage = requiredCount - allAssigned.length;

                            if (allAssigned.length === 0) {
                                // 完全欠員
                                td.textContent = `— (${requiredCount}名不足)`;
                                td.style.cssText = 'border:1px solid #ccc;padding:5px 6px;text-align:center;background:#fdd;color:#c00;font-weight:bold;';
                            } else {
                                const names = allAssigned.map(a => {
                                    const m = staffMembers.find(mm => mm.id === a.user_id);
                                    return m ? m.name : '?';
                                });
                                let text = names.join('、');
                                if (shortage > 0) text += ` (${shortage}名不足)`;

                                td.textContent = text;
                                if (shortage > 0) {
                                    td.style.cssText = `border:1px solid #ccc;padding:5px 6px;text-align:center;background:#ffefd5;color:#995500;`;
                                } else {
                                    td.style.cssText = `border:1px solid #ccc;padding:5px 6px;text-align:center;background:${ri % 2 === 0 ? '#fff' : '#fafafa'};color:#222;`;
                                }
                            }
                        }
                        tr.appendChild(td);
                    });
                    tbody.appendChild(tr);
                });
                table.appendChild(tbody);
                container.appendChild(table);
            }

            // 凡例
            const legend = document.createElement('div');
            legend.style.cssText = 'margin-top:8px;font-size:10px;color:#888;display:flex;gap:16px;';
            legend.innerHTML = `
                <span>■<span style="color:#222;"> 充足</span></span>
                <span style="color:#995500;">■ 一部不足</span>
                <span style="color:#c00;">■ 欠員</span>
            `;
            container.appendChild(legend);

            document.body.appendChild(container);

            // html2canvasでキャプチャ
            const canvas = await html2canvas(container, {
                scale: 2,
                backgroundColor: '#ffffff',
                logging: false
            });

            document.body.removeChild(container);

            // PDFに貼り付け
            const imgData = canvas.toDataURL('image/png');
            const availW = pageW - margin * 2;
            const availH = pageH - margin * 2;
            const imgAspect = canvas.width / canvas.height;
            let drawW = availW;
            let drawH = drawW / imgAspect;
            if (drawH > availH) {
                drawH = availH;
                drawW = drawH * imgAspect;
            }
            pdf.addImage(imgData, 'PNG', margin, margin, drawW, drawH);
        }

        const now = new Date();
        const fname = `シフト表_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}.pdf`;
        pdf.save(fname);
        showAlert('PDFをダウンロードしました！', 'success');
    } catch (error) {
        console.error('PDF出力エラー:', error);
        showAlert('PDF出力に失敗しました: ' + error.message, 'error');
    }

    if (btn) { btn.disabled = false; btn.textContent = '📄 PDF出力'; }
}

// 魔法の自動生成（スロット単位一括割り当て）
async function runAutoAssign() {
    if (!confirm('未割当のシフトすべてに対して、希望・相性・実績を元に自動でシフトを組みますか？\n（既に割当済のシフトは変更されません）')) return;

    try {
        const btn = document.querySelector('button[onclick="runAutoAssign()"]');
        if (btn) {
            btn.disabled = true;
            btn.textContent = '生成中...';
        }

        const response = await fetch('/api/shifts/auto-assign-all', {
            method: 'POST',
            credentials: 'include'
        });

        if (response.ok) {
            const result = await response.json();
            if (result.count > 0) {
                // 割り当て結果の詳細を表示
                let detailMsg = `${result.count}件の割り当てが完了しました！\n\n`;
                if (result.details && result.details.length > 0) {
                    result.details.forEach(d => {
                        const dateObj = new Date(d.date);
                        detailMsg += `📅 ${dateObj.getMonth() + 1}/${dateObj.getDate()} ${d.slot || ''} → ${d.memberName}\n`;
                    });
                }
                alert(detailMsg);
                showAlert(`${result.count}件のシフトを自動で割り当てました！`, 'success');
            } else {
                showAlert('該当する候補者が見つかりませんでした（回答がない、または全て✕の可能性があります）', 'warning');
            }
            loadShifts();
            loadDashboard();
        } else {
            showAlert('自動シフト生成に失敗しました', 'error');
        }

        if (btn) {
            btn.disabled = false;
            btn.textContent = '✨ 全体自動シフト生成';
        }
    } catch (error) {
        console.error('自動生成エラー:', error);
        showAlert('通信エラーが発生しました', 'error');
    }
}

// 招待リンク生成
async function generateInviteLink() {
    try {
        const res = await fetch('/api/invite/create', {
            method: 'POST',
            credentials: 'include'
        });
        const data = await res.json();
        if (res.ok && data.success) {
            document.getElementById('invite-url').value = data.url;
            document.getElementById('invite-modal').style.display = 'block';
            showAlert('招待リンクを生成しました！', 'success');
        } else {
            showAlert(data.error || '招待リンクの生成に失敗しました', 'error');
        }
    } catch (error) {
        console.error('招待リンク生成エラー:', error);
        showAlert('通信エラーが発生しました', 'error');
    }
}

function copyInviteLink() {
    const input = document.getElementById('invite-url');
    input.select();
    navigator.clipboard.writeText(input.value).then(() => {
        showAlert('リンクをコピーしました！LINEなどで共有してください 📱', 'success');
    }).catch(() => {
        document.execCommand('copy');
        showAlert('リンクをコピーしました！', 'success');
    });
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

        // ▼ ▼ ▼ ペアリング用のセレクトボックス更新 ▼ ▼ ▼
        const rule1 = document.getElementById('rule-member1');
        const rule2 = document.getElementById('rule-member2');
        const options = members.filter(m => m.role !== 'admin').map(m => `<option value="${m.id}">${m.name}</option>`).join('');
        if (rule1) rule1.innerHTML = '<option value="">選択してください</option>' + options;
        if (rule2) rule2.innerHTML = '<option value="">選択してください</option>' + options;
        loadPairings();
        // ▲ ▲ ▲ 

        tbody.innerHTML = members.map(member => `
            <tr>
                <td>${member.name}</td>
                <td style="color: var(--text-secondary); font-size: 14px;">${member.id}</td>
                <td>
                    <select class="form-control" style="width: auto; display: inline-block; padding: 4px 8px; font-size: 13px;" onchange="updateMemberSkill('${member.id}', this.value)">
                        <option value="1" ${member.skill_level == 1 ? 'selected' : ''}>Lv1 (初心者)</option>
                        <option value="2" ${member.skill_level == 2 ? 'selected' : ''}>Lv2</option>
                        <option value="3" ${member.skill_level == 3 ? 'selected' : ''}>Lv3 (標準)</option>
                        <option value="4" ${member.skill_level == 4 ? 'selected' : ''}>Lv4</option>
                        <option value="5" ${member.skill_level == 5 ? 'selected' : ''}>Lv5 (上級者)</option>
                    </select>
                </td>
                <td style="color: var(--text-secondary); font-size: 14px;">${member.group || '-'}</td>
                <td>
                    <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 12px; margin-right: 5px;" onclick="openEditMemberModal('${member.id}')">編集</button>
                    ${member.role !== 'admin' ? `<button class="btn btn-danger" style="padding: 4px 10px; font-size: 12px;" onclick="deleteMember('${member.id}')">削除</button>` : ''}
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('メンバーの読み込みに失敗:', error);
        showAlert('メンバーの読み込みに失敗しました', 'error');
    }
}

// メンバースキル更新
async function updateMemberSkill(memberId, newLevel) {
    try {
        const response = await fetch(`/api/members/${memberId}/skill`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ skill_level: parseInt(newLevel) })
        });

        if (response.ok) {
            showAlert('スキルレベルを更新しました', 'success');
        } else {
            showAlert('スキルレベルの更新に失敗しました', 'error');
            loadMembers(); // Revert UI
        }
    } catch (error) {
        showAlert('通信エラーが発生しました', 'error');
        loadMembers(); // Revert UI
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

// ==========================================
// 相性（ペアリング）ルール管理
// ==========================================
let pairings = [];

async function loadPairings() {
    try {
        const res = await fetch('/api/pairings', { credentials: 'include' });
        pairings = await res.json();

        const list = document.getElementById('rules-list');
        if (!list) return;

        if (pairings.length === 0) {
            list.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 20px;">設定されたルールはありません</p>';
            return;
        }

        list.innerHTML = pairings.map(p => {
            const m1 = members.find(m => m.id === p.member1_id)?.name || '不明';
            const m2 = members.find(m => m.id === p.member2_id)?.name || '不明';
            const text = p.type === 'pair' ? '同じシフトにする（ペア）' : '別のシフトにする';
            const color = p.type === 'pair' ? 'var(--success)' : 'var(--danger)';
            return `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-tertiary);">
                    <div>
                        <strong style="font-size: 14px;">${m1}</strong> <span style="font-size: 13px;">と</span> <strong style="font-size: 14px;">${m2}</strong> <span style="font-size: 13px;">を</span> <strong style="color: ${color}; font-size: 14px;">${text}</strong>
                    </div>
                    <button class="btn btn-danger" style="padding: 6px 12px; font-size: 12px;" onclick="deletePairRule('${p.id}')">削除</button>
                </div>
            `;
        }).join('');
    } catch (e) {
        console.error('ルールの読み込み失敗:', e);
    }
}

async function addPairRule() {
    const m1 = document.getElementById('rule-member1').value;
    const m2 = document.getElementById('rule-member2').value;
    const type = document.getElementById('rule-type').value;

    if (!m1 || !m2) {
        showAlert('2人のメンバーを選択してください', 'error');
        return;
    }
    if (m1 === m2) {
        showAlert('同じメンバー同士は設定できません', 'error');
        return;
    }

    try {
        const res = await fetch('/api/pairings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ member1_id: m1, member2_id: m2, type })
        });
        if (res.ok) {
            showAlert('ルールを追加しました', 'success');
            loadPairings();
        } else {
            showAlert('追加に失敗しました', 'error');
        }
    } catch (e) {
        showAlert('通信エラー', 'error');
    }
}

async function deletePairRule(id) {
    if (!confirm('このルールを削除しますか？')) return;
    try {
        const res = await fetch(`/api/pairings/${id}`, { method: 'DELETE', credentials: 'include' });
        if (res.ok) {
            showAlert('ルールを削除しました', 'success');
            loadPairings();
        }
    } catch (e) {
        showAlert('削除エラー', 'error');
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

            // 日付列の抽出
            let dateCols = [];
            if (shift.dates && shift.dates.length > 0) {
                dateCols = shift.dates.map(d => d.date);
            } else {
                dateCols = [shift.date];
            }

            // スタッフ一覧を取得（回答マトリックスの行になる）
            const staffMembers = members.filter(m => m.role === 'staff');

            let matrixHtml = `
            <div style="overflow-x: auto; margin-top: 15px; border-radius: 8px; border: 1px solid var(--border-color);">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: center; white-space: nowrap;">
                    <thead>
                        <tr style="background: var(--bg-tertiary); border-bottom: 2px solid var(--border-color);">
                            <th style="padding: 10px; border-right: 1px solid var(--border-color); text-align: left; position: sticky; left: 0; background: var(--bg-tertiary); z-index: 2;">スタッフ</th>
                            ${dateCols.map(d => `<th style="padding: 10px; border-right: 1px solid var(--border-color); min-width: 60px;">${formatDate(d)}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
            `;

            staffMembers.forEach(member => {
                const userResponse = shiftResponses.find(r => r.userId === member.id || r.user_id === member.id);

                matrixHtml += `<tr style="border-bottom: 1px solid var(--border-color);">`;
                matrixHtml += `<td style="padding: 10px; border-right: 1px solid var(--border-color); text-align: left; font-weight: bold; position: sticky; left: 0; background: var(--bg-secondary); z-index: 1;">${member.name}</td>`;

                dateCols.forEach(date => {
                    let cellContent = '<span style="color: var(--text-secondary); opacity: 0.5;">-</span>'; // 未回答
                    let bgColor = '';
                    if (userResponse && userResponse.dailyResponses) {
                        const dayResp = userResponse.dailyResponses.find(dr => dr.date === date);
                        if (dayResp) {
                            if (dayResp.status === 'available') {
                                cellContent = '◎';
                                bgColor = 'background: rgba(16, 185, 129, 0.1); color: var(--success); font-weight: bold; font-size: 16px;';
                            } else if (dayResp.status === 'partial') {
                                cellContent = `<div style="line-height: 1.2;">△<br><span style="font-size: 10px;">${dayResp.startTime}-${dayResp.endTime}</span></div>`;
                                bgColor = 'background: rgba(245, 158, 11, 0.1); color: var(--warning); font-weight: bold;';
                            } else if (dayResp.status === 'unavailable') {
                                cellContent = '✕';
                                bgColor = 'background: rgba(239, 68, 68, 0.1); color: var(--danger); font-weight: bold; font-size: 14px;';
                            }
                        }
                    }
                    matrixHtml += `<td style="padding: 10px; border-right: 1px solid var(--border-color); ${bgColor}">${cellContent}</td>`;
                });
                matrixHtml += `</tr>`;
            });

            matrixHtml += `
                    </tbody>
                </table>
            </div>`;

            return `
                <div class="card" style="padding: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <h2 style="margin: 0; font-size: 18px; font-weight: bold;">${shift.title}</h2>
                        <span style="font-size: 13px; color: var(--text-secondary); font-weight: bold; background: var(--bg-tertiary); padding: 4px 10px; border-radius: 20px;">回答率: ${shiftResponses.length}/${staffMembers.length}</span>
                    </div>
                    ${matrixHtml}
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
});

// モーダルの外側（暗い部分）をクリックしたら閉じる
window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        if (e.target.id === 'create-shift-modal' && typeof closeCreateShiftModal === 'function') {
            closeCreateShiftModal();
        } else if (e.target.id === 'add-member-modal' && typeof closeAddMemberModal === 'function') {
            closeAddMemberModal();
        } else if (e.target.id === 'edit-member-modal' && typeof closeModal === 'function') {
            closeModal('edit-member-modal');
        } else {
            e.target.classList.remove('active');
        }
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
        deadline: deadline,
        dates: dates,
        required_skill_level: 1,
        required_staff_count: parseInt(document.getElementById('required-staff-count').value) || 1,
        allow_preferred_count: document.getElementById('allow-preferred-count').checked
    };

    try {
        const response = await fetch('/api/shifts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(newShiftData)
        });

        if (response.ok) {
            showAlert('シフトを作成しました！', 'success');
            closeCreateShiftModal();
            // 🌟 4. 次開いた時のために期限の入力欄を空に戻しておく
            if (document.getElementById('shift-deadline')) document.getElementById('shift-deadline').value = '';
            loadDashboard();
            loadShifts();
        } else {
            const error = await response.json();
            showAlert(error.error || 'シフト作成に失敗しました', 'error');
        }
    } catch (error) {
        console.error('シフト作成エラー:', error);
        showAlert('シフト作成に失敗しました', 'error');
    }
}

// 期限をワンタッチでセットする関数
function setQuickDeadline(daysToAdd) {
    const dt = new Date();
    dt.setDate(dt.getDate() + daysToAdd);
    dt.setHours(23, 59, 0, 0); // その日の23:59にする

    // input[type="datetime-local"] 用のフォーマット (YYYY-MM-DDThh:mm)
    const tzOffset = dt.getTimezoneOffset() * 60000; // local time adjustment
    const localISOTime = (new Date(dt - tzOffset)).toISOString().slice(0, 16);

    document.getElementById('shift-deadline').value = localISOTime;
}

// シフト削除
async function deleteShift(shiftId) {
    // setTimeoutでconfirmダイアログが再描画と競合しないようにする
    const userConfirmed = await new Promise(resolve => {
        setTimeout(() => resolve(confirm('このシフトを削除してもよろしいですか？\n（関連する回答データも一緒に削除されます）')), 100);
    });
    if (!userConfirmed) return;
    try {
        const response = await fetch(`/api/shifts/${shiftId}`, { method: 'DELETE', credentials: 'include' });
        if (response.ok) {
            showAlert('シフトを削除しました', 'success');
            loadShifts();
            loadDashboard();
        } else {
            const err = await response.json();
            showAlert(err.error || 'シフトの削除に失敗しました', 'error');
        }
    } catch (error) {
        console.error('シフト削除エラー:', error);
        showAlert('通信エラーが発生しました', 'error');
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

// ==========================================
// シフト編集機能
// ==========================================
let editingShiftId = null;

function openEditShiftModal(shiftId) {
    const shift = shifts.find(s => s.id === shiftId);
    if (!shift) return;

    editingShiftId = shiftId;

    document.getElementById('edit-shift-title').value = shift.title || '';
    document.getElementById('edit-shift-description').value = shift.description || '';
    document.getElementById('edit-slot-interval').value = shift.slotInterval || '60';

    // 期限
    if (shift.deadline) {
        const dt = new Date(shift.deadline);
        const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        document.getElementById('edit-shift-deadline').value = local;
    } else {
        document.getElementById('edit-shift-deadline').value = '';
    }

    // 必要人数・希望シフト数
    document.getElementById('edit-required-staff-count').value = shift.required_staff_count || 1;
    document.getElementById('edit-allow-preferred-count').checked = !!shift.allow_preferred_count;

    // 日付リスト描画
    renderEditDatesList(shift.dates || []);

    document.getElementById('edit-shift-modal').classList.add('active');
}

function closeEditShiftModal() {
    document.getElementById('edit-shift-modal').classList.remove('active');
    editingShiftId = null;
}

function renderEditDatesList(dates) {
    const container = document.getElementById('edit-dates-list');
    if (!dates || dates.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); font-size: 13px;">日付が設定されていません</p>';
        return;
    }

    container.innerHTML = dates.map((d, i) => {
        const dateObj = new Date(d.date);
        const dateStr = dateObj.toLocaleDateString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' });
        return `
            <div style="display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: var(--bg-tertiary); border-radius: 8px; margin-bottom: 6px; font-size: 13px;">
                <span style="font-weight: 700; min-width: 120px;">📅 ${dateStr}</span>
                <input type="time" class="form-control edit-date-start" data-index="${i}" value="${d.startTime || '09:00'}" style="padding: 4px 6px; font-size: 12px; width: 100px;">
                <span style="color: var(--text-secondary);">〜</span>
                <input type="time" class="form-control edit-date-end" data-index="${i}" value="${d.endTime || '18:00'}" style="padding: 4px 6px; font-size: 12px; width: 100px;">
                <button onclick="removeEditDate(${i})" style="background: none; border: none; color: var(--danger); cursor: pointer; font-size: 16px; padding: 0 4px;" title="この日を削除">✕</button>
            </div>
        `;
    }).join('');
}

function applyEditBulkTime() {
    const startTime = document.getElementById('edit-bulk-start').value;
    const endTime = document.getElementById('edit-bulk-end').value;

    document.querySelectorAll('.edit-date-start').forEach(input => input.value = startTime);
    document.querySelectorAll('.edit-date-end').forEach(input => input.value = endTime);
}

function removeEditDate(index) {
    const shift = shifts.find(s => s.id === editingShiftId);
    if (!shift || !shift.dates) return;
    shift.dates.splice(index, 1);
    renderEditDatesList(shift.dates);
}

async function saveEditShift() {
    if (!editingShiftId) return;

    const title = document.getElementById('edit-shift-title').value.trim();
    if (!title) {
        showAlert('業務名を入力してください', 'error');
        return;
    }

    const shift = shifts.find(s => s.id === editingShiftId);

    // 日付データを集める
    const startInputs = document.querySelectorAll('.edit-date-start');
    const endInputs = document.querySelectorAll('.edit-date-end');
    const updatedDates = (shift.dates || []).map((d, i) => {
        if (i < startInputs.length) {
            return {
                ...d,
                startTime: startInputs[i].value,
                endTime: endInputs[i].value
            };
        }
        return d;
    });

    const deadlineVal = document.getElementById('edit-shift-deadline').value;

    const payload = {
        title: title,
        description: document.getElementById('edit-shift-description').value.trim(),
        deadline: deadlineVal ? new Date(deadlineVal).toISOString() : null,
        slotInterval: document.getElementById('edit-slot-interval').value,
        dates: updatedDates,
        required_staff_count: parseInt(document.getElementById('edit-required-staff-count').value) || 1,
        allow_preferred_count: document.getElementById('edit-allow-preferred-count').checked
    };

    try {
        const response = await fetch(`/api/shifts/${editingShiftId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            showAlert('シフトを更新しました！', 'success');
            closeEditShiftModal();
            loadShifts();
            loadDashboard();
        } else {
            const error = await response.json();
            showAlert(error.error || 'シフト更新に失敗しました', 'error');
        }
    } catch (error) {
        console.error('シフト更新エラー:', error);
        showAlert('シフト更新に失敗しました', 'error');
    }
}