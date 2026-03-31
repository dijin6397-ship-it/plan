let templateData = []; // 当前正在编辑的模板数据（阶段-SBOP-工单）
let templates = {}; // 已保存的模板集合 {名称: 数据}
let teamDictionary = []; // 班组数据字典
let trainPlans = [];
let currentScheduleData = null;
let ganttChart = null;
let currentViewLevel = 'sbop';
let serverStateRevision = null;
let stateDirty = false;
let statePullInFlight = false;
let statePushInFlight = false;
let statePushTimer = null;
let statePollTimer = null;
let ganttDndBound = false;
let draggedOrderInfo = null;
let currentUser = null;

document.addEventListener('DOMContentLoaded', async function() {
    if (isHttpMode() && !location.pathname.endsWith('/login.html') && !location.pathname.endsWith('login.html')) {
        const ok = await ensureAuthenticated();
        if (!ok) return;
    } else {
        applyPermissions();
    }
    initializeDateTimeInput();
    loadTemplates();
    loadTeams();
    loadTrainPlans();
    setupEventListeners();
    bindGanttOrderDragDrop();
    startStateSync();
});

function isHttpMode() {
    return location.protocol === 'http:' || location.protocol === 'https:';
}

function hasPermission(perm) {
    if (!isHttpMode()) return true;
    if (!currentUser) return false;
    if (currentUser.role === 'admin') return true;
    const perms = Array.isArray(currentUser.permissions) ? currentUser.permissions : [];
    if (perms.includes('admin')) return true;
    if (perms.includes('state:write')) return true; // legacy support
    return perms.includes(perm);
}

function canWriteState() {
    // For general state writing (like pushing state to server), we allow if they have any edit permission
    if (!isHttpMode()) return true;
    if (!currentUser) return false;
    if (currentUser.role === 'admin') return true;
    const perms = Array.isArray(currentUser.permissions) ? currentUser.permissions : [];
    return perms.includes('state:write') || perms.includes('data:edit') || perms.includes('schedule:edit') || perms.includes('plan:edit');
}

async function ensureAuthenticated() {
    try {
        const res = await fetch('/api/me', { cache: 'no-store' });
        if (res.status === 401) {
            location.href = '/login.html';
            return false;
        }
        if (!res.ok) {
            currentUser = null;
            updateUserBar();
            applyPermissions();
            return true;
        }
        currentUser = await res.json();
        updateUserBar();
        applyPermissions();
        return true;
    } catch (e) {
        currentUser = null;
        updateUserBar();
        applyPermissions();
        return true;
    }
}

function updateUserBar() {
    const el = document.getElementById('userInfo');
    const actionsContainer = document.querySelector('.header-actions') || (el ? el.parentElement : null);
    let btn = document.getElementById('logoutBtn');
    let adminLink = document.getElementById('adminLink');
    if (el) {
        if (currentUser && currentUser.username) {
            el.textContent = `当前账号：${currentUser.username}`;
        } else {
            el.textContent = '';
        }
    }
    if (!btn && actionsContainer) {
        btn = document.createElement('button');
        btn.id = 'logoutBtn';
        btn.className = 'btn btn-sm';
        btn.type = 'button';
        btn.textContent = '退出登录';
        btn.style.display = 'none';
        actionsContainer.appendChild(btn);
    }
    if (btn) {
        btn.style.display = currentUser ? 'inline-flex' : 'none';
    }
    if (!adminLink && actionsContainer) {
        adminLink = document.createElement('a');
        adminLink.id = 'adminLink';
        adminLink.className = 'btn btn-sm btn-secondary';
        adminLink.href = 'admin.html';
        adminLink.textContent = '账号及权限';
        adminLink.style.display = 'none';
        if (btn && btn.parentElement === actionsContainer) {
            actionsContainer.insertBefore(adminLink, btn);
        } else {
            actionsContainer.appendChild(adminLink);
        }
    }
    if (adminLink) {
        const perms = currentUser && Array.isArray(currentUser.permissions) ? currentUser.permissions : [];
        const isAdmin = currentUser && (currentUser.username === 'admin' || currentUser.role === 'admin' || perms.includes('admin'));
        adminLink.style.display = isAdmin ? 'inline-flex' : 'none';
    }
}

function applyPermissions() {
    const permDataView = hasPermission('data:view');
    const permDataEdit = hasPermission('data:edit');
    const permScheduleEdit = hasPermission('schedule:edit');
    const permPlanView = hasPermission('plan:view');
    const permPlanEdit = hasPermission('plan:edit');
    const permPlanExport = hasPermission('plan:export');
    const permDetailsView = hasPermission('details:view');
    const permDetailsExport = hasPermission('details:export');

    // Tabs visibility
    const dataTabBtn = document.querySelector('button[data-tab="data"]');
    if (dataTabBtn) dataTabBtn.style.display = permDataView ? 'inline-block' : 'none';
    const dataTab = document.getElementById('dataTab');
    if (dataTab && !permDataView) {
        dataTab.classList.remove('active');
        if (dataTabBtn) dataTabBtn.classList.remove('active');
    }

    const ganttTabBtn = document.querySelector('button[data-tab="gantt"]');
    if (ganttTabBtn) ganttTabBtn.style.display = (permPlanView || permDetailsView) ? 'inline-block' : 'none';
    if (ganttTabBtn && !permPlanView && !permDetailsView) {
        ganttTabBtn.classList.remove('active');
        const ganttTab = document.getElementById('ganttTab');
        if (ganttTab) ganttTab.classList.remove('active');
    }

    // Auto-select first available tab if current is hidden
    if (ganttTabBtn && dataTabBtn) {
        if (!ganttTabBtn.classList.contains('active') && !dataTabBtn.classList.contains('active')) {
            if (permPlanView || permDetailsView) {
                ganttTabBtn.classList.add('active');
                if (document.getElementById('ganttTab')) document.getElementById('ganttTab').classList.add('active');
            } else if (permDataView) {
                dataTabBtn.classList.add('active');
                if (document.getElementById('dataTab')) document.getElementById('dataTab').classList.add('active');
            }
        }
    }

    // data:edit elements
    const dataEditIds = ['saveTemplateBtn', 'importTemplateBtn', 'deleteTemplateBtn', 'addPhaseBtn', 'addTeamBtn'];
    dataEditIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.disabled = !permDataEdit;
        if (!permDataEdit) el.classList.add('disabled');
        else el.classList.remove('disabled');
    });
    const newTeamName = document.getElementById('newTeamName');
    if (newTeamName) newTeamName.disabled = !permDataEdit;

    // schedule:edit elements
    const scheduleEditIds = ['trainNumberInput', 'templateSelect', 'startTime', 'scheduleBtn', 'clearScheduleBtn'];
    scheduleEditIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.disabled = !permScheduleEdit;
        if (!permScheduleEdit) el.classList.add('disabled');
        else el.classList.remove('disabled');
    });

    // plan:view elements
    const ganttTopSection = document.getElementById('ganttTopSection');
    if (ganttTopSection) ganttTopSection.style.display = permPlanView ? 'block' : 'none';

    // plan:export elements
    const exportGanttBtn = document.getElementById('exportGanttBtn');
    if (exportGanttBtn) {
        exportGanttBtn.disabled = !permPlanExport;
        if (!permPlanExport) exportGanttBtn.style.display = 'none';
        else exportGanttBtn.style.display = 'inline-block';
    }

    // details:view elements
    const detailsSection = document.getElementById('detailsSection');
    if (detailsSection) detailsSection.style.display = permDetailsView ? 'block' : 'none';

    // details:export elements
    const exportDetailsBtn = document.getElementById('exportDetailsBtn');
    if (exportDetailsBtn) {
        exportDetailsBtn.disabled = !permDetailsExport;
        if (!permDetailsExport) exportDetailsBtn.style.display = 'none';
        else exportDetailsBtn.style.display = 'inline-block';
    }

    // For re-rendering components that check permissions inside their render functions
    if (typeof renderTeamList === 'function') renderTeamList();
    if (typeof renderDataTree === 'function') renderDataTree();
    if (typeof renderTrainPlanList === 'function') renderTrainPlanList();
    if (typeof renderScheduleFromPlans === 'function' && (ganttChart || document.getElementById('ganttTree')?.innerHTML)) {
        renderScheduleFromPlans();
    }
}

function isEditingLocked() {
    const modal = document.getElementById('modal');
    return modal && modal.style.display === 'block';
}

function markStateDirty(immediate = false) {
    if (isHttpMode() && !canWriteState()) {
        alert(currentUser ? '当前账号无编辑权限。' : '请先登录。');
        if (!currentUser) {
            location.href = '/login.html';
        } else {
            pullStateFromServer({ force: true });
        }
        return;
    }
    stateDirty = true;
    if (immediate) {
        if (statePushTimer) clearTimeout(statePushTimer);
        pushStateToServer();
    } else {
        scheduleStatePush();
    }
}

function scheduleStatePush() {
    if (!isHttpMode()) return;
    if (statePushTimer) clearTimeout(statePushTimer);
    statePushTimer = setTimeout(() => {
        pushStateToServer();
    }, 600);
}

