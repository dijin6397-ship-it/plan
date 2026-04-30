function setAdminMsg(text) {
    const el = document.getElementById('adminMsg');
    if (el) el.textContent = text || '';
}

function formatAdminError(err) {
    const e = (err || '').toString();
    if (e === 'auth_storage_not_configured') return '未配置用户存储（需要配置 POSTGRES_URL 或 KV_REST_API_*）';
    if (e === 'auth_db_error') return '用户数据库不可用（Postgres 连接失败/表异常）';
    return e;
}

async function ensureAdmin() {
    const res = await fetch('/api/me', { cache: 'no-store', credentials: 'same-origin' });
    if (res.status === 401) {
        location.href = '/login.html';
        return null;
    }
    if (!res.ok) {
        location.href = '/login.html';
        return null;
    }
    const me = await res.json();
    const perms = me && Array.isArray(me.permissions) ? me.permissions : [];
    if (!me || !(me.username === 'admin' || me.role === 'admin' || perms.includes('admin'))) {
        location.href = '/';
        return null;
    }
    return me;
}

function renderUsers(users) {
    const tbody = document.getElementById('usersTbody');
    if (!tbody) return;
    tbody.innerHTML = (users || []).map(u => {
        const perms = Array.isArray(u.permissions) ? u.permissions.join(', ') : '';
        const activeChecked = u.active ? 'checked' : '';
        const lockAdmin = u.username === 'admin';
        const disableDelete = lockAdmin ? 'disabled' : '';
        const disableAdminEdits = lockAdmin ? 'disabled' : '';
        return `
            <tr>
                <td>${u.username || ''}</td>
                <td>
                    <select data-username="${u.username}" data-field="role" ${disableAdminEdits}>
                        <option value="user" ${u.role === 'user' ? 'selected' : ''}>用户</option>
                        <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>管理员</option>
                    </select>
                </td>
                <td style="max-width: 300px;">
                    <div style="display:flex; flex-wrap: wrap; gap:6px; font-size: 0.85rem;">
                        <label style="display:flex; align-items:center; gap:4px;">
                            <input type="checkbox" data-username="${u.username}" data-field="perm" value="data:view" ${Array.isArray(u.permissions) && u.permissions.includes('data:view') ? 'checked' : ''} ${disableAdminEdits}>
                            <span>结构数据查看</span>
                        </label>
                        <label style="display:flex; align-items:center; gap:4px;">
                            <input type="checkbox" data-username="${u.username}" data-field="perm" value="data:edit" ${Array.isArray(u.permissions) && u.permissions.includes('data:edit') ? 'checked' : ''} ${disableAdminEdits}>
                            <span>结构数据操作</span>
                        </label>
                        <label style="display:flex; align-items:center; gap:4px;">
                            <input type="checkbox" data-username="${u.username}" data-field="perm" value="schedule:edit" ${Array.isArray(u.permissions) && u.permissions.includes('schedule:edit') ? 'checked' : ''} ${disableAdminEdits}>
                            <span>排程设置操作</span>
                        </label>
                        <label style="display:flex; align-items:center; gap:4px;">
                            <input type="checkbox" data-username="${u.username}" data-field="perm" value="plan:view" ${Array.isArray(u.permissions) && u.permissions.includes('plan:view') ? 'checked' : ''} ${disableAdminEdits}>
                            <span>计划排程查看</span>
                        </label>
                        <label style="display:flex; align-items:center; gap:4px;">
                            <input type="checkbox" data-username="${u.username}" data-field="perm" value="plan:edit" ${Array.isArray(u.permissions) && u.permissions.includes('plan:edit') ? 'checked' : ''} ${disableAdminEdits}>
                            <span>计划排程操作</span>
                        </label>
                        <label style="display:flex; align-items:center; gap:4px;">
                            <input type="checkbox" data-username="${u.username}" data-field="perm" value="plan:export" ${Array.isArray(u.permissions) && u.permissions.includes('plan:export') ? 'checked' : ''} ${disableAdminEdits}>
                            <span>计划排程导出</span>
                        </label>
                        <label style="display:flex; align-items:center; gap:4px;">
                            <input type="checkbox" data-username="${u.username}" data-field="perm" value="details:view" ${Array.isArray(u.permissions) && u.permissions.includes('details:view') ? 'checked' : ''} ${disableAdminEdits}>
                            <span>明细清单查询</span>
                        </label>
                        <label style="display:flex; align-items:center; gap:4px;">
                            <input type="checkbox" data-username="${u.username}" data-field="perm" value="details:export" ${Array.isArray(u.permissions) && u.permissions.includes('details:export') ? 'checked' : ''} ${disableAdminEdits}>
                            <span>明细清单导出</span>
                        </label>
                    </div>
                </td>
                <td>
                    <input type="checkbox" data-username="${u.username}" data-field="active" ${activeChecked} ${disableAdminEdits}>
                </td>
                <td>
                    <button class="btn btn-sm btn-secondary" data-action="resetPassword" data-username="${u.username}">重置密码</button>
                    <button class="btn btn-sm btn-danger" data-action="deleteUser" data-username="${u.username}" ${disableDelete}>删除</button>
                </td>
            </tr>
        `;
    }).join('');
}

