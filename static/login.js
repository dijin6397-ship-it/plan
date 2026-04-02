let captchaToken = null;

function setMsg(text) {
    const el = document.getElementById('loginMsg');
    if (el) el.textContent = text || '';
}

async function loadCaptcha() {
    setMsg('');
    const box = document.getElementById('captchaBox');
    if (box) box.innerHTML = '';
    captchaToken = null;
    try {
        const res = await fetch('/api/captcha', { cache: 'no-store' });
        if (!res.ok) {
            setMsg('获取验证码失败，请刷新页面重试。');
            return;
        }
        const data = await res.json();
        captchaToken = data.token;
        if (box && data.svg) box.innerHTML = data.svg;
    } catch (e) {
        setMsg('获取验证码失败，请检查网络后重试。');
    }
}

async function doLogin() {
    setMsg('');
    const username = (document.getElementById('username')?.value || '').trim();
    const password = document.getElementById('password')?.value || '';
    const captchaAnswer = (document.getElementById('captchaAnswer')?.value || '').trim();

    if (!username || !password || !captchaAnswer) {
        setMsg('请填写用户名、密码和验证码。');
        return;
    }
    if (!captchaToken) {
        setMsg('验证码未加载，请刷新验证码。');
        return;
    }

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, captchaToken, captchaAnswer })
        });
        if (res.status === 503) {
            setMsg('管理员账号未初始化，请在 Vercel 设置 ADMIN_PASSWORD 后重试。');
            return;
        }
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            if (data.error === 'captcha') {
                setMsg('验证码错误，请重试。');
            } else {
                setMsg('用户名或密码错误。');
            }
            await loadCaptcha();
            return;
        }
        location.href = '/';
    } catch (e) {
        setMsg('登录失败，请稍后重试。');
    }
}

document.addEventListener('DOMContentLoaded', function() {
    loadCaptcha();
    const refreshBtn = document.getElementById('refreshCaptchaBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', loadCaptcha);
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) loginBtn.addEventListener('click', doLogin);

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') doLogin();
    });
});