async function pullStateFromServer(options = {}) {
    if (!isHttpMode()) return;
    if (statePullInFlight) return;
    if (isEditingLocked() && options.force !== true) return;
    statePullInFlight = true;
    try {
        const res = await fetch('/api/state', { cache: 'no-store' });
        if (res.status === 401) {
            location.href = '/login.html';
            return;
        }
        if (!res.ok) return;
        const state = await res.json();
        const nextRevision = typeof state.revision === 'number' ? state.revision : null;
        if (serverStateRevision !== null && nextRevision !== null && nextRevision === serverStateRevision) return;
        if (stateDirty && options.force !== true) return;

        if (state && typeof state.templates === 'object' && state.templates) {
            templates = state.templates;
            localStorage.setItem('schedulingTemplates', JSON.stringify(templates));
            updateTemplateSelects();
        }
        if (state && Array.isArray(state.teams)) {
            teamDictionary = state.teams;
            localStorage.setItem('schedulingTeamsList', JSON.stringify(teamDictionary));
            renderTeamList();
        }
        if (state && Array.isArray(state.trainPlans)) {
            trainPlans = state.trainPlans;
            localStorage.setItem('schedulingTrainPlans', JSON.stringify(trainPlans));
            renderTrainPlanList();
            updateTrainNumberFilter();
            renderScheduleFromPlans();
        }

        serverStateRevision = nextRevision;
        stateDirty = false;
    } finally {
        statePullInFlight = false;
    }
}

async function pushStateToServer() {
    if (!isHttpMode()) return;
    if (!stateDirty) return;
    if (statePushInFlight) return;
    statePushInFlight = true;
    try {
        const payload = {
            revision: serverStateRevision,
            templates,
            teams: teamDictionary,
            trainPlans
        };
        const res = await fetch('/api/state', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.status === 401) {
            location.href = '/login.html';
            return;
        }
        if (res.status === 403) {
            stateDirty = false;
            alert('当前账号无编辑权限。');
            await pullStateFromServer({ force: true });
            return;
        }
        if (res.status === 409) {
            stateDirty = false;
            await pullStateFromServer({ force: true });
            alert('检测到其他用户已更新数据，本地已自动刷新。请重新执行你的保存/操作。');
            return;
        }
        if (!res.ok) return;
        const state = await res.json();
        serverStateRevision = typeof state.revision === 'number' ? state.revision : serverStateRevision;
        stateDirty = false;
    } finally {
        statePushInFlight = false;
    }
}

function startStateSync() {
    if (!isHttpMode()) return;
    if (statePollTimer) return;
    pullStateFromServer({ force: true });
    statePollTimer = setInterval(() => {
        pullStateFromServer();
    }, 5000);
}

function loadTeams() {
    const savedTeams = localStorage.getItem('schedulingTeamsList');
    if (savedTeams) {
        teamDictionary = JSON.parse(savedTeams);
    }
    renderTeamList();
}

function loadTrainPlans() {
    const saved = localStorage.getItem('schedulingTrainPlans');
    if (saved) {
        trainPlans = JSON.parse(saved);
    }
    renderTrainPlanList();
    updateTrainNumberFilter();
    renderScheduleFromPlans();
}

function saveTrainPlans() {
    localStorage.setItem('schedulingTrainPlans', JSON.stringify(trainPlans));
    renderTrainPlanList();
    updateTrainNumberFilter();
    markStateDirty();
}

function addOrUpdateTrainPlan(trainNumber, templateName, startTimeStr) {
    const number = (trainNumber || '').trim();
    const tpl = (templateName || '').trim();
    const start = (startTimeStr || '').trim();
    if (!number || !tpl || !start) return;

    const existing = trainPlans.find(p => p && p.number === number);
    const orderOverrides = existing && existing.orderOverrides ? existing.orderOverrides : {};
    trainPlans = trainPlans.filter(p => p && p.number !== number);
    trainPlans.push({ number, templateName: tpl, startTime: start, orderOverrides });
    trainPlans.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    trainPlans = trainPlans.slice(0, 50);
    saveTrainPlans();
}

function removeTrainPlan(trainNumber) {
    const number = (trainNumber || '').trim();
    if (!number) return;
    trainPlans = trainPlans.filter(p => p && p.number !== number);
    saveTrainPlans();
    renderScheduleFromPlans();
}

function clearTrainPlans() {
    trainPlans = [];
    saveTrainPlans();
    currentScheduleData = null;
    renderEmptyGantt();
    resetFilters();
}

function updateTrainNumberFilter() {
    const select = document.getElementById('trainNumberFilter');
    if (!select) return;

    const currentVal = select.value;
    select.innerHTML = '<option value="all">全部列车</option>';
    trainPlans.forEach(p => {
        const option = document.createElement('option');
        option.value = p.number;
        option.textContent = p.number;
        select.appendChild(option);
    });

    if (currentVal && (currentVal === 'all' || trainPlans.some(p => p.number === currentVal))) {
        select.value = currentVal;
    } else {
        select.value = 'all';
    }
}

function renderTrainPlanList() {
    const container = document.getElementById('trainPlanList');
    if (!container) return;
    if (!trainPlans || trainPlans.length === 0) {
        container.innerHTML = '<div class="train-plan-subtitle">暂无列车排程</div>';
        return;
    }

    const canEdit = hasPermission('plan:edit');

    container.innerHTML = trainPlans.map(p => `
        <div class="train-plan-item">
            <div class="train-plan-meta" onclick="selectTrainPlan('${p.number}')">
                <div class="train-plan-title">列车号 ${p.number}</div>
                <div class="train-plan-subtitle">${p.startTime}｜${p.templateName}</div>
            </div>
            <button class="train-plan-remove" style="${canEdit ? '' : 'display:none;'}" onclick="removeTrainPlan('${p.number}')">&times;</button>
        </div>
    `).join('');
}

function selectTrainPlan(trainNumber) {
    const plan = trainPlans.find(p => p && p.number === trainNumber);
    if (!plan) return;

    const input = document.getElementById('trainNumberInput');
    if (input) input.value = plan.number;

    const templateSelect = document.getElementById('templateSelect');
    if (templateSelect) templateSelect.value = plan.templateName;

    const startTimeInput = document.getElementById('startTime');
    if (startTimeInput) startTimeInput.value = plan.startTime;

    const trainNumberFilter = document.getElementById('trainNumberFilter');
    if (trainNumberFilter) trainNumberFilter.value = plan.number;
}

function buildMultiTrainSchedule() {
    const trains = [];
    let globalStart = null;
    let globalEnd = null;

    trainPlans.forEach(plan => {
        const template = templates[plan.templateName];
        if (!template) return;

        const startDate = new Date(plan.startTime);
        startDate.setHours(8, 0, 0, 0);
        const schedule = calculateTaktSchedule(plan.number, template, startDate, plan.orderOverrides || {});
        if (!schedule || !schedule.trains || schedule.trains.length === 0) return;

        const train = schedule.trains[0];
        trains.push(train);

        const start = new Date(train.start_time);
        const end = new Date(train.end_time);
        if (!globalStart || start < globalStart) globalStart = start;
        if (!globalEnd || end > globalEnd) globalEnd = end;
    });

    if (trains.length === 0) {
        return null;
    }

    const totalDuration = globalStart && globalEnd ? (globalEnd - globalStart) / (1000 * 60 * 60) : 0;
    return {
        trains,
        totalStartTime: globalStart,
        totalEndTime: globalEnd,
        totalDuration
    };
}

function renderEmptyGantt() {
    const tree = document.getElementById('ganttTree');
    if (tree) {
        tree.innerHTML = `
            <div class="empty-state">
                <h3>暂无排程数据</h3>
                <p>请先添加列车排程</p>
            </div>
        `;
    }
    const info = document.getElementById('ganttInfo');
    if (info) info.innerHTML = '';
}

function renderScheduleFromPlans() {
    if (!trainPlans || trainPlans.length === 0) {
        currentScheduleData = null;
        renderEmptyGantt();
        return;
    }

    const scheduleData = buildMultiTrainSchedule();
    if (!scheduleData) {
        currentScheduleData = null;
        renderEmptyGantt();
        return;
    }

    currentScheduleData = scheduleData;
    renderGanttTree(scheduleData);
}

function saveTeams() {
    localStorage.setItem('schedulingTeamsList', JSON.stringify(teamDictionary));
    renderTeamList();
    markStateDirty(true);
}

function addTeam() {
    const input = document.getElementById('newTeamName');
    const name = input.value.trim();
    if (name && !teamDictionary.includes(name)) {
        teamDictionary.push(name);
        input.value = '';
        saveTeams();
    } else if (teamDictionary.includes(name)) {
        alert('该班组已存在！');
    }
}

function deleteTeam(name) {
    if (confirm(`确定要删除班组 "${name}" 吗？`)) {
        teamDictionary = teamDictionary.filter(t => t !== name);
        saveTeams();
    }
}

function renderTeamList() {
    const list = document.getElementById('teamList');
    if (!list) return;
    const canEdit = hasPermission('data:edit');
    list.innerHTML = teamDictionary.map(team => `
        <div class="team-tag">
            <span>${team}</span>
            <button ${canEdit ? '' : 'style="display:none;"'} onclick="deleteTeam('${team}')">&times;</button>
        </div>
    `).join('');
}

function initializeDateTimeInput() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    document.getElementById('startTime').value = `${year}-${month}-${day}`;
}