async function loadUsers() {
    const res = await fetch('/api/users', { cache: 'no-store', credentials: 'same-origin' });
    if (res.status === 401) {
        location.href = '/login.html';
        return;
    }
    if (res.status === 403) {
        location.href = '/';
        return;
    }
    if (!res.ok) {
        setAdminMsg('加载账号列表失败。');
        return;
    }
    const data = await res.json();
    renderUsers(data.users || []);
}

function readNewUserPayload() {
    const username = (document.getElementById('newUsername')?.value || '').trim();
    const password = document.getElementById('newPassword')?.value || '';
    const role = document.getElementById('newRole')?.value || 'user';
    const permissions = [];
    if (document.getElementById('permDataView')?.checked) permissions.push('data:view');
    if (document.getElementById('permDataEdit')?.checked) permissions.push('data:edit');
    if (document.getElementById('permScheduleEdit')?.checked) permissions.push('schedule:edit');
    if (document.getElementById('permPlanView')?.checked) permissions.push('plan:view');
    if (document.getElementById('permPlanEdit')?.checked) permissions.push('plan:edit');
    if (document.getElementById('permPlanExport')?.checked) permissions.push('plan:export');
    if (document.getElementById('permDetailsView')?.checked) permissions.push('details:view');
    if (document.getElementById('permDetailsExport')?.checked) permissions.push('details:export');
    return { username, password, role, permissions, active: true };
}

async function createUser() {
    setAdminMsg('');
    const payload = readNewUserPayload();
    if (!payload.username || !payload.password) {
        setAdminMsg('请输入用户名和密码。');
        return;
    }
    const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setAdminMsg(data.error ? `创建失败：${formatAdminError(data.error)}` : '创建失败。');
        return;
    }
    document.getElementById('newUsername').value = '';
    document.getElementById('newPassword').value = '';
    await loadUsers();
}

async function updateUser(username, payload) {
    setAdminMsg('');
    const res = await fetch(`/api/users/${encodeURIComponent(username)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setAdminMsg(data.error ? `更新失败：${formatAdminError(data.error)}` : '更新失败。');
        return false;
    }
    return true;
}

async function deleteUser(username) {
    if (!confirm(`确定要删除账号 "${username}" 吗？`)) return;
    setAdminMsg('');
    let res = await fetch('/api/users/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username })
    });
    if (res.status === 404 || res.status === 405) {
        res = await fetch(`/api/users/${encodeURIComponent(username)}`, { method: 'DELETE', credentials: 'same-origin' });
    }
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setAdminMsg(data.error ? `删除失败：${formatAdminError(data.error)}` : '删除失败。');
        return;
    }
    await loadUsers();
}

async function resetPassword(username) {
    const pwd = prompt(`请输入 "${username}" 的新密码：`);
    if (!pwd) return;
    const ok = await updateUser(username, { password: pwd });
    if (ok) setAdminMsg('密码已更新。');
}

function extractPermissionsFromRow(row) {
    const perms = [];
    const checkboxes = row.querySelectorAll('input[data-field="perm"]');
    checkboxes.forEach(cb => {
        if (cb.checked) perms.push(cb.value);
    });
    return perms;
}

document.addEventListener('DOMContentLoaded', async function() {
    const me = await ensureAdmin();
    if (!me) return;

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async function() {
            try {
                await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
            } catch (e) {}
            location.href = '/login.html';
        });
    }

    const createBtn = document.getElementById('createUserBtn');
    if (createBtn) createBtn.addEventListener('click', createUser);

    const tbody = document.getElementById('usersTbody');
    if (tbody) {
        tbody.addEventListener('change', async function(e) {
            const target = e.target;
            const username = target?.getAttribute('data-username');
            const field = target?.getAttribute('data-field');
            if (!username || !field) return;
            const row = target.closest('tr');
            if (!row) return;
            if (username === 'admin' && (field === 'role' || field === 'active' || field === 'perm')) {
                await loadUsers();
                return;
            }

            if (field === 'role') {
                await updateUser(username, { role: target.value });
                await loadUsers();
                return;
            }
            if (field === 'active') {
                await updateUser(username, { active: target.checked });
                await loadUsers();
                return;
            }
            if (field === 'perm') {
                const permissions = extractPermissionsFromRow(row);
                await updateUser(username, { permissions });
                await loadUsers();
                return;
            }
        });

        tbody.addEventListener('click', async function(e) {
            const target = e.target;
            const action = target?.getAttribute('data-action');
            const username = target?.getAttribute('data-username');
            if (!action || !username) return;
            if (action === 'deleteUser') await deleteUser(username);
            if (action === 'resetPassword') await resetPassword(username);
        });
    }

    await loadUsers();
});
