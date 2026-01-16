const API = "https://todoapp-tgd4.onrender.com";

const state = {
  token: localStorage.getItem("token"),
  user: localStorage.getItem("currentUser"),
  tasks: []
};

const $ = id => document.getElementById(id);

/* ===== AUTH ===== */
$("btn-login").onclick = async () => {
  const email = $("auth-email").value;
  const password = $("auth-pass").value;

  const res = await apiFetch("/api/login",{
    method:"POST",
    body:JSON.stringify({email,password})
  });

  if(res.error) return alert(res.error);

  saveAuth(res.email,res.token);
  showApp();
};

$("switch-register").onclick = ()=>toggleAuth(false);
$("switch-login").onclick = ()=>toggleAuth(true);

function toggleAuth(showLogin){
  $("auth-container").classList.toggle("hidden",!showLogin);
  $("register-container").classList.toggle("hidden",showLogin);
}

function showApp(){
  $("auth-container").classList.add("hidden");
  $("register-container").classList.add("hidden");
  $("app").classList.remove("hidden");
  fetchTasks();
}

/* ===== OTP ===== */
$("btn-send-otp").onclick = async ()=>{
  const email = $("reg-email").value.trim();
  const password = $("reg-pass").value;

  const res = await apiFetch("/api/register/request-otp",{
    method:"POST",
    body:JSON.stringify({email,password})
  });

  if(res.error) return alert(res.error);

  $("reg-otp").classList.remove("hidden");
  $("btn-verify-otp").classList.remove("hidden");
  $("btn-resend-otp").classList.remove("hidden");
};

$("btn-verify-otp").onclick = async ()=>{
  const email = $("reg-email").value;
  const otp = $("reg-otp").value;

  const res = await apiFetch("/api/register/verify-otp",{
    method:"POST",
    body:JSON.stringify({email,otp})
  });

  if(res.error) return alert(res.error);
  alert("Đăng ký thành công");
  toggleAuth(true);
};

/* ===== TASK ===== */
$("add-btn").onclick = async ()=>{
  const title = $("task-input").value;
  const deadline = $("deadline-input").value;

  await apiFetch("/api/tasks",{
    method:"POST",
    body:JSON.stringify({
      title,
      deadline:deadline?new Date(deadline).toISOString():null
    })
  });

  fetchTasks();
};

$("nlp-btn").onclick = async ()=>{
  const text = $("nlp-input").value;

  const data = await apiFetch("/api/nlp",{
    method:"POST",
    body:JSON.stringify({text})
  });

  await apiFetch("/api/tasks",{
    method:"POST",
    body:JSON.stringify(data)
  });

  fetchTasks();
};

async function fetchTasks(){
  const r = await apiFetch("/api/tasks");
  state.tasks = r.tasks||[];
  render();
}

function render(){
  $("task-list").innerHTML =
  state.tasks.map(t=>`
    <div class="task-card">
      <div class="task-title ${t.completed?"completed":""}">
        ${t.title}
      </div>
      <i class="fa fa-trash" onclick="del(${t.id})"></i>
    </div>
  `).join("");
}

async function del(id){
  await apiFetch(`/api/tasks/${id}`,{method:"DELETE"});
  fetchTasks();
}

/* ===== UTILS ===== */
async function apiFetch(path,opt={}){
  const h={
    "Content-Type":"application/json",
    ...(state.token&&{Authorization:`Bearer ${state.token}`})
  };
  const r=await fetch(API+path,{...opt,headers:h});
  return r.json();
}

function saveAuth(email,token){
  state.user=email;
  state.token=token;
  localStorage.setItem("token",token);
  localStorage.setItem("currentUser",email);
}