function setupEventListeners() {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async function() {
            try {
                await fetch('/api/logout', { method: 'POST' });
            } catch (e) {}
            location.href = '/login.html';
        });
    }
    document.getElementById('scheduleBtn').addEventListener('click', generateSchedule);
    const clearScheduleBtn = document.getElementById('clearScheduleBtn');
    if (clearScheduleBtn) {
        clearScheduleBtn.addEventListener('click', function() {
            if (confirm('确定要清空所有列车排程吗？此操作不可恢复！')) {
                clearTrainPlans();
            }
        });
    }
    
    // 模板管理相关
    document.getElementById('saveTemplateBtn').addEventListener('click', saveCurrentAsTemplate);
    document.getElementById('deleteTemplateBtn').addEventListener('click', deleteSelectedTemplate);
    document.getElementById('downloadTemplateBtn').addEventListener('click', downloadTemplateAsExcel);
    document.getElementById('addPhaseBtn').addEventListener('click', () => showAddPhaseModal());
    
    // 首页模板选择
    document.getElementById('templateSelect').addEventListener('change', function() {
        const templateName = this.value;
        if (templateName && templates[templateName]) {
            // 仅用于排程，不改变当前编辑数据
        }
    });

    const trainNumberFilter = document.getElementById('trainNumberFilter');
    if (trainNumberFilter) {
        trainNumberFilter.addEventListener('change', function() {
            const selected = this.value;
            if (selected && selected !== 'all') {
                selectTrainPlan(selected);
            }
        });
    }

    // 结构化数据管理页面模板选择
    document.getElementById('editTemplateSelect').addEventListener('change', function() {
        const templateName = this.value;
        if (templateName && templates[templateName]) {
            templateData = JSON.parse(JSON.stringify(templates[templateName]));
            document.getElementById('templateName').value = templateName;
            renderDataTree();
        } else {
            templateData = [];
            document.getElementById('templateName').value = '';
            renderDataTree();
        }
    });
    
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            const tabId = this.dataset.tab;
            document.getElementById(tabId + 'Tab').classList.add('active');
            
            // 处理侧边栏显示/隐藏
            const sidebar = document.querySelector('.sidebar');
            if (tabId === 'data') {
                sidebar.style.display = 'none';
            } else {
                sidebar.style.display = 'block';
            }
        });
    });
    
    document.querySelector('.close').addEventListener('click', closeModal);
    window.addEventListener('click', function(e) {
        if (e.target === document.getElementById('modal')) {
            closeModal();
        }
    });
}

function loadTemplates() {
    const saved = localStorage.getItem('schedulingTemplates');
    if (saved) {
        templates = JSON.parse(saved);
    }
    updateTemplateSelects();
    
    // 默认加载第一个模板（如果存在）
    const templateNames = Object.keys(templates);
    if (templateNames.length > 0) {
        templateData = JSON.parse(JSON.stringify(templates[templateNames[0]]));
        document.getElementById('templateName').value = templateNames[0];
        const editSelect = document.getElementById('editTemplateSelect');
        if (editSelect) editSelect.value = templateNames[0];
    }
    renderDataTree();
}

function saveTemplatesToLocal() {
    localStorage.setItem('schedulingTemplates', JSON.stringify(templates));
    updateTemplateSelects();
    markStateDirty(true);
}

function updateTemplateSelects() {
    const selects = [document.getElementById('templateSelect'), document.getElementById('editTemplateSelect')];
    
    selects.forEach(select => {
        if (!select) return;
        const currentVal = select.value;
        select.innerHTML = '<option value="">-- 请选择模板 --</option>';
        
        Object.keys(templates).forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            select.appendChild(option);
        });
        
        if (currentVal && templates[currentVal]) {
            select.value = currentVal;
        }
    });
}

function downloadTemplateAsExcel() {
    if (!templateData || templateData.length === 0) {
        alert('当前没有可导出的模板数据！');
        return;
    }
    
    const excelData = [];
    templateData.forEach(phase => {
        phase.sbops.forEach(sbop => {
            const row = {
                '阶段名称': phase.name,
                '阶段天偏移': phase.startDayOffset || 1,
                'SBOP名称': sbop.name,
                'SBOP天偏移': sbop.startDayOffset || 1,
                'SBOP节拍': sbop.takt || 3,
                'SBOP工时': sbop.totalHours || 0,
                'SBOP人数': sbop.workerCount || 1,
                '班组': sbop.team || ''
            };
            
            // 添加 1#-8# 车工单数量
            for (let i = 1; i <= 8; i++) {
                row[`${i}#车工单数量`] = (sbop.carCounts && sbop.carCounts[i]) ? sbop.carCounts[i] : 0;
            }
            
            excelData.push(row);
        });
    });
    
    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '模板数据');
    
    const name = document.getElementById('templateName').value.trim() || '排程模板';
    XLSX.writeFile(wb, `${name}.xlsx`);
}

function importTemplate(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(sheet);

        if (jsonData.length === 0) {
            alert('Excel 文件内容为空！');
            return;
        }

        const newTemplateData = [];
        const phasesMap = {};

        jsonData.forEach(row => {
            const phaseName = row['阶段名称'];
            if (!phasesMap[phaseName]) {
                phasesMap[phaseName] = {
                    id: Date.now() + Math.random(),
                    name: phaseName,
                    startDayOffset: parseInt(row['阶段天偏移']) || 1,
                    sbops: []
                };
                newTemplateData.push(phasesMap[phaseName]);
            }

            const carCounts = {};
            for (let i = 1; i <= 8; i++) {
                carCounts[i] = parseInt(row[`${i}#车工单数量`]) || 0;
            }

            const totalHours = parseFloat(row['SBOP工时']) || 0;
            const workerCount = parseInt(row['SBOP人数']) || 1;
            const orders = generateOrdersFromCarCounts(carCounts, totalHours, workerCount);

            phasesMap[phaseName].sbops.push({
                id: Date.now() + Math.random(),
                name: row['SBOP名称'],
                startDayOffset: parseInt(row['SBOP天偏移']) || 1,
                takt: parseInt(row['SBOP节拍']) || 3,
                totalHours: totalHours,
                workerCount: workerCount,
                carCounts: carCounts,
                team: row['班组'] || '',
                orders: orders
            });
        });

        templateData = newTemplateData;
        document.getElementById('templateName').value = file.name.replace('.xlsx', '');
        renderDataTree();
        alert('模板导入成功！');
    };
    reader.readAsArrayBuffer(file);
    input.value = ''; // 重置 input 以便下次选择同一文件
}

function exportGanttToExcel() {
    const trainNumber = document.getElementById('trainNumberInput').value.trim();
    const templateName = document.getElementById('templateSelect').value;
    const startTimeStr = document.getElementById('startTime').value;

    if (!trainNumber || !templateName || !startTimeStr) {
        alert('请先生成排程后再导出！');
        return;
    }

    const template = templates[templateName];
    const trainStartDate = new Date(startTimeStr);
    trainStartDate.setHours(8, 0, 0, 0);
    const scheduleData = calculateTaktSchedule(trainNumber, template, trainStartDate);

    const excelData = [];
    scheduleData.trains.forEach(train => {
        train.phases.forEach(phase => {
            phase.sbops.forEach(sbop => {
                sbop.orders.forEach(order => {
                    excelData.push({
                        '列车号': train.number,
                        '检修阶段': phase.name,
                        'SBOP名称': sbop.name,
                        '班组': sbop.team || '-',
                        '工单名称': order.name,
                        '开始时间': formatDateTime(order.start_time),
                        '结束时间': formatDateTime(order.end_time),
                        '工时(小时)': order.duration,
                        '作业人数': order.workerCount
                    });
                });
            });
        });
    });

    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '生产计划排程');
    XLSX.writeFile(wb, `生产计划排程_${trainNumber}_${new Date().toISOString().split('T')[0]}.xlsx`);
}

function saveCurrentAsTemplate() {
    const name = document.getElementById('templateName').value.trim();
    if (!name) {
        alert('请输入模板名称！');
        return;
    }
    
    if (templateData.length === 0) {
        alert('模板数据不能为空！');
        return;
    }
    
    templates[name] = JSON.parse(JSON.stringify(templateData));
    saveTemplatesToLocal();
    alert(`模板 "${name}" 已保存！`);
}

function deleteSelectedTemplate() {
    const editSelect = document.getElementById('editTemplateSelect');
    const homeSelect = document.getElementById('templateSelect');
    const templateNameInput = document.getElementById('templateName');
    const inputName = templateNameInput ? templateNameInput.value.trim() : '';

    const nameFromEdit = editSelect ? editSelect.value : '';
    const nameFromHome = homeSelect ? homeSelect.value : '';
    const name = nameFromEdit || nameFromHome || (inputName && templates[inputName] ? inputName : '');
    
    if (!name) {
        alert('请先选择要删除的模板！');
        return;
    }
    
    if (confirm(`确定要删除模板 "${name}" 吗？`)) {
        delete templates[name];
        saveTemplatesToLocal();
        templateData = [];
        if (templateNameInput) templateNameInput.value = '';
        if (editSelect && editSelect.value === name) editSelect.value = '';
        if (homeSelect && homeSelect.value === name) homeSelect.value = '';
        renderDataTree();
    }
}

function generateSchedule() {
    const trainNumber = document.getElementById('trainNumberInput').value.trim();
    const templateName = document.getElementById('templateSelect').value;
    const startTimeStr = document.getElementById('startTime').value;
    
    if (!trainNumber) {
        alert('请输入列车号！');
        return;
    }
    if (!templateName) {
        alert('请选择数据模板！');
        return;
    }
    if (!startTimeStr) {
        alert('请选择开始作业时间！');
        return;
    }
    
    const template = templates[templateName];
    if (!template) {
        alert('模板不存在！');
        return;
    }

    addOrUpdateTrainPlan(trainNumber, templateName, startTimeStr);
    renderScheduleFromPlans();
    const trainNumberFilter = document.getElementById('trainNumberFilter');
    if (trainNumberFilter) trainNumberFilter.value = 'all';
    
    // 切换到甘特图标签页
    document.querySelectorAll('.tab-btn')[0].click();
}

