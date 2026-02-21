document.addEventListener('DOMContentLoaded', () => {
    let isRegisterMode = false;
    let currentRole = 'staff'; // 初期状態はスタッフ

    // ▼ 役割切り替え
    const roleBtns = document.querySelectorAll('.login-role-toggle .btn');
    roleBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            roleBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentRole = e.target.dataset.role;
        });
    });

    // ▼ 各要素の取得
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    const nameGroup = document.getElementById('name-group');
    const userNameInput = document.getElementById('userName');
    const submitBtn = document.getElementById('submit-btn');
    const autoGenBtn = document.getElementById('auto-gen-btn'); // 🌟
    const userIdInput = document.getElementById('userId');      // 🌟

    // ▼ ⚡️ 自動生成ボタンを押した時の処理
    if (autoGenBtn && userIdInput) {
        autoGenBtn.addEventListener('click', () => {
            // ランダムな英数字6文字を生成（例: user_x8k2p9）
            const randomId = 'user_' + Math.random().toString(36).substring(2, 8);
            userIdInput.value = randomId;
            
            // 少しだけボタンを光らせる演出
            autoGenBtn.style.background = 'rgba(2, 132, 199, 0.3)';
            setTimeout(() => autoGenBtn.style.background = 'rgba(2, 132, 199, 0.1)', 200);
        });
    }

    // ▼ タブ切り替え
    if (tabLogin && tabRegister) {
        tabLogin.addEventListener('click', () => {
            isRegisterMode = false;
            tabLogin.classList.add('active');
            tabRegister.classList.remove('active');
            nameGroup.style.display = 'none';
            userNameInput.required = false;
            submitBtn.textContent = 'ログイン';
            if (autoGenBtn) autoGenBtn.style.display = 'none'; // 隠す
        });

        tabRegister.addEventListener('click', () => {
            isRegisterMode = true;
            tabRegister.classList.add('active');
            tabLogin.classList.remove('active');
            nameGroup.style.display = 'block';
            userNameInput.required = true;
            submitBtn.textContent = 'アカウントを作成してログイン';
            if (autoGenBtn) autoGenBtn.style.display = 'block'; // 表示！
        });
    }

    // ▼ 送信ボタンを押した時の処理
    const authForm = document.getElementById('authForm');
    if (authForm) {
        authForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const userId = userIdInput.value.trim();
            const password = document.getElementById('password').value.trim();
            const name = userNameInput ? userNameInput.value.trim() : '';
            
            if (isRegisterMode) {
                // 新規登録モード
                try {
                    const res = await fetch('/api/register', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ username: userId, password: password, name: name, role: currentRole })
                    });
                    const data = await res.json();
                    
                    if (res.ok || data.success) {
                        alert(`🎉 アカウント作成成功！\n\nあなたのIDは「 ${userId} 」です。\n（忘れてもマイページで確認できます）`);
                        window.location.href = currentRole === 'admin' ? '/admin/index.html' : '/staff/index.html';
                    } else {
                        alert(data.error || data.message || '登録に失敗しました。');
                    }
                } catch (error) {
                    alert('通信エラーが発生しました');
                }
            } else {
                // ログインモード
                try {
                    const res = await fetch('/api/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ userId, password, role: currentRole })
                    });
                    const data = await res.json();
                    
                    if (res.ok || data.success) {
                        window.location.href = currentRole === 'admin' ? '/admin/index.html' : '/staff/index.html';
                    } else {
                        alert(data.message || 'IDかパスワードが違います');
                    }
                } catch (error) {
                    alert('通信エラーが発生しました');
                }
            }
        });
    }
});