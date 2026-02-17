/**
 * ログインページ
 */

document.addEventListener('DOMContentLoaded', async () => {
  const sessionRes = await fetch('/api/session');
  const session = await sessionRes.json();
  if (session.loggedIn) {
    window.location.href = session.role === 'admin' ? '/admin/' : '/staff/';
    return;
  }

  const roleToggle = document.querySelectorAll('.login-role-toggle .btn');
  const form = document.getElementById('loginForm');
  const userId = document.getElementById('userId');
  const password = document.getElementById('password');

  let currentRole = 'admin';

  roleToggle.forEach(btn => {
    btn.addEventListener('click', () => {
      roleToggle.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRole = btn.dataset.role;
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId.value.trim(),
          password: password.value,
          role: currentRole
        })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'ログインに失敗しました');
        return;
      }
      if (data.role === 'admin') {
        window.location.href = '/admin/';
      } else {
        window.location.href = '/staff/';
      }
    } catch (err) {
      alert('通信エラーが発生しました');
    }
  });
});