function calculateTaktSchedule(trainNumber, template, trainStartDate, orderOverrides = {}) {
    const train = {
        number: trainNumber,
        phases: []
    };
    
    let totalMaxDate = new Date(trainStartDate);
    
    template.forEach(phaseTemplate => {
        const phaseStartDate = new Date(trainStartDate);
        phaseStartDate.setDate(phaseStartDate.getDate() + (phaseTemplate.startDayOffset || 1) - 1);
        
        const phase = {
            id: phaseTemplate.id,
            name: phaseTemplate.name,
            start_time: new Date(phaseStartDate),
            end_time: new Date(phaseStartDate),
            sbops: []
        };
        
        phaseTemplate.sbops.forEach(sbopTemplate => {
            const sbopStartDate = new Date(phaseStartDate);
            sbopStartDate.setDate(sbopStartDate.getDate() + (sbopTemplate.startDayOffset || 1) - 1);
            
            // 使用 SBOP 模板中已生成的工单列表，如果没有则尝试从 carCounts 生成（兼容旧数据）
            let allOrders = sbopTemplate.orders || [];
            if (allOrders.length === 0 && sbopTemplate.carCounts) {
                allOrders = generateOrdersFromCarCounts(
                    sbopTemplate.carCounts, 
                    sbopTemplate.totalHours || 8, 
                    sbopTemplate.workerCount || 1
                );
            }
            const takt = sbopTemplate.takt || 3;
            const overrideKey = `${phaseTemplate.id}:${sbopTemplate.id}`;
            const overrideOrderIds = orderOverrides ? orderOverrides[overrideKey] : null;
            if (Array.isArray(overrideOrderIds) && overrideOrderIds.length > 0) {
                const overrideSet = new Set(overrideOrderIds);
                const orderById = new Map(allOrders.map(o => [o.id, o]));
                const reordered = [];
                overrideOrderIds.forEach(id => {
                    const found = orderById.get(id);
                    if (found) reordered.push(found);
                });
                allOrders.forEach(o => {
                    if (!overrideSet.has(o.id)) reordered.push(o);
                });
                allOrders = reordered;
            }

            const durationDays = Math.ceil(allOrders.length / takt) || 1;
            
            const sbop = {
                id: sbopTemplate.id,
                name: sbopTemplate.name,
                team: sbopTemplate.team,
                takt: takt,
                start_time: new Date(sbopStartDate),
                end_time: null,
                orders: []
            };
            
            // 计算SBOP结束时间
            const sbopEndDate = new Date(sbopStartDate);
            sbopEndDate.setDate(sbopEndDate.getDate() + durationDays - 1);
            sbopEndDate.setHours(17, 0, 0, 0);
            sbop.end_time = sbopEndDate;
            
            // 分配工单到每一天
            allOrders.forEach((order, index) => {
                const dayOffset = Math.floor(index / takt);
                const orderStartDate = new Date(sbopStartDate);
                orderStartDate.setDate(orderStartDate.getDate() + dayOffset);
                orderStartDate.setHours(8, 0, 0, 0);
                
                const orderEndDate = new Date(orderStartDate);
                orderEndDate.setHours(17, 0, 0, 0);
                
                sbop.orders.push({
                    ...order,
                    start_time: orderStartDate,
                    end_time: orderEndDate
                });
            });
            
            phase.sbops.push(sbop);
            
            if (sbop.end_time > phase.end_time) {
                phase.end_time = new Date(sbop.end_time);
            }
        });
        
        train.phases.push(phase);
        
        if (phase.end_time > totalMaxDate) {
            totalMaxDate = new Date(phase.end_time);
        }
    });
    
    train.start_time = trainStartDate;
    train.end_time = totalMaxDate;
    
    return {
        trains: [train],
        totalStartTime: trainStartDate,
        totalEndTime: totalMaxDate,
        totalDuration: (totalMaxDate - trainStartDate) / (1000 * 60 * 60)
    };
}

function getNextWorkTime(date) {
    const d = new Date(date);
    const hour = d.getHours();
    
    if (hour >= 12 && hour < 13) {
        d.setHours(13, 0, 0, 0);
    }
    
    if (hour >= 17) {
        d.setDate(d.getDate() + 1);
        d.setHours(8, 0, 0, 0);
    } else if (hour < 8) {
        d.setHours(8, 0, 0, 0);
    }
    
    return d;
}

function addWorkHours(startDate, hours) {
    let current = new Date(startDate);
    let remainingHours = hours;
    
    while (remainingHours > 0) {
        const hour = current.getHours();
        
        if (hour >= 17) {
            current.setDate(current.getDate() + 1);
            current.setHours(8, 0, 0, 0);
            continue;
        }
        
        if (hour < 8) {
            current.setHours(8, 0, 0, 0);
            continue;
        }
        
        if (hour >= 12 && hour < 13) {
            current.setHours(13, 0, 0, 0);
            continue;
        }
        
        let hoursUntilEnd = 17 - hour;
        
        const hoursToAdd = Math.min(remainingHours, hoursUntilEnd);
        current = new Date(current.getTime() + hoursToAdd * 60 * 60 * 1000);
        remainingHours -= hoursToAdd;
        
        if (current.getHours() === 12) {
            current.setHours(13, 0, 0, 0);
        }
    }
    
    return current;
}

