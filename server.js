const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");
const db = require("./db");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_THIS_SECRET_FOR_PRODUCTION";

/* =====================
   EMAIL SETUP
===================== */

const nodemailer = require("nodemailer");

const mailer = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});


/* =====================
   MIDDLEWARE
===================== */
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

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
    req.user = payload; // { userId, email }
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/* =====================
   ROOT
===================== */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
app.post("/api/register/request-otp", async (req, res) => {
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

  await mailer.sendMail({
    to: email,
    subject: "Mã xác thực đăng ký",
    html: `<h2>Mã OTP của bạn là <b>${otp}</b></h2>
           <p>Có hiệu lực 5 phút</p>`
  });

  res.json({ success: true });
});

app.post("/api/register/verify-otp", async (req, res) => {
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
});



// /* =====================
//    REGISTER
// ===================== */
// app.post("/api/register", async (req, res) => {
//   const { email, password } = req.body;
//   if (!email || !password)
//     return res.status(400).json({ error: "Vui lòng nhập email và mật khẩu" });

//   try {
//     const exists = await db.query(
//       "SELECT id FROM users WHERE email = $1",
//       [email]
//     );
//     if (exists.rows.length > 0)
//       return res.status(400).json({ error: "Email đã tồn tại" });

//     const hash = await bcrypt.hash(password, 10);

//     await db.query(
//       "INSERT INTO users(email, password_hash) VALUES ($1, $2)",
//       [email, hash]
//     );

//     res.json({ message: "Đăng ký thành công" });
//   } catch (err) {
//     console.error("REGISTER ERROR:", err.message);
//     res.status(500).json({ error: err.message });
//   }
// });

/* =====================
   LOGIN
===================== */
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Vui lòng nhập đầy đủ email và mật khẩu" });

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
    console.error("LOGIN ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* =====================
   GET TASKS
===================== */
app.get("/api/tasks", authenticate, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id,
              title,
              description,
              completed,
              deadline
       FROM tasks
       WHERE user_id = $1
       ORDER BY id DESC`,
      [req.user.userId]
    );

    res.json({ tasks: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fetch tasks failed" });
  }
});

/* =====================
   CREATE TASK
===================== */
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Create task failed" });
  }
});

/* =====================
   UPDATE TASK
===================== */
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Update failed" });
  }
});

/* =====================
   DELETE TASK
===================== */
app.delete("/api/tasks/:id", authenticate, async (req, res) => {
  try {
    await db.query(
      "DELETE FROM tasks WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user.userId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Delete failed" });
  }
});

/* =====================
   REMINDER EMAILS
===================== */

async function sendReminderEmail(email, task) {
  await mailer.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: "⏰ Nhắc việc Todo List",
    text: `Công việc "${task.title}" sẽ đến hạn lúc ${new Date(task.deadline).toLocaleString("vi-VN")}`
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
  AI NLP (Gemini)
===================== */
const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post("/api/nlp", authenticate, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "Text is required" });

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // Lấy thời gian hiện tại để AI hiểu "ngày mai", "tuần sau" là bao giờ
    const nowVN = new Date().toLocaleString("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh"
});
;
    
    const prompt = `
      Bạn là một trợ lý ảo quản lý công việc (Todo API).
Nhiệm vụ: Phân tích câu nói của người dùng và trích xuất thông tin thời gian dựa trên ngữ cảnh hiện tại.

THÔNG TIN QUAN TRỌNG (Context):
- Thời gian hiện tại chính xác là: ${nowVN} (Múi giờ GMT+7) 
- Ngày tháng năm hiện tại là: ${new Date().getFullYear()}.
- Mọi mốc thời gian (hôm nay, ngày mai, cuối tuần) PHẢI tính toán dựa trên thời gian này.
- Nếu không xác định được title, hãy tạo title ngắn gọn từ nội dung người dùng.


INPUT: "${text}"

OUTPUT JSON FORMAT (Chỉ trả về JSON thuần, không markdown):
{
  "title": "Tên công việc ngắn gọn",
  "description": "Chi tiết nếu có, hoặc null",
  "deadline": "ISO 8601 String (YYYY-MM-DDTHH:mm:ss+07:00)",
  "due_date": "YYYY-MM-DD HH:mm:ss",
  "reminded": false
}
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let textResponse = response.text();

    // Làm sạch chuỗi nếu AI lỡ trả về format markdown (```json ...)
    textResponse = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();

    const data = JSON.parse(textResponse);

    res.json({
      title: data.title || text, // Fallback nếu AI không tách được title
      deadline: data.deadline
    });

  } catch (err) {
    console.error("NLP ERROR:", err);
    // Fallback về logic cũ nếu AI lỗi hoặc hết quota
    res.json({
      title: text,
      deadline: null
    });
  }
});

/* =====================
   START SERVER
===================== */
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
