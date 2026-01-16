/* ================= CONFIG & STATE ================= */
const API = "https://todoapp-tgd4.onrender.com";

const state = {
  token: localStorage.getItem('token'),
  user: localStorage.getItem('currentUser'),
  tasks: []
};

/* ================= HELPERS ================= */
const $ = id => document.getElementById(id);
let otpCooldown = 60;
let otpTimer = null;
let otpExpireSeconds = 300; // 5 phút
let otpExpireTimer = null;
let missingApiWarned = false;


function saveAuth(email, token) {
  Object.assign(state, { user: email, token });
  localStorage.setItem('token', token);
  localStorage.setItem('currentUser', email);
}

function clearAuth() {
  Object.assign(state, { user: null, token: null });
  localStorage.clear();
}

async function apiFetch(path, options = {}) {
  if (!API) {
    if (!missingApiWarned) {
      alert('Thiếu cấu hình API. Vui lòng thiết lập API_URL trước khi đăng nhập.');
      missingApiWarned = true;
    }
    throw new Error('Missing API base URL');
  }

  const headers = {
    'Content-Type': 'application/json',
    ...(state.token && { Authorization: `Bearer ${state.token}` })
  };
  
  let res;
  try {
    res = await fetch(API + path, { ...options, headers });
  } catch (error) {
    alert('Không kết nối được máy chủ. Vui lòng kiểm tra API_URL hoặc CORS.');
    throw error;
  }
  if (res.status === 401) {
    alert('Phiên đăng nhập đã hết hạn');
    clearAuth();
    location.reload();
    throw new Error('Unauthorized');
  }

  let data;
  try {
    data = await res.json();
  } catch (error) {
    if (!res.ok) {
      return { error: `Máy chủ trả về lỗi (${res.status})` };
    }
    throw error;
  }

  if (!res.ok && !data?.error) {
    return { error: `Máy chủ trả về lỗi (${res.status})` };
  }

  return data;
}

/* ================= AUTH ================= */
$('btn-login').onclick = async () => {
  const email = $('auth-email').value;
  const password = $('auth-pass').value;
  if (!email || !password) return alert('Nhập email và mật khẩu');

  const data = await apiFetch('/api/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });

  if (data.error) return alert(data.error);
  saveAuth(data.email, data.token);
  showApp();
};

function startOtpExpireTimer() {
  clearInterval(otpExpireTimer);

  otpExpireSeconds = 300;
  $('otp-timer').classList.remove('hidden');

  otpExpireTimer = setInterval(() => {
    otpExpireSeconds--;

    const min = String(Math.floor(otpExpireSeconds / 60)).padStart(2, '0');
    const sec = String(otpExpireSeconds % 60).padStart(2, '0');

    $('otp-time').innerText = `${min}:${sec}`;

    if (otpExpireSeconds <= 0) {
      clearInterval(otpExpireTimer);
      $('otp-time').innerText = '00:00';
      alert('OTP đã hết hạn, vui lòng gửi lại mã');
    }
  }, 1000);
}

function startOtpCooldown() {
  otpCooldown = 60;
  const btn = $('btn-resend-otp');

  btn.disabled = true;
  btn.innerText = `Gửi lại OTP (${otpCooldown}s)`;

  otpTimer = setInterval(() => {
    otpCooldown--;
    btn.innerText = `Gửi lại OTP (${otpCooldown}s)`;

    if (otpCooldown <= 0) {
      clearInterval(otpTimer);
      btn.disabled = false;
      btn.innerText = 'Gửi lại OTP';
    }
  }, 1000);
}

$('btn-send-otp').onclick = async () => {
  const email = $('reg-email').value.trim();
  const password = $('reg-pass').value;

  if (!email || !password)
    return alert('Vui lòng nhập email và mật khẩu');

  const data = await apiFetch('/api/register/request-otp', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });

  if (data.error) return alert(data.error);

  alert('Mã OTP đã được gửi về email');
  $('reg-otp').classList.remove('hidden');
  $('btn-resend-otp').classList.remove('hidden');
  startOtpCooldown();
  startOtpExpireTimer();
  $('btn-send-otp').classList.add('hidden');
};

$('btn-verify-otp').onclick = async () => {
  const email = $('reg-email').value.trim();
  const otp = $('reg-otp').value.trim();

  if (!otp) return alert('Nhập mã OTP');

  const data = await apiFetch('/api/register/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ email, otp })
  });

  if (data.error) return alert(data.error);

  alert('Đăng ký thành công! Giờ bạn có thể đăng nhập');
  toggleAuth(true);
};

$('btn-resend-otp').onclick = async () => {
  const email = $('reg-email').value.trim();
  const password = $('reg-pass').value;

  if (!email || !password)
    return alert('Thiếu email hoặc mật khẩu');

  const data = await apiFetch('/api/register/request-otp', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });

  if (data.error) return alert(data.error);

  alert('Đã gửi lại mã OTP');
  startOtpCooldown();
  startOtpExpireTimer();
};

/* ================= UI ================= */
$('switch-login').onclick = () => toggleAuth(true);
$('switch-register').onclick = () => toggleAuth(false);

function toggleAuth(showLogin) {
  $('auth-container').classList.toggle('hidden', !showLogin);
  $('register-container').classList.toggle('hidden', showLogin);
}

function showApp() {
  $('auth-container').classList.add('hidden');
  $('register-container').classList.add('hidden');
  $('app').classList.remove('hidden');
  fetchTasks();
}

if (state.token && state.user) showApp();

/* ================= TASK API ================= */
async function fetchTasks() {
  const data = await apiFetch('/api/tasks');
  state.tasks = data.tasks || [];
  render();
}