function formatDateTime(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDate(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

let ganttZoomLevel = 1;
let ganttScrollPosition = 0;

function renderGanttTree(scheduleData) {
    const tree = document.getElementById('ganttTree');
    
    if (!scheduleData.trains || scheduleData.trains.length === 0) {
        tree.innerHTML = `
            <div class="empty-state">
                <h3>暂无排程数据</h3>
                <p>请先生成排程</p>
            </div>
        `;
        return;
    }
    
    // 更新班组筛选下拉框
    updateTeamFilter(scheduleData);
    
    // 计算实际开始时间（最早的任务开始时间）
    let minTime = Infinity;
    let maxTime = -Infinity;
    
    scheduleData.trains.forEach(train => {
        if (train.phases) {
            train.phases.forEach(phase => {
                if (phase.sbops) {
                    phase.sbops.forEach(sbop => {
                        if (sbop.orders) {
                            sbop.orders.forEach(order => {
                                const startTime = order.start_time.getTime();
                                const endTime = order.end_time.getTime();
                                if (startTime < minTime) minTime = startTime;
                                if (endTime > maxTime) maxTime = endTime;
                            });
                        }
                    });
                }
            });
        }
    });
    
    if (minTime === Infinity) {
        const startTimeStr = document.getElementById('startTime').value;
        const startTime = new Date(startTimeStr);
        minTime = startTime.getTime();
        maxTime = minTime + 8 * 60 * 60 * 1000;
    }
    
    if (maxTime === -Infinity) {
        maxTime = minTime + 8 * 60 * 60 * 1000;
    }
    
    // 按天对齐
    const minDate = new Date(minTime);
    minDate.setHours(0, 0, 0, 0);
    const maxDate = new Date(maxTime);
    maxDate.setHours(0, 0, 0, 0);
    
    const totalDays = Math.round((maxDate - minDate) / (1000 * 60 * 60 * 24)) + 1;
    const totalHours = (maxTime - minTime) / (1000 * 60 * 60);
    const msPerDay = 1000 * 60 * 60 * 24;
    
    const infoDiv = document.getElementById('ganttInfo');
    if (scheduleData.totalStartTime && scheduleData.totalEndTime) {
        infoDiv.innerHTML = `
            总时长: ${scheduleData.totalDuration.toFixed(1)} 小时 | 
            开始: ${formatDateTime(new Date(scheduleData.totalStartTime))} | 
            结束: ${formatDateTime(new Date(scheduleData.totalEndTime))}
        `;
    }
    
    // 颜色配置 - 按照用户要求设置不同层级的颜色
    const colors = {
        train: { bg: '#10b981', text: '#ffffff' },      // 绿色
        phase: { bg: '#3b82f6', text: '#ffffff' },      // 蓝色
        sbop: { bg: '#92400e', text: '#ffffff' },       // 棕色
        order: { bg: '#8b5cf6', text: '#ffffff' }       // 紫色
    };
    
    // 计算图表总宽度（基于缩放级别）
    const baseWidth = Math.max(totalDays * 100, 800);
    const chartWidth = baseWidth * ganttZoomLevel;
    
    // 设置CSS变量以支持背景网格
    tree.style.setProperty('--total-days', totalDays);
    
    let html = `
        <div class="gantt-time-header">
            <div class="time-info"><strong>开始时间:</strong> ${formatDateTime(new Date(minTime))}</div>
            <div class="time-info"><strong>结束时间:</strong> ${formatDateTime(new Date(maxTime))}</div>
            <div class="time-info"><strong>总时长:</strong> ${totalHours.toFixed(1)} 小时 (${totalDays} 天)</div>
        </div>
        <div class="gantt-zoom-controls">
            <button class="btn btn-sm" onclick="zoomGantt(0.8)">缩小</button>
            <span class="zoom-level">${(ganttZoomLevel * 100).toFixed(0)}%</span>
            <button class="btn btn-sm" onclick="zoomGantt(1.25)">放大</button>
            <button class="btn btn-sm" onclick="resetGanttZoom()">重置</button>
        </div>
        <div class="gantt-scroll-container" id="ganttScrollContainer">
            <div class="gantt-chart-wrapper" style="width: ${chartWidth}px;">
                <div class="gantt-time-scale-row">
                    <div class="gantt-time-scale-header">时间轴</div>
                    <div class="gantt-time-scale-line-container">
                        <div class="time-scale-line">
    `;
    
    // 生成时间轴 - 从第1天开始标记，确保从左边排起
    for (let i = 0; i <= totalDays; i++) {
        const dayDate = new Date(minDate);
        dayDate.setDate(dayDate.getDate() + i);
        const dayLabel = `${dayDate.getMonth() + 1}/${dayDate.getDate()}`;
        const isWeekMark = i % 7 === 0;
        const markClass = isWeekMark ? 'week-mark' : 'day-mark';
        
        // 确保从0%开始，均匀分布
        const leftPercent = (i / totalDays) * 100;
        
        html += `
            <div class="time-scale-tick ${markClass}" style="left: ${leftPercent}%">
                <div class="tick-line"></div>
                <div class="tick-label">${dayLabel}${isWeekMark ? ' (第' + (Math.floor(i/7) + 1) + '周)' : ''}</div>
            </div>
        `;
    }
    
    html += `
                        </div>
                    </div>
                </div>
                <div class="gantt-chart-container">
    `;
    
    scheduleData.trains.forEach((train, trainIndex) => {
        const trainPos = {
            left: (Math.round((new Date(train.start_time).setHours(0,0,0,0) - minDate.getTime()) / msPerDay) / totalDays) * 100,
            width: ((Math.round((new Date(train.end_time).setHours(0,0,0,0) - minDate.getTime()) / msPerDay) - Math.round((new Date(train.start_time).setHours(0,0,0,0) - minDate.getTime()) / msPerDay) + 1) / totalDays) * 100,
            days: Math.round((new Date(train.end_time).setHours(0,0,0,0) - new Date(train.start_time).setHours(0,0,0,0)) / msPerDay) + 1
        };
        
        html += `
            <div class="gantt-row gantt-level-1">
                <div class="gantt-row-header" onclick="toggleGanttRow(this)">
                    <div class="gantt-toggle expanded">−</div>
                    <div class="gantt-row-info">
                        <span class="row-number">${trainIndex + 1}</span>
                        <span class="row-name">列车号: ${train.number}</span>
                        <span class="row-duration">${trainPos.days}天</span>
                    </div>
                </div>
                <div class="gantt-row-bar-container">
                    <div class="gantt-row-bar" data-type="train" data-train="${trainIndex}"
                         style="left: ${trainPos.left}%; width: ${Math.max(trainPos.width, 0.1)}%; background-color: ${colors.train.bg}; color: ${colors.train.text} ;">
                        ${trainPos.days}天
                    </div>
                </div>
            </div>
            <div class="gantt-children-container" style="max-height: none;">
        `;
        
        if (train.phases) {
            train.phases.forEach((phase, phaseIndex) => {
                const phasePos = {
                    left: (Math.round((new Date(phase.start_time).setHours(0,0,0,0) - minDate.getTime()) / msPerDay) / totalDays) * 100,
                    width: ((Math.round((new Date(phase.end_time).setHours(0,0,0,0) - minDate.getTime()) / msPerDay) - Math.round((new Date(phase.start_time).setHours(0,0,0,0) - minDate.getTime()) / msPerDay) + 1) / totalDays) * 100,
                    days: Math.round((new Date(phase.end_time).setHours(0,0,0,0) - new Date(phase.start_time).setHours(0,0,0,0)) / msPerDay) + 1
                };
                
                html += `
                    <div class="gantt-row gantt-level-2">
                        <div class="gantt-row-header" onclick="toggleGanttRow(this)">
                            <div class="gantt-toggle expanded">−</div>
                            <div class="gantt-row-info">
                                <span class="row-number">${trainIndex + 1}.${phaseIndex + 1}</span>
                                <span class="row-name">${phase.name}</span>
                                <span class="row-duration">${phasePos.days}天</span>
                            </div>
                        </div>
                        <div class="gantt-row-bar-container">
                            <div class="gantt-row-bar" data-type="phase" data-train="${trainIndex}" data-phase="${phaseIndex}"
                                 style="left: ${phasePos.left}%; width: ${Math.max(phasePos.width, 0.1)}%; background-color: ${colors.phase.bg}; color: ${colors.phase.text} ;">
                                ${phasePos.days}天
                            </div>
                        </div>
                    </div>
                    <div class="gantt-children-container" style="max-height: none;">
                `;
                
                if (phase.sbops) {
                    phase.sbops.forEach((sbop, sbopIndex) => {
                        const sbopPos = {
                            left: (Math.round((new Date(sbop.start_time).setHours(0,0,0,0) - minDate.getTime()) / msPerDay) / totalDays) * 100,
                            width: ((Math.round((new Date(sbop.end_time).setHours(0,0,0,0) - minDate.getTime()) / msPerDay) - Math.round((new Date(sbop.start_time).setHours(0,0,0,0) - minDate.getTime()) / msPerDay) + 1) / totalDays) * 100,
                            days: Math.round((new Date(sbop.end_time).setHours(0,0,0,0) - new Date(sbop.start_time).setHours(0,0,0,0)) / msPerDay) + 1
                        };
                        
                        html += `
                            <div class="gantt-row gantt-level-3">
                                <div class="gantt-row-header" onclick="toggleGanttRow(this)">
                                    <div class="gantt-toggle expanded">−</div>
                                    <div class="gantt-row-info">
                                        <span class="row-number">${trainIndex + 1}.${phaseIndex + 1}.${sbopIndex + 1}</span>
                                        <span class="row-name">${sbop.name}</span>
                                        <span class="row-duration">${sbopPos.days}天</span>
                                    </div>
                                </div>
                                <div class="gantt-row-bar-container">
                                    <div class="gantt-row-bar" data-type="sbop" data-train="${trainIndex}" data-phase="${phaseIndex}" data-sbop='${JSON.stringify({id: sbop.id, team: sbop.team})}'
                                         style="left: ${sbopPos.left}%; width: ${Math.max(sbopPos.width, 0.1)}%; background-color: ${colors.sbop.bg}; color: ${colors.sbop.text};">
                                        ${sbopPos.days}天
                                    </div>
                                </div>
                            </div>
                            <div class="gantt-children-container" style="max-height: none;">
                        `;
                        
                        // 工单层级 - 按天展示
                        if (sbop.orders) {
                            const canEditPlan = hasPermission('plan:edit');
                            sbop.orders.forEach((order, orderIndex) => {
                                const orderPos = {
                                    left: (Math.round((new Date(order.start_time).setHours(0,0,0,0) - minDate.getTime()) / msPerDay) / totalDays) * 100,
                                    width: ((Math.round((new Date(order.end_time).setHours(0,0,0,0) - minDate.getTime()) / msPerDay) - Math.round((new Date(order.start_time).setHours(0,0,0,0) - minDate.getTime()) / msPerDay) + 1) / totalDays) * 100,
                                    days: Math.round((new Date(order.end_time).setHours(0,0,0,0) - new Date(order.start_time).setHours(0,0,0,0)) / msPerDay) + 1
                                };
                                
                                html += `
                                    <div class="gantt-row gantt-level-4 gantt-order-row" draggable="${canEditPlan ? 'true' : 'false'}"
                                         data-train-index="${trainIndex}" data-phase-index="${phaseIndex}" data-sbop-index="${sbopIndex}" data-order-index="${orderIndex}">
                                        <div class="gantt-row-header">
                                            <div class="gantt-toggle" style="visibility: hidden;">+</div>
                                            <div class="gantt-row-info">
                                                <span class="row-number">${trainIndex + 1}.${phaseIndex + 1}.${sbopIndex + 1}.${orderIndex + 1}</span>
                                                <span class="row-name">${order.name}</span>
                                                <span class="row-duration">${orderPos.days}天 (${order.duration}小时/${order.workerCount}人)</span>
                                            </div>
                                        </div>
                                        <div class="gantt-row-bar-container">
                                            <div class="gantt-row-bar" style="left: ${orderPos.left}%; width: ${Math.max(orderPos.width, 0.1)}%; background-color: ${colors.order.bg}; color: ${colors.order.text};">
                                                ${orderPos.days}天 (${order.duration}小时/${order.workerCount}人)
                                            </div>
                                        </div>
                                    </div>
                                `;
                            });
                        }
                        
                        html += `</div>`;
                    });
                }
                
                html += `</div>`;
            });
        }
        
        html += `</div>`;
    });
    
    html += `
                </div>
            </div>
        </div>
    `;
    tree.innerHTML = html;
    
    // 恢复滚动位置
    const scrollContainer = document.getElementById('ganttScrollContainer');
    if (scrollContainer && ganttScrollPosition > 0) {
        scrollContainer.scrollLeft = ganttScrollPosition;
    }
}

function zoomGantt(factor) {
    const scrollContainer = document.getElementById('ganttScrollContainer');
    if (scrollContainer) {
        ganttScrollPosition = scrollContainer.scrollLeft;
    }
    ganttZoomLevel *= factor;
    ganttZoomLevel = Math.max(0.5, Math.min(ganttZoomLevel, 5));
    renderScheduleFromPlans();
}

function resetGanttZoom() {
    ganttZoomLevel = 1;
    ganttScrollPosition = 0;
    renderScheduleFromPlans();
}

function setTrainOrderOverride(trainNumber, phaseId, sbopId, orderIds) {
    const plan = trainPlans.find(p => p && p.number === trainNumber);
    if (!plan) return;
    if (!plan.orderOverrides || typeof plan.orderOverrides !== 'object') {
        plan.orderOverrides = {};
    }
    const key = `${phaseId}:${sbopId}`;
    plan.orderOverrides[key] = orderIds;
    saveTrainPlans();
    renderScheduleFromPlans();
}

function clearDragClasses(tree) {
    const dragging = tree.querySelector('.gantt-order-row.dragging');
    if (dragging) dragging.classList.remove('dragging');
    tree.querySelectorAll('.gantt-order-row.drag-over').forEach(el => el.classList.remove('drag-over'));
}

function bindGanttOrderDragDrop() {
    if (ganttDndBound) return;
    const tree = document.getElementById('ganttTree');
    if (!tree) return;
    ganttDndBound = true;

    tree.addEventListener('dragstart', (e) => {
        if (!hasPermission('plan:edit')) {
            e.preventDefault();
            return;
        }
        const row = e.target.closest && e.target.closest('.gantt-order-row');
        if (!row) return;
        const trainIndex = parseInt(row.dataset.trainIndex, 10);
        const phaseIndex = parseInt(row.dataset.phaseIndex, 10);
        const sbopIndex = parseInt(row.dataset.sbopIndex, 10);
        const orderIndex = parseInt(row.dataset.orderIndex, 10);
        if ([trainIndex, phaseIndex, sbopIndex, orderIndex].some(n => Number.isNaN(n))) return;

        draggedOrderInfo = { trainIndex, phaseIndex, sbopIndex, orderIndex };
        row.classList.add('dragging');
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', `${trainIndex}:${phaseIndex}:${sbopIndex}:${orderIndex}`);
        }
    });

    tree.addEventListener('dragover', (e) => {
        if (!draggedOrderInfo) return;
        const row = e.target.closest && e.target.closest('.gantt-order-row');
        if (!row) return;
        const trainIndex = parseInt(row.dataset.trainIndex, 10);
        const phaseIndex = parseInt(row.dataset.phaseIndex, 10);
        const sbopIndex = parseInt(row.dataset.sbopIndex, 10);
        if (Number.isNaN(trainIndex) || Number.isNaN(phaseIndex) || Number.isNaN(sbopIndex)) return;
        if (trainIndex !== draggedOrderInfo.trainIndex || phaseIndex !== draggedOrderInfo.phaseIndex || sbopIndex !== draggedOrderInfo.sbopIndex) return;
        e.preventDefault();
        clearDragClasses(tree);
        row.classList.add('drag-over');
    });

    tree.addEventListener('drop', (e) => {
        if (!draggedOrderInfo) return;
        const row = e.target.closest && e.target.closest('.gantt-order-row');
        if (!row) return;
        const trainIndex = parseInt(row.dataset.trainIndex, 10);
        const phaseIndex = parseInt(row.dataset.phaseIndex, 10);
        const sbopIndex = parseInt(row.dataset.sbopIndex, 10);
        const toOrderIndex = parseInt(row.dataset.orderIndex, 10);
        if ([trainIndex, phaseIndex, sbopIndex, toOrderIndex].some(n => Number.isNaN(n))) return;
        if (trainIndex !== draggedOrderInfo.trainIndex || phaseIndex !== draggedOrderInfo.phaseIndex || sbopIndex !== draggedOrderInfo.sbopIndex) return;
        e.preventDefault();

        const scheduleData = currentScheduleData;
        if (!scheduleData || !scheduleData.trains || !scheduleData.trains[trainIndex]) return;
        const train = scheduleData.trains[trainIndex];
        const phase = train.phases && train.phases[phaseIndex];
        const sbop = phase && phase.sbops && phase.sbops[sbopIndex];
        if (!sbop || !Array.isArray(sbop.orders)) return;

        const fromIndex = draggedOrderInfo.orderIndex;
        if (fromIndex === toOrderIndex) return;

        const orders = sbop.orders.slice();
        const [moved] = orders.splice(fromIndex, 1);
        if (!moved) return;
        const insertIndex = toOrderIndex > fromIndex ? toOrderIndex - 1 : toOrderIndex;
        orders.splice(insertIndex, 0, moved);
        const orderIds = orders.map(o => o.id);
        setTrainOrderOverride(train.number, phase.id, sbop.id, orderIds);
        clearDragClasses(tree);
        draggedOrderInfo = null;
    });

    tree.addEventListener('dragend', () => {
        clearDragClasses(tree);
        draggedOrderInfo = null;
    });
}

function updateTeamFilter(scheduleData) {
    const teamFilter = document.getElementById('teamFilter');
    const filterStartDate = document.getElementById('filterStartDate');
    const filterEndDate = document.getElementById('filterEndDate');
    
    if (!teamFilter) return;
    
    // 收集所有班组和日期范围
    const teams = new Set();
    let minDate = null;
    let maxDate = null;
    
    scheduleData.trains.forEach(train => {
        if (train.phases) {
            train.phases.forEach(phase => {
                if (phase.sbops) {
                    phase.sbops.forEach(sbop => {
                        if (sbop.team) {
                            teams.add(sbop.team);
                        }
                        if (sbop.start_time) {
                            const startDate = new Date(sbop.start_time);
                            if (!minDate || startDate < minDate) minDate = startDate;
                        }
                        if (sbop.end_time) {
                            const endDate = new Date(sbop.end_time);
                            if (!maxDate || endDate > maxDate) maxDate = endDate;
                        }
                    });
                }
            });
        }
    });
    
    // 清空并重新添加班组选项
    teamFilter.innerHTML = '<option value="all">全部班组</option>';
    teams.forEach(team => {
        const option = document.createElement('option');
        option.value = team;
        option.textContent = team;
        teamFilter.appendChild(option);
    });
    
    // 设置日期筛选范围
    if (minDate && filterStartDate) {
        filterStartDate.min = minDate.toISOString().split('T')[0];
        filterStartDate.max = maxDate ? maxDate.toISOString().split('T')[0] : '';
    }
    if (maxDate && filterEndDate) {
        filterEndDate.min = minDate ? minDate.toISOString().split('T')[0] : '';
        filterEndDate.max = maxDate.toISOString().split('T')[0];
    }
}

let lastSearchResults = [];

function searchDetails() {
    const selectedTeam = document.getElementById('teamFilter').value;
    const filterStartDate = document.getElementById('filterStartDate').value;
    const filterEndDate = document.getElementById('filterEndDate').value;
    const tableBody = document.getElementById('detailsTableBody');
    
    // 清空当前列表并重置搜索结果
    tableBody.innerHTML = '';
    lastSearchResults = [];
    
    const trainNumberSelect = document.getElementById('trainNumberFilter');
    const selectedTrain = trainNumberSelect ? trainNumberSelect.value : 'all';
    const scheduleData = currentScheduleData || buildMultiTrainSchedule();
    if (!scheduleData || !scheduleData.trains || scheduleData.trains.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="9" class="empty-text">请先添加列车排程</td></tr>';
        return;
    }
    
    // 更新筛选器
    updateTeamFilter(scheduleData);

    scheduleData.trains.forEach(train => {
        if (selectedTrain && selectedTrain !== 'all' && train.number !== selectedTrain) {
            return;
        }
        train.phases.forEach(phase => {
            phase.sbops.forEach(sbop => {
                // 班组筛选
                const teamMatch = selectedTeam === 'all' || sbop.team === selectedTeam;
                
                // 时间跨度筛选
                let dateMatch = true;
                const sbopStartStr = formatDate(sbop.start_time);
                const sbopEndStr = formatDate(sbop.end_time);
                
                if (filterStartDate) {
                    dateMatch = dateMatch && (sbopEndStr >= filterStartDate);
                }
                if (filterEndDate) {
                    dateMatch = dateMatch && (sbopStartStr <= filterEndDate);
                }
                
                if (teamMatch && dateMatch) {
                    sbop.orders.forEach(order => {
                        const rowData = {
                            trainNumber: train.number,
                            phaseName: phase.name,
                            sbopName: sbop.name,
                            team: sbop.team || '-',
                            orderName: order.name,
                            startDate: formatDate(order.start_time),
                            endDate: formatDate(order.end_time),
                            duration: order.duration,
                            workerCount: order.workerCount
                        };
                        
                        lastSearchResults.push(rowData);
                        
                        const tr = document.createElement('tr');
                        tr.innerHTML = `
                            <td>${rowData.trainNumber}</td>
                            <td>${rowData.phaseName}</td>
                            <td>${rowData.sbopName}</td>
                            <td>${rowData.team}</td>
                            <td>${rowData.orderName}</td>
                            <td>${rowData.startDate}</td>
                            <td>${rowData.endDate}</td>
                            <td>${rowData.duration}</td>
                            <td>${rowData.workerCount}</td>
                        `;
                        tableBody.appendChild(tr);
                    });
                }
            });
        });
    });
    
    if (lastSearchResults.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="9" class="empty-text">未找到符合条件的结果</td></tr>';
    }
}

function exportDetailsToExcel() {
    if (lastSearchResults.length === 0) {
        alert('请先进行查询并生成明细清单！');
        return;
    }
    
    // 转换数据为 Excel 格式
    const excelData = lastSearchResults.map(row => ({
        '列车号': row.trainNumber,
        '检修阶段': row.phaseName,
        'SBOP名称': row.sbopName,
        '班组': row.team,
        '工单名称': row.orderName,
        '开始日期': row.startDate,
        '结束日期': row.endDate,
        '工时(小时)': row.duration,
        '人数': row.workerCount
    }));
    
    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '明细清单');
    
    // 导出文件
    const dateStr = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `明细清单_${dateStr}.xlsx`);
}

