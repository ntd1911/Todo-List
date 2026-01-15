const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("./db");
require("dotenv").config();

const { Resend } = require("resend");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_THIS_SECRET_FOR_PRODUCTION";

/* =====================
   RESEND SETUP
===================== */
const resend = new Resend(process.env.RESEND_API_KEY);
const EMAIL_FROM = process.env.EMAIL_FROM || "onboarding@resend.dev";

/* =====================
   MIDDLEWARE
===================== */
app.use(cors());
app.use(express.json());

/* =====================
   AUTH MIDDLEWARE
===================== */
function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth)
    return res.status(401).json({ error: "Missing Authorization header" });

  const [type, token] = auth.split(" ");
  if (type !== "Bearer" || !token)
    return res.status(401).json({ error: "Invalid Authorization format" });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/* =====================
   ROOT
===================== */
app.get("/", (req, res) => {
  res.json({
    status: "OK",
    message: "Backend API running"
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
      return res.status(400).json({ error: "Thiếu email hoặc mật khẩu" });

    const exists = await db.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );
    if (exists.rows.length > 0)
      return res.status(400).json({ error: "Email đã được đăng ký" });

    const passwordHash = await bcrypt.hash(password, 10);
    const otp = generateOTP();
    const expires = new Date(Date.now() + 5 * 60 * 1000);

    await db.query(
      "UPDATE email_otps SET verified = true WHERE email = $1",
      [email]
    );

    await db.query(
      `INSERT INTO email_otps (email, otp, expires_at, password_hash)
       VALUES ($1, $2, $3, $4)`,
      [email, otp, expires, passwordHash]
    );

    await resend.emails.send({
      from: EMAIL_FROM,
      to: email,
      subject: "Mã xác thực đăng ký",
      html: `
        <h2>Mã OTP của bạn: <b>${otp}</b></h2>
        <p>Có hiệu lực trong 5 phút</p>
      `
    });

    res.json({ success: true });

  } catch (err) {
    console.error("OTP ERROR:", err);
    res.status(500).json({ error: "Không gửi được email" });
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
       WHERE email = $1 AND otp = $2 AND verified = false
       ORDER BY created_at DESC
       LIMIT 1`,
      [email, String(otp).trim()]
    );

    if (result.rows.length === 0)
      return res.status(400).json({ error: "OTP không đúng" });

    const record = result.rows[0];

    if (new Date() > record.expires_at)
      return res.status(400).json({ error: "OTP đã hết hạn" });

    await db.query(
      "UPDATE email_otps SET verified = true WHERE id = $1",
      [record.id]
    );

    await db.query(
      "INSERT INTO users(email, password_hash) VALUES ($1, $2)",
      [email, record.password_hash]
    );

    res.json({ success: true });

  } catch (err) {
    console.error("VERIFY OTP ERROR:", err);
    res.status(500).json({ error: "Xác thực thất bại" });
  }
});

/* =====================
   LOGIN
===================== */
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Thiếu email hoặc mật khẩu" });

  try {
    const result = await db.query(
      "SELECT id, password_hash FROM users WHERE email = $1",
      [email]
    );
    if (result.rows.length === 0)
      return res.status(400).json({ error: "Không tìm thấy tài khoản" });

    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(400).json({ error: "Sai mật khẩu" });

    const token = jwt.sign(
      { userId: user.id, email },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ token, email });

  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

/* =====================
   TASK APIs
===================== */
app.get("/api/tasks", authenticate, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM tasks
       WHERE user_id = $1
       ORDER BY id DESC`,
      [req.user.userId]
    );

    res.json({ tasks: result.rows });
  } catch {
    res.status(500).json({ error: "Fetch tasks failed" });
  }
});

app.post("/api/tasks", authenticate, async (req, res) => {
  const { title, description, deadline } = req.body;

  try {
    const result = await db.query(
      `INSERT INTO tasks(user_id, title, description, deadline)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [
        req.user.userId,
        title,
        description || null,
        deadline || null
      ]
    );

    res.json({ id: result.rows[0].id });
  } catch {
    res.status(500).json({ error: "Create task failed" });
  }
});

app.put("/api/tasks/:id", authenticate, async (req, res) => {
  const { title, description, deadline, completed } = req.body;

  try {
    await db.query(
      `UPDATE tasks
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           deadline = COALESCE($3, deadline),
           completed = COALESCE($4, completed)
       WHERE id = $5 AND user_id = $6`,
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
  } catch {
    res.status(500).json({ error: "Update failed" });
  }
});

app.delete("/api/tasks/:id", authenticate, async (req, res) => {
  try {
    await db.query(
      "DELETE FROM tasks WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user.userId]
    );

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Delete failed" });
  }
});

/* =====================
   REMINDER EMAIL
===================== */
async function sendReminderEmail(email, task) {
  await resend.emails.send({
    from: EMAIL_FROM,
    to: email,
    subject: "⏰ Nhắc việc",
    html: `
      <p>Công việc <b>${task.title}</b> 
      đến hạn lúc ${new Date(task.deadline).toLocaleString("vi-VN")}</p>
    `
  });
}

const cron = require("node-cron");

cron.schedule("* * * * *", async () => {
  try {
    const result = await db.query(`
      SELECT t.id, t.title, t.deadline, u.email
      FROM tasks t
      JOIN users u ON t.user_id = u.id
      WHERE t.completed = false
        AND t.reminded = false
        AND t.deadline IS NOT NULL
        AND t.deadline <= NOW() + INTERVAL '10 minutes'
        AND t.deadline > NOW()
    `);

    for (const task of result.rows) {
      await sendReminderEmail(task.email, task);
      await db.query(
        "UPDATE tasks SET reminded = true WHERE id = $1",
        [task.id]
      );
    }
  } catch (err) {
    console.error("CRON ERROR:", err.message);
  }
});

/* =====================
   START
===================== */
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