$('add-btn').onclick = async () => {
  const title = $('task-input').value.trim();
  const rawDeadline = $('deadline-input').value; // lấy giá trị nhập vào
  if (!title) return alert('Nhập công việc');
  // fix: đổi sang iso string (utc) trước khi gửi
  const deadline = rawDeadline ? new Date(rawDeadline).toISOString() : null;

  await apiFetch('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title, deadline })
  });

  $('task-input').value = '';
  $('deadline-input').value = '';
  fetchTasks();
};

/* ================= NLP ================= */
$('nlp-btn').onclick = async () => {
  const text = $('nlp-input').value.trim();
  if (!text) return;

  const data = await apiFetch('/api/nlp', {
    method: 'POST',
    body: JSON.stringify({ text })
  });

  if (data.error) return alert(data.error);
  await apiFetch('/api/tasks', {
    method: 'POST',
    body: JSON.stringify(data)
  });

  $('nlp-input').value = '';
  fetchTasks();
};

/* ================= RENDER ================= */
$('filter').onchange = $('filter-date').onchange = render;

function formatDeadline(iso) {
  if (!iso) return "Không có";

  const d = new Date(iso);
  return d.toLocaleString("vi-VN", {
    hour12: false
  });
}

function render() {
  const status = $('filter').value;
  const date = $('filter-date').value;

  $('task-list').innerHTML = state.tasks
    .filter(t =>
      status === 'completed' ? t.completed :
      status === 'pending' ? !t.completed : true
    )
    .filter(t => !date || (t.deadline || '').startsWith(date))
    .map(t => `
      <div class="task-card" data-id="${t.id}">
        <div class="task-left">
          <input type="checkbox" ${t.completed ? 'checked' : ''} onclick="toggle(${t.id})">
          <div>
            <div class="task-title ${t.completed ? 'completed' : ''}">
              ${t.title}
            </div>
            <small class="task-deadline">⌛ ${formatDeadline(t.deadline)}</small>
          </div>
        </div>
        <div class="icons">
          <i class="fa-solid fa-pen-to-square" onclick="editTask(this)"></i>
          <i class="fa-solid fa-trash-can" onclick="del(${t.id})"></i>
        </div>
      </div>
    `).join('');
}

/* ================= TASK OPS ================= */
async function toggle(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;

  t.completed = !t.completed;
  render();

  try {
    await apiFetch(`/api/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ completed: t.completed })
    });
  } catch (err) {
    // rollback nếu lỗi
    t.completed = !t.completed;
    render();
    alert('Không thể cập nhật trạng thái');
  }
}


async function del(id) {
  await apiFetch(`/api/tasks/${id}`, { method: 'DELETE' });
  fetchTasks();
}

/* ================= INLINE EDIT ================= */
function editTask(icon) {
  const card = icon.closest('.task-card');
  const id = Number(card.dataset.id);

  const titleDiv = card.querySelector('.task-title');
  const deadlineDiv = card.querySelector('.task-deadline');

  const oldTitle = titleDiv.innerText;
  const oldDeadlineText = deadlineDiv.innerText.replace('⌛', '').trim();

  const task = state.tasks.find(t => t.id === id);

  /* ===== title input ===== */
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.value = oldTitle;
  titleInput.className = 'edit-input';

  titleDiv.replaceWith(titleInput);

  /* ===== deadline input ===== */
  const deadlineInput = document.createElement('input');
  deadlineInput.type = 'datetime-local';
  deadlineInput.className = 'edit-input';

  if (task.deadline) {
  const d = new Date(task.deadline);

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');

  deadlineInput.value = `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}


  deadlineDiv.replaceWith(deadlineInput);

  titleInput.focus();

  /* ===== icon save ===== */
  icon.classList.remove('fa-pen-to-square');
  icon.classList.add('fa-floppy-disk');

  icon.onclick = () =>
    saveEdit(icon, id, titleInput, deadlineInput, oldTitle, oldDeadlineText);

  /* ===== keyboard ===== */
  titleInput.onkeydown = deadlineInput.onkeydown = e => {
    if (e.key === 'Enter')
      saveEdit(icon, id, titleInput, deadlineInput, oldTitle, oldDeadlineText);
    if (e.key === 'Escape')
      cancelEdit(icon, titleInput, deadlineInput, oldTitle, oldDeadlineText);
  };
}

async function saveEdit(icon, id, titleInput, deadlineInput, oldTitle, oldDeadlineText) {
  const newTitle = titleInput.value.trim();
  if (!newTitle) return alert('Tiêu đề không được rỗng');

  // fix: Chuyển đổi sang iso string (utc) trước khi gửi
  const rawDeadline = deadlineInput.value;
  const newDeadline = rawDeadline ? new Date(rawDeadline).toISOString() : null;
  const task = state.tasks.find(t => t.id === id);
  
  await apiFetch(`/api/tasks/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      ...task,
      title: newTitle,
      deadline: newDeadline
    })
  });

  fetchTasks();
}


function cancelEdit(icon, titleInput, deadlineInput, oldTitle, oldDeadline) {
  const titleDiv = document.createElement('div');
  titleDiv.className = 'task-title';
  titleDiv.innerText = oldTitle;

  const deadlineDiv = document.createElement('small');
  deadlineDiv.className = 'task-deadline';
  deadlineDiv.innerText = `⌛ ${oldDeadline}`;

  titleInput.replaceWith(titleDiv);
  deadlineInput.replaceWith(deadlineDiv);

  icon.classList.remove('fa-floppy-disk');
  icon.classList.add('fa-pen-to-square');
  icon.onclick = () => editTask(icon);
}


/* ================= LOGOUT ================= */
$('logout-btn').onclick = () => {
  clearAuth();
  location.reload();
};

/* expose for inline html */
Object.assign(window, { toggle, del, editTask });