function resetFilters() {
    const trainNumberFilter = document.getElementById('trainNumberFilter');
    if (trainNumberFilter) trainNumberFilter.value = 'all';
    document.getElementById('teamFilter').value = 'all';
    document.getElementById('filterStartDate').value = '';
    document.getElementById('filterEndDate').value = '';
    document.getElementById('detailsTableBody').innerHTML = '<tr><td colspan="9" class="empty-text">请选择条件后点击“查询明细”</td></tr>';
    lastSearchResults = [];
}

function toggleGanttRow(header) {
    const toggle = header.querySelector('.gantt-toggle');
    const row = header.closest('.gantt-row');
    const children = row.nextElementSibling;
    
    if (toggle.style.visibility === 'hidden') {
        return;
    }
    
    if (children && children.classList.contains('gantt-children-container')) {
        if (children.style.display !== 'none' && children.style.maxHeight === 'none') {
            children.style.maxHeight = children.scrollHeight + 'px';
            setTimeout(() => {
                children.classList.add('collapsed');
                children.style.maxHeight = '0';
                setTimeout(() => {
                    if (children.classList.contains('collapsed')) {
                        children.style.display = 'none';
                    }
                }, 300);
            }, 10);
            toggle.classList.remove('expanded');
            toggle.classList.add('collapsed');
            toggle.textContent = '+';
        } else {
            children.style.display = 'block';
            children.classList.remove('collapsed');
            children.style.maxHeight = children.scrollHeight + 'px';
            setTimeout(() => {
                children.style.maxHeight = 'none';
            }, 300);
            toggle.classList.remove('collapsed');
            toggle.classList.add('expanded');
            toggle.textContent = '−';
        }
    }
}

