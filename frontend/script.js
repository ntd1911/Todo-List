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
let otpExpireSeconds = 300;
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
  const headers = {
    'Content-Type': 'application/json',
    ...(state.token && { Authorization: `Bearer ${state.token}` })
  };

  let res;
  try {
    res = await fetch(API + path, { ...options, headers });
  } catch {
    alert('Không kết nối được server');
    return { error: 'Network error' };
  }

  if (res.status === 401) {
    alert('Phiên đăng nhập hết hạn');
    clearAuth();
    location.reload();
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data.error || 'Lỗi server' };

  return data;
}

/* ================= AUTH ================= */
$('btn-login').onclick = async () => {
  const email = $('auth-email').value;
  const password = $('auth-pass').value;

  if (!email || !password) return alert('Nhập đủ thông tin');

  const data = await apiFetch('/api/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });

  if (data.error) return alert(data.error);
  saveAuth(data.email, data.token);
  showApp();
};

$('btn-send-otp').onclick = async () => {
  const email = $('reg-email').value.trim();
  const password = $('reg-pass').value;

  if (!email || !password)
    return alert('Thiếu email hoặc mật khẩu');

  const data = await apiFetch('/api/register/request-otp', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });

  if (data.error) return alert(data.error);

  alert('Đã gửi OTP');
  $('reg-otp').classList.remove('hidden');
  $('btn-verify-otp').classList.remove('hidden');
  $('btn-resend-otp').classList.remove('hidden');
  startOtpCooldown();
  startOtpExpireTimer();
  $('btn-send-otp').classList.add('hidden');
};

$('btn-verify-otp').onclick = async () => {
  const email = $('reg-email').value.trim();
  const otp = $('reg-otp').value.trim();

  if (!otp) return alert('Nhập OTP');

  const data = await apiFetch('/api/register/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ email, otp })
  });

  if (data.error) return alert(data.error);

  alert('Đăng ký thành công');
  toggleAuth(true);
};

$('btn-resend-otp').onclick = async () => {
  const email = $('reg-email').value.trim();
  const password = $('reg-pass').value;

  const data = await apiFetch('/api/register/request-otp', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });

  if (data.error) return alert(data.error);

  alert('Đã gửi lại OTP');
  startOtpCooldown();
  startOtpExpireTimer();
};

/* ================= UI ================= */
$('switch-register').onclick = () => toggleAuth(false);
$('switch-login').onclick = () => toggleAuth(true);

function toggleAuth(showLogin) {
  $('auth-container').classList.toggle('hidden', !showLogin);
  $('register-container').classList.toggle('hidden', showLogin);
}

function showApp() {
  $('auth-container').classList.add('hidden');
  $('register-container').classList.add('hidden');
  $('app').classList.remove('hidden');

  applyUIStyle();
  fetchTasks();
}

if (state.token && state.user) showApp();

/* ================= STYLE PATCH ================= */
function applyUIStyle() {

  ['task-input','deadline-input','nlp-input']
  .forEach(id=>{
    const el=$(id);
    if(!el) return;

    el.style.borderRadius="12px";
    el.style.padding="10px 12px";
    el.style.border="1px solid #ddd";
    el.style.transition="0.25s";

    el.onfocus=()=>{
      el.style.border="1px solid #4f46e5";
      el.style.boxShadow="0 0 0 2px rgba(79,70,229,.2)";
    };
    el.onblur=()=>{
      el.style.border="1px solid #ddd";
      el.style.boxShadow="none";
    };
  });

  const logout=$('logout-btn');
  if(logout){
    logout.style.padding="6px 14px";
    logout.style.borderRadius="20px";
    logout.style.background="#ff4d4f";
    logout.style.color="#fff";
    logout.style.border="none";
    logout.style.fontSize="13px";
    logout.style.cursor="pointer";
    logout.style.transition=".25s";

    logout.onmouseenter=()=>{
      logout.style.background="#ff7875";
      logout.style.transform="scale(1.05)";
    };
    logout.onmouseleave=()=>{
      logout.style.background="#ff4d4f";
      logout.style.transform="scale(1)";
    };
  }
}

/* ================= TASK ================= */
async function fetchTasks() {
  const data = await apiFetch('/api/tasks');
  state.tasks = data.tasks || [];
  render();
}

$('add-btn').onclick = async () => {
  const title = $('task-input').value.trim();
  const deadline = $('deadline-input').value;

  if (!title) return alert('Nhập tên công việc');

  await apiFetch('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title,
      deadline: deadline ? new Date(deadline).toISOString() : null
    })
  });

  $('task-input').value='';
  $('deadline-input').value='';
  fetchTasks();
};

$('nlp-btn').onclick = async () => {
  const text = $('nlp-input').value.trim();
  if(!text) return;

  const data = await apiFetch('/api/nlp',{
    method:'POST',
    body:JSON.stringify({text})
  });

  await apiFetch('/api/tasks',{
    method:'POST',
    body:JSON.stringify(data)
  });

  $('nlp-input').value='';
  fetchTasks();
};

/* ================= RENDER ================= */
$('filter').onchange=$('filter-date').onchange=render;

function render(){
  const st=$('filter').value;
  const d=$('filter-date').value;

  $('task-list').innerHTML=
  state.tasks
  .filter(t=>
    st==='completed'?t.completed:
    st==='pending'?!t.completed:true
  )
  .filter(t=>!d||(t.deadline||'').startsWith(d))
  .map(t=>`
  <div class="task-card">
    <div>
      <input type="checkbox"
        ${t.completed?'checked':''}
        onclick="toggle(${t.id})">
      ${t.title}
    </div>
    <i class="fa fa-trash"
      onclick="del(${t.id})"></i>
  </div>`).join('');
}

/* ================= OPS ================= */
async function toggle(id){
  const t=state.tasks.find(x=>x.id===id);
  t.completed=!t.completed;
  render();

  await apiFetch(`/api/tasks/${id}`,{
    method:'PUT',
    body:JSON.stringify({completed:t.completed})
  });
}

async function del(id){
  await apiFetch(`/api/tasks/${id}`,{method:'DELETE'});
  fetchTasks();
}

/* ================= LOGOUT ================= */
$('logout-btn').onclick=()=>{
  clearAuth();
  location.reload();
};

Object.assign(window,{toggle,del});
