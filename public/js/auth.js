/**
 * 認証ユーティリティ
 */

async function checkSession() {
  const res = await fetch('/api/mesession');
  const data = await res.json();
  if (!data.loggedIn) {
    window.location.href = '/';
    return null;
  }
  return data;
}

async function logout() {
  await fetch('/api/melogout', { method: 'POST' });
  window.location.href = '/';
}

function requireAdmin(session) {
  if (session?.role !== 'admin') {
    window.location.href = '/';
    return false;
  }
  return true;
}

function requireStaff(session) {
  if (session?.role !== 'staff') {
    window.location.href = '/';
    return false;
  }
  return true;
}