function expandAllGantt() {
    document.querySelectorAll('.gantt-row').forEach(row => row.style.display = 'flex');
    document.querySelectorAll('.gantt-children-container').forEach(children => {
        children.style.display = 'block';
        children.classList.remove('collapsed');
        children.style.maxHeight = 'none';
    });
    document.querySelectorAll('.gantt-toggle').forEach(toggle => {
        if (toggle.style.visibility !== 'hidden') {
            toggle.classList.remove('collapsed');
            toggle.classList.add('expanded');
            toggle.textContent = '−';
        }
    });
}

function collapseAllGantt() {
    document.querySelectorAll('.gantt-children-container').forEach(children => {
        children.classList.add('collapsed');
        children.style.maxHeight = '0';
        setTimeout(() => {
            if (children.classList.contains('collapsed')) {
                children.style.display = 'none';
            }
        }, 300);
    });
    document.querySelectorAll('.gantt-toggle').forEach(toggle => {
        if (toggle.style.visibility !== 'hidden') {
            toggle.classList.remove('expanded');
            toggle.classList.add('collapsed');
            toggle.textContent = '+';
        }
    });
}



function renderDataTree() {
    const container = document.getElementById('dataTree');
    
    if (!templateData || templateData.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <h3>暂无模板数据</h3>
                <p>请在下方添加检修阶段或在上方选择现有模板</p>
            </div>
        `;
        return;
    }
    
    let html = '';
    
    const canEditData = hasPermission('data:edit');

    templateData.forEach((phase, phaseIndex) => {
        html += `
            <div class="tree-item">
                <div class="tree-header phase" onclick="toggleDataTreeRow(this)">
                    <div class="tree-toggle expanded">−</div>
                    <span class="tree-title">${phase.name} (第${phase.startDayOffset || 1}天开始)</span>
                    <div class="tree-actions" style="${canEditData ? '' : 'display:none;'}" onclick="event.stopPropagation()">
                        <button class="btn-add" onclick="showAddSBOPModal(${phaseIndex})">添加SBOP</button>
                        <button class="btn-edit" onclick="showEditPhaseModal(${phaseIndex})">编辑</button>
                        <button class="btn-delete" onclick="deletePhase(${phaseIndex})">删除</button>
                    </div>
                </div>
                <div class="tree-children">
        `;
        
        if (phase.sbops) {
            phase.sbops.forEach((sbop, sbopIndex) => {
                const carCounts = sbop.carCounts || {};
                const totalWorkOrders = sbop.orders ? sbop.orders.length : 0;
                
                // 生成车号展示文本 (1-8号车)
                const carInfo = [1, 2, 3, 4, 5, 6, 7, 8]
                    .filter(num => carCounts[num] > 0)
                    .map(num => `${num}#车:${carCounts[num]}`)
                    .join(', ');

                html += `
                    <div class="tree-item">
                        <div class="tree-header sbop" onclick="toggleDataTreeRow(this)">
                            <div class="tree-toggle expanded">−</div>
                            <span class="tree-title">${sbop.name} (阶段第${sbop.startDayOffset || 1}天开始)</span>
                            <span class="tree-info">节拍: ${sbop.takt || 3} | 总工时: ${sbop.totalHours || 0}h | 人数: ${sbop.workerCount || 1} | 总工单: ${totalWorkOrders}${sbop.team ? ' | 班组: ' + sbop.team : ''}</span>
                            <div class="car-info-badge">${carInfo || '无车工单'}</div>
                            <div class="tree-actions" style="${canEditData ? '' : 'display:none;'}" onclick="event.stopPropagation()">
                                <button class="btn-edit" onclick="showEditSBOPModal(${phaseIndex}, ${sbopIndex})">编辑SBOP</button>
                                <button class="btn-delete" onclick="deleteSBOP(${phaseIndex}, ${sbopIndex})">删除</button>
                            </div>
                        </div>
                        <div class="tree-children">
                `;
                
                if (sbop.orders) {
                    sbop.orders.forEach((order, orderIndex) => {
                        html += `
                            <div class="tree-item">
                                <div class="tree-header order">
                                    <span class="tree-title">${order.name} (${order.duration || 0}小时/${order.workerCount || 1}人)</span>
                                </div>
                            </div>
                        `;
                    });
                }
                
                html += `
                        </div>
                    </div>
                `;
            });
        }
        
        html += `
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

function toggleDataTreeRow(header) {
    const toggle = header.querySelector('.tree-toggle');
    const item = header.closest('.tree-item');
    const children = item.querySelector('.tree-children');
    
    if (children) {
        if (children.style.display === 'none') {
            children.style.display = 'block';
            toggle.textContent = '−';
            toggle.classList.remove('collapsed');
            toggle.classList.add('expanded');
        } else {
            children.style.display = 'none';
            toggle.textContent = '+';
            toggle.classList.remove('expanded');
            toggle.classList.add('collapsed');
        }
    }
}

function expandAllDataTree() {
    document.querySelectorAll('.data-tree .tree-children').forEach(c => c.style.display = 'block');
    document.querySelectorAll('.data-tree .tree-toggle').forEach(t => {
        t.textContent = '−';
        t.classList.remove('collapsed');
        t.classList.add('expanded');
    });
}

function collapseAllDataTree() {
    document.querySelectorAll('.data-tree .tree-children').forEach(c => c.style.display = 'none');
    document.querySelectorAll('.data-tree .tree-toggle').forEach(t => {
        t.textContent = '+';
        t.classList.remove('expanded');
        t.classList.add('collapsed');
    });
}

function showAddPhaseModal() {
    document.getElementById('modalTitle').textContent = '添加检修阶段';
    document.getElementById('modalBody').innerHTML = `
        <div class="form-group">
            <label>阶段名称:</label>
            <input type="text" id="phaseName" placeholder="请输入阶段名称">
        </div>
        <div class="form-group">
            <label>开始作业第几天 (1-99):</label>
            <input type="number" id="phaseStartDay" value="1" min="1" max="99">
        </div>
        <button class="btn btn-primary" onclick="addPhase()">确认添加</button>
    `;
    openModal();
}

function showEditPhaseModal(phaseIndex) {
    const phase = templateData[phaseIndex];
    document.getElementById('modalTitle').textContent = '编辑检修阶段';
    document.getElementById('modalBody').innerHTML = `
        <div class="form-group">
            <label>阶段名称:</label>
            <input type="text" id="phaseName" value="${phase.name}">
        </div>
        <div class="form-group">
            <label>开始作业第几天 (1-99):</label>
            <input type="number" id="phaseStartDay" value="${phase.startDayOffset || 1}" min="1" max="99">
        </div>
        <button class="btn btn-primary" onclick="updatePhase(${phaseIndex})">确认修改</button>
    `;
    openModal();
}

function addPhase() {
    const name = document.getElementById('phaseName').value.trim();
    const startDay = parseInt(document.getElementById('phaseStartDay').value) || 1;
    
    if (!name) {
        alert('请输入阶段名称！');
        return;
    }
    
    templateData.push({
        id: Date.now(),
        name: name,
        startDayOffset: startDay,
        sbops: []
    });
    
    renderDataTree();
    closeModal();
}

function updatePhase(phaseIndex) {
    const name = document.getElementById('phaseName').value.trim();
    const startDay = parseInt(document.getElementById('phaseStartDay').value) || 1;
    
    if (!name) {
        alert('请输入阶段名称！');
        return;
    }
    
    templateData[phaseIndex].name = name;
    templateData[phaseIndex].startDayOffset = startDay;
    renderDataTree();
    closeModal();
}

function showAddSBOPModal(phaseIndex) {
    document.getElementById('modalTitle').textContent = '添加SBOP';
    document.getElementById('modalBody').innerHTML = `
        <div class="form-group">
            <label>SBOP名称:</label>
            <input type="text" id="sbopName" placeholder="请输入SBOP名称">
        </div>
        <div class="form-group">
            <label>阶段开始第几天 (1-99):</label>
            <input type="number" id="sbopStartDay" value="1" min="1" max="99">
        </div>
        <div class="form-group">
            <label>工时总数 (小时):</label>
            <input type="number" id="sbopTotalHours" value="8" min="0" step="0.5">
        </div>
        <div class="form-group">
            <label>作业人数:</label>
            <input type="number" id="sbopWorkerCount" value="1" min="1">
        </div>
        <div class="form-group">
            <label>节拍设置 (1-9):</label>
            <input type="number" id="sbopTakt" value="3" min="1" max="9">
        </div>
        <div class="form-group">
            <label>各车工单数量:</label>
            <div class="car-counts-grid">
                ${[1, 2, 3, 4, 5, 6, 7, 8].map(num => `
                    <div class="car-count-item">
                        <label>${num}#车:</label>
                        <input type="number" class="car-count-input" data-car="${num}" value="0" min="0">
                    </div>
                `).join('')}
            </div>
        </div>
        <div class="form-group">
            <label>班组:</label>
            <select id="sbopTeam">
                <option value="">-- 请选择班组 --</option>
                ${teamDictionary.map(team => `<option value="${team}">${team}</option>`).join('')}
            </select>
        </div>
        <button class="btn btn-primary" onclick="addSBOP(${phaseIndex})">确认添加</button>
    `;
    openModal();
}

function showEditSBOPModal(phaseIndex, sbopIndex) {
    const sbop = templateData[phaseIndex].sbops[sbopIndex];
    const carCounts = sbop.carCounts || {};
    
    document.getElementById('modalTitle').textContent = '编辑SBOP';
    document.getElementById('modalBody').innerHTML = `
        <div class="form-group">
            <label>SBOP名称:</label>
            <input type="text" id="sbopName" value="${sbop.name}">
        </div>
        <div class="form-group">
            <label>阶段开始第几天 (1-99):</label>
            <input type="number" id="sbopStartDay" value="${sbop.startDayOffset || 1}" min="1" max="99">
        </div>
        <div class="form-group">
            <label>工时总数 (小时):</label>
            <input type="number" id="sbopTotalHours" value="${sbop.totalHours || 8}" min="0" step="0.5">
        </div>
        <div class="form-group">
            <label>作业人数:</label>
            <input type="number" id="sbopWorkerCount" value="${sbop.workerCount || 1}" min="1">
        </div>
        <div class="form-group">
            <label>节拍设置 (1-9):</label>
            <input type="number" id="sbopTakt" value="${sbop.takt || 3}" min="1" max="9">
        </div>
        <div class="form-group">
            <label>各车工单数量:</label>
            <div class="car-counts-grid">
                ${[1, 2, 3, 4, 5, 6, 7, 8].map(num => `
                    <div class="car-count-item">
                        <label>${num}#车:</label>
                        <input type="number" class="car-count-input" data-car="${num}" value="${carCounts[num] || 0}" min="0">
                    </div>
                `).join('')}
            </div>
        </div>
        <div class="form-group">
            <label>班组:</label>
            <select id="sbopTeam">
                <option value="">-- 请选择班组 --</option>
                ${teamDictionary.map(team => `<option value="${team}" ${sbop.team === team ? 'selected' : ''}>${team}</option>`).join('')}
            </select>
        </div>
        <button class="btn btn-primary" onclick="updateSBOP(${phaseIndex}, ${sbopIndex})">确认修改</button>
    `;
    openModal();
}

function generateOrdersFromCarCounts(carCounts, totalHours, workerCount) {
    const orders = [];
    const carNums = Object.keys(carCounts).sort((a, b) => a - b);
    
    // 首先收集所有需要生成的工单车号
    const carOrderSequence = [];
    carNums.forEach(carNum => {
        const count = carCounts[carNum];
        for (let i = 0; i < count; i++) {
            carOrderSequence.push(carNum);
        }
    });
    
    const totalOrders = carOrderSequence.length;
    if (totalOrders === 0) return [];
    
    // 计算单个工单工时，保留一位小数
    const avgDuration = parseFloat((totalHours / totalOrders).toFixed(1));
    let remainingHours = totalHours;
    
    carOrderSequence.forEach((carNum, index) => {
        let duration;
        if (index === totalOrders - 1) {
            // 最后一个工单处理余数
            duration = parseFloat(remainingHours.toFixed(1));
        } else {
            duration = avgDuration;
            remainingHours -= avgDuration;
        }
        
        orders.push({
            id: Date.now() + Math.random() + index,
            name: `${carNum}#车工单`,
            duration: duration,
            workerCount: workerCount
        });
    });
    
    return orders;
}

