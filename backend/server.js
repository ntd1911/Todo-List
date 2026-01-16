const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("./db");
require("dotenv").config();
const { Resend } = require("resend");
const cron = require("node-cron");

const app = express();
const PORT = process.env.PORT || 10000; // Render dùng PORT
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
app.use(cors());
app.use(express.json());

/* =====================
   AUTH
===================== */
function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth)
    return res.status(401).json({ error: "Missing token" });

  const [type, token] = auth.split(" ");
  if (type !== "Bearer" || !token)
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
   OTP
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

  } catch (e) {
    console.error(e);
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

  } catch (e) {
    console.error(e);
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

/* =====================
   CRON
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
   START
===================== */
app.listen(PORT, () => {
  console.log(`🚀 Server running at port ${PORT}`);
});
