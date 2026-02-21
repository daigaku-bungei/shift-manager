// ページが開かれた瞬間に実行される
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // すでに裏側にある「自分の情報を教えて！」というAPIを叩く
        const response = await fetch('/api/me');
        
        // ログインしていなかったらエラーにする
        if (!response.ok) {
            throw new Error('未ログイン状態です');
        }

        const user = await response.json();

        // 取得したデータをHTMLの該当箇所に当てはめる
        document.getElementById('myName').textContent = user.name + ' さん';
        document.getElementById('myUsername').textContent = user.username;
        
        // 権限を日本語に変換して表示
        const roleText = user.role === 'admin' ? '管理者 (店長)' : 'スタッフ';
        document.getElementById('myRole').textContent = roleText;

    } catch (error) {
        console.error('情報の取得に失敗しました:', error);
        alert('セッションが切れています。もう一度ログインしてください。');
        window.location.href = '/login.html'; // ログイン画面に強制送還
    }
});