const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("./db");
require("dotenv").config();
const { Resend } = require("resend");
const cron = require("node-cron");

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET;

/* =====================
   CHECK ENV
===================== */
if (!JWT_SECRET) {
  console.error("❌ Missing JWT_SECRET in .env");
  process.exit(1);
}

/* =====================
   RESEND - IMPROVED
===================== */
const resend = new Resend(process.env.RESEND_API_KEY);
const EMAIL_FROM = process.env.EMAIL_FROM || "Todo App <onboarding@resend.dev>";

// Kiểm tra cấu hình Resend
if (!process.env.RESEND_API_KEY) {
  console.error("⚠️  WARNING: RESEND_API_KEY not found in .env");
}
console.log("📧 Email configured from:", EMAIL_FROM);

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
   REQUEST OTP - IMPROVED
===================== */
app.post("/api/register/request-otp", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: "Thiếu dữ liệu" });

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Email không hợp lệ" });
    }

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

    // Improved email sending with better error handling
    try {
      const { data, error } = await resend.emails.send({
        from: EMAIL_FROM,
        to: email,
        subject: "Mã OTP đăng ký Todo App",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #667eea;">Mã OTP của bạn</h2>
            <p>Sử dụng mã OTP sau để hoàn tất đăng ký:</p>
            <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; text-align: center;">
              <h1 style="color: #667eea; letter-spacing: 5px; margin: 0;">${otp}</h1>
            </div>
            <p style="color: #666; margin-top: 20px;">Mã này có hiệu lực trong 5 phút.</p>
            <p style="color: #999; font-size: 12px;">Nếu bạn không yêu cầu mã này, vui lòng bỏ qua email.</p>
          </div>
        `
      });

      if (error) {
        console.error("❌ Resend API error:", error);
        return res.status(500).json({ 
          error: "Không thể gửi email. Vui lòng thử lại.",
          details: error.message 
        });
      }

      console.log("✅ Email sent successfully:", data);
      res.json({ success: true, message: "Mã OTP đã được gửi" });

    } catch (emailError) {
      console.error("❌ Email sending failed:", emailError);
      return res.status(500).json({ 
        error: "Lỗi khi gửi email",
        details: emailError.message 
      });
    }

  } catch (e) {
    console.error("❌ Server error:", e);
    res.status(500).json({ error: "Lỗi server" });
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
      return res.status(400).json({ error: "OTP sai hoặc đã được sử dụng" });

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
  try {
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
      try {
        const { error } = await resend.emails.send({
          from: EMAIL_FROM,
          to: t.email,
          subject: "⏰ Nhắc việc - Todo App",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #667eea;">⏰ Nhắc nhở công việc</h2>
              <div style="background: #fff3cd; padding: 15px; border-left: 4px solid #ffc107; border-radius: 4px;">
                <p style="margin: 0; font-size: 16px;"><strong>${t.title}</strong></p>
                <p style="margin: 5px 0 0 0; color: #666;">Deadline: ${new Date(t.deadline).toLocaleString('vi-VN')}</p>
              </div>
            </div>
          `
        });

        if (error) {
          console.error(`❌ Failed to send reminder to ${t.email}:`, error);
          continue;
        }

        await db.query(
          "UPDATE tasks SET reminded=true WHERE id=$1",
          [t.id]
        );
        
        console.log(`✅ Reminder sent to ${t.email} for task: ${t.title}`);
      } catch (err) {
        console.error(`❌ Error sending reminder:`, err);
      }
    }
  } catch (err) {
    console.error("❌ Cron job error:", err);
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

    const nowVN = new Date().toLocaleString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh"
    });
    
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

    textResponse = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();

    const data = JSON.parse(textResponse);

    res.json({
      title: data.title || text,
      deadline: data.deadline
    });

  } catch (err) {
    console.error("NLP ERROR:", err);
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