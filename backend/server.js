const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("./db");
require("dotenv").config();
const { Resend } = require("resend");
const cron = require("node-cron");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

/* =====================
   CHECK ENV
===================== */
if (!JWT_SECRET) {
  console.error("❌ Missing JWT_SECRET in .env");
  process.exit(1);
}

/* =====================
   RESEND
===================== */
const resend = new Resend(process.env.RESEND_API_KEY);
const EMAIL_FROM = process.env.EMAIL_FROM;

/* =====================
   MIDDLEWARE
===================== */
app.use(cors({
  origin: "*"
}));
app.use(express.json());

/* =====================
   AUTH MIDDLEWARE
===================== */
function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth)
    return res.status(401).json({ error: "Missing token" });

  const [type, token] = auth.split(" ");
  if (type !== "Bearer")
    return res.status(401).json({ error: "Invalid token" });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Token expired" });
  }
}

/* =====================
   ROOT
===================== */
app.get("/", (req, res) => {
  res.json({
    status: "OK",
    message: "Todo API running"
  });
});

/* =====================
   OTP UTILS
===================== */
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/* =====================
   REQUEST OTP
===================== */
app.post("/api/register/request-otp", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: "Thiếu dữ liệu" });

    const exists = await db.query(
      "SELECT id FROM users WHERE email=$1",
      [email]
    );

    if (exists.rows.length)
      return res.status(400).json({ error: "Email đã tồn tại" });

    const hash = await bcrypt.hash(password, 10);
    const otp = generateOTP();
    const expires = new Date(Date.now() + 5 * 60000);

    await db.query(
      "UPDATE email_otps SET verified=true WHERE email=$1",
      [email]
    );

    await db.query(
      `INSERT INTO email_otps(email,otp,expires_at,password_hash)
       VALUES($1,$2,$3,$4)`,
      [email, otp, expires, hash]
    );

    await resend.emails.send({
      from: EMAIL_FROM,
      to: email,
      subject: "Mã OTP",
      html: `<h2>OTP: ${otp}</h2>`
    });

    res.json({ success: true });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Send OTP fail" });
  }
});

/* =====================
   VERIFY OTP
===================== */
app.post("/api/register/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;

    const result = await db.query(
      `SELECT * FROM email_otps
       WHERE email=$1 AND otp=$2 AND verified=false
       ORDER BY created_at DESC LIMIT 1`,
      [email, otp]
    );

    if (!result.rows.length)
      return res.status(400).json({ error: "OTP sai" });

    const record = result.rows[0];

    if (new Date() > record.expires_at)
      return res.status(400).json({ error: "OTP hết hạn" });

    await db.query(
      "UPDATE email_otps SET verified=true WHERE id=$1",
      [record.id]
    );

    await db.query(
      "INSERT INTO users(email,password_hash) VALUES($1,$2)",
      [email, record.password_hash]
    );

    res.json({ success: true });

  } catch {
    res.status(500).json({ error: "Verify fail" });
  }
});

/* =====================
   LOGIN
===================== */
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await db.query(
      "SELECT id,password_hash FROM users WHERE email=$1",
      [email]
    );

    if (!result.rows.length)
      return res.status(400).json({ error: "Không tồn tại" });

    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);

    if (!ok)
      return res.status(400).json({ error: "Sai mật khẩu" });

    const token = jwt.sign(
      { userId: user.id, email },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ token, email });

  } catch {
    res.status(500).json({ error: "Login fail" });
  }
});

/* =====================
   TASKS
===================== */
app.get("/api/tasks", authenticate, async (req, res) => {
  const r = await db.query(
    "SELECT * FROM tasks WHERE user_id=$1 ORDER BY id DESC",
    [req.user.userId]
  );

  res.json({ tasks: r.rows });
});

app.post("/api/tasks", authenticate, async (req, res) => {
  const { title, description, deadline } = req.body;

  const r = await db.query(
    `INSERT INTO tasks(user_id,title,description,deadline)
     VALUES($1,$2,$3,$4) RETURNING id`,
    [
      req.user.userId,
      title,
      description || null,
      deadline || null
    ]
  );

  res.json({ id: r.rows[0].id });
});

app.put("/api/tasks/:id", authenticate, async (req, res) => {
  const { title, description, deadline, completed } = req.body;

  await db.query(
    `UPDATE tasks SET
     title=COALESCE($1,title),
     description=COALESCE($2,description),
     deadline=COALESCE($3,deadline),
     completed=COALESCE($4,completed)
     WHERE id=$5 AND user_id=$6`,
    [
      title ?? null,
      description ?? null,
      deadline ?? null,
      completed ?? null,
      req.params.id,
      req.user.userId
    ]
  );

  res.json({ success: true });
});

app.delete("/api/tasks/:id", authenticate, async (req, res) => {
  await db.query(
    "DELETE FROM tasks WHERE id=$1 AND user_id=$2",
    [req.params.id, req.user.userId]
  );

  res.json({ success: true });
});

/* =====================
   CRON REMINDER
===================== */
cron.schedule("* * * * *", async () => {
  const r = await db.query(`
    SELECT t.id,t.title,t.deadline,u.email
    FROM tasks t
    JOIN users u ON t.user_id=u.id
    WHERE t.completed=false
    AND t.reminded=false
    AND t.deadline <= NOW()+INTERVAL '10 minutes'
    AND t.deadline > NOW()
  `);

  for (const t of r.rows) {
    await resend.emails.send({
      from: EMAIL_FROM,
      to: t.email,
      subject: "⏰ Nhắc việc",
      html: `<b>${t.title}</b>`
    });

    await db.query(
      "UPDATE tasks SET reminded=true WHERE id=$1",
      [t.id]
    );
  }
});

/* =====================
   START
===================== */
app.listen(PORT, () => {
  console.log("🚀 Server:", PORT);
});
