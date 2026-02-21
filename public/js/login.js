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
    const userIdInput = document.getElementById('userId');
    const userIdGroup = document.getElementById('userId-group');

    // ▼ タブ切り替え
    if (tabLogin && tabRegister) {
        tabLogin.addEventListener('click', () => {
            isRegisterMode = false;
            tabLogin.classList.add('active');
            tabRegister.classList.remove('active');
            nameGroup.style.display = 'none';
            userNameInput.required = false;
            submitBtn.textContent = 'ログイン';
            if (userIdGroup) userIdGroup.style.display = 'block';
            if (userIdInput) userIdInput.required = true;
        });

        tabRegister.addEventListener('click', () => {
            isRegisterMode = true;
            tabRegister.classList.add('active');
            tabLogin.classList.remove('active');
            nameGroup.style.display = 'block';
            userNameInput.required = true;
            submitBtn.textContent = 'アカウントを作成してログイン';
            if (userIdGroup) userIdGroup.style.display = 'none';
            if (userIdInput) userIdInput.required = false;
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
                // 新規登録モード (Auto-generate ID)
                const generatedUserId = 'user_' + Math.random().toString(36).substring(2, 8);
                try {
                    const res = await fetch('/api/register', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ username: generatedUserId, password: password, name: name, role: currentRole })
                    });
                    const data = await res.json();

                    if (res.ok || data.success) {
                        alert(`🎉 アカウント作成成功！\n\nあなたのIDは「 ${generatedUserId} 」です。\n（次回ログイン時等に必要なのでメモしておいてください）`);
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