function addSBOP(phaseIndex) {
    const name = document.getElementById('sbopName').value.trim();
    const startDay = parseInt(document.getElementById('sbopStartDay').value) || 1;
    const totalHours = parseFloat(document.getElementById('sbopTotalHours').value) || 0;
    const workerCount = parseInt(document.getElementById('sbopWorkerCount').value) || 1;
    const takt = parseInt(document.getElementById('sbopTakt').value) || 3;
    const team = document.getElementById('sbopTeam').value.trim();
    
    const carCounts = {};
    document.querySelectorAll('.car-count-input').forEach(input => {
        carCounts[input.dataset.car] = parseInt(input.value) || 0;
    });
    
    if (!name) {
        alert('请输入SBOP名称！');
        return;
    }
    
    if (!templateData[phaseIndex].sbops) {
        templateData[phaseIndex].sbops = [];
    }
    
    const orders = generateOrdersFromCarCounts(carCounts, totalHours, workerCount);
    
    templateData[phaseIndex].sbops.push({
        id: Date.now(),
        name: name,
        startDayOffset: startDay,
        totalHours: totalHours,
        workerCount: workerCount,
        takt: takt,
        carCounts: carCounts,
        team: team,
        orders: orders
    });
    
    renderDataTree();
    closeModal();
}

function updateSBOP(phaseIndex, sbopIndex) {
    const name = document.getElementById('sbopName').value.trim();
    const startDay = parseInt(document.getElementById('sbopStartDay').value) || 1;
    const totalHours = parseFloat(document.getElementById('sbopTotalHours').value) || 0;
    const workerCount = parseInt(document.getElementById('sbopWorkerCount').value) || 1;
    const takt = parseInt(document.getElementById('sbopTakt').value) || 3;
    const team = document.getElementById('sbopTeam').value.trim();
    
    const carCounts = {};
    document.querySelectorAll('.car-count-input').forEach(input => {
        carCounts[input.dataset.car] = parseInt(input.value) || 0;
    });
    
    if (!name) {
        alert('请输入SBOP名称！');
        return;
    }
    
    const sbop = templateData[phaseIndex].sbops[sbopIndex];
    const orders = generateOrdersFromCarCounts(carCounts, totalHours, workerCount);
    
    sbop.name = name;
    sbop.startDayOffset = startDay;
    sbop.totalHours = totalHours;
    sbop.workerCount = workerCount;
    sbop.takt = takt;
    sbop.carCounts = carCounts;
    sbop.team = team;
    sbop.orders = orders;
    
    renderDataTree();
    closeModal();
}

function showAddOrderModal(phaseIndex, sbopIndex) {
    document.getElementById('modalTitle').textContent = '添加工单';
    document.getElementById('modalBody').innerHTML = `
        <div class="form-group">
            <label>工单名称:</label>
            <input type="text" id="orderName" placeholder="请输入工单名称">
        </div>
        <div class="form-group">
            <label>工时 (小时):</label>
            <input type="number" id="orderDuration" value="8" step="0.5" min="0">
        </div>
        <div class="form-group">
            <label>人数:</label>
            <input type="number" id="orderWorkerCount" value="1" min="1">
        </div>
        <button class="btn btn-primary" onclick="addOrder(${phaseIndex}, ${sbopIndex})">确认添加</button>
    `;
    openModal();
}

function showEditOrderModal(phaseIndex, sbopIndex, orderIndex) {
    const order = templateData[phaseIndex].sbops[sbopIndex].orders[orderIndex];
    document.getElementById('modalTitle').textContent = '编辑工单';
    document.getElementById('modalBody').innerHTML = `
        <div class="form-group">
            <label>工单名称:</label>
            <input type="text" id="orderName" value="${order.name}">
        </div>
        <div class="form-group">
            <label>工时 (小时):</label>
            <input type="number" id="orderDuration" value="${order.duration || 8}" step="0.5" min="0">
        </div>
        <div class="form-group">
            <label>人数:</label>
            <input type="number" id="orderWorkerCount" value="${order.workerCount || 1}" min="1">
        </div>
        <button class="btn btn-primary" onclick="updateOrder(${phaseIndex}, ${sbopIndex}, ${orderIndex})">确认修改</button>
    `;
    openModal();
}

function addOrder(phaseIndex, sbopIndex) {
    const name = document.getElementById('orderName').value.trim();
    const duration = parseFloat(document.getElementById('orderDuration').value) || 0;
    const workerCount = parseInt(document.getElementById('orderWorkerCount').value) || 1;
    
    if (!name) {
        alert('请输入工单名称！');
        return;
    }
    
    const sbop = templateData[phaseIndex].sbops[sbopIndex];
    if (!sbop.orders) {
        sbop.orders = [];
    }
    
    sbop.orders.push({
        id: Date.now(),
        name: name,
        duration: duration,
        workerCount: workerCount
    });
    
    renderDataTree();
    closeModal();
}

function updateOrder(phaseIndex, sbopIndex, orderIndex) {
    const name = document.getElementById('orderName').value.trim();
    const duration = parseFloat(document.getElementById('orderDuration').value) || 0;
    const workerCount = parseInt(document.getElementById('orderWorkerCount').value) || 1;
    
    if (!name) {
        alert('请输入工单名称！');
        return;
    }
    
    const order = templateData[phaseIndex].sbops[sbopIndex].orders[orderIndex];
    order.name = name;
    order.duration = duration;
    order.workerCount = workerCount;
    
    renderDataTree();
    closeModal();
}

function deletePhase(phaseIndex) {
    if (confirm('确定要删除该阶段吗？')) {
        templateData.splice(phaseIndex, 1);
        renderDataTree();
    }
}

function deleteSBOP(phaseIndex, sbopIndex) {
    if (confirm('确定要删除该SBOP吗？')) {
        templateData[phaseIndex].sbops.splice(sbopIndex, 1);
        renderDataTree();
    }
}

function deleteOrder(phaseIndex, sbopIndex, orderIndex) {
    if (confirm('确定要删除该工单吗？')) {
        templateData[phaseIndex].sbops[sbopIndex].orders.splice(orderIndex, 1);
        renderDataTree();
    }
}

function clearData() {
    if (!confirm('确定要清空当前编辑的模板数据吗？此操作不可恢复！')) {
        return;
    }
    
    templateData = [];
    renderDataTree();
    
    if (ganttChart) {
        ganttChart.destroy();
        ganttChart = null;
    }
    
    document.getElementById('ganttInfo').innerHTML = '';
    document.getElementById('ganttTree').innerHTML = `
        <div class="empty-state">
            <h3>暂无排程数据</h3>
            <p>请先生成排程</p>
        </div>
    `;
}

function openModal() {
    document.getElementById('modal').style.display = 'block';
}

function closeModal() {
    document.getElementById('modal').style.display = 'none';
}
