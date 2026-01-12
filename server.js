require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const admin = require("firebase-admin");
const multer = require("multer"); // Added for file handling
const { Resend } = require("resend");

const app = express();
const resend = new Resend(process.env.RESEND_API_KEY);

// Set up Multer (temporary storage for incoming files)
const upload = multer({ storage: multer.memoryStorage() });

// ==========================================
// 1. CORS CONFIGURATION
// ==========================================
const allowedOrigins = [
  process.env.CLIENT_ORIGIN,
  "http://localhost:3000",
  "http://localhost:9002",
  "https://higher.com.ng",
  "https://www.higher.com.ng",
].filter(Boolean);

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (
        allowedOrigins.indexOf(origin) !== -1 ||
        process.env.NODE_ENV === "development"
      ) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

// ==========================================
// 2. FIREBASE ADMIN INITIALIZATION
// ==========================================
let serviceAccount;
try {
  if (
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH &&
    fs.existsSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
  ) {
    serviceAccount = JSON.parse(
      fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, "utf8")
    );
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  }

  if (!admin.apps.length && serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: "high-48d.firebasestorage.app", // Make sure this matches your project ID
    });
    console.log("✅ Firebase Admin Initialized");
  }
} catch (err) {
  console.error("❌ Firebase Init Error", err);
  process.exit(1);
}

const db = admin.firestore();
const bucket = admin.storage().bucket();

// ==========================================
// 3. MANUAL ENROLLMENT SYSTEM
// ==========================================

app.post(
  "/api/enrollments/submit",
  upload.single("receipt"),
  async (req, res) => {
    try {
      const { courseId, courseTitle, userId, userEmail, userName, amountPaid } =
        req.body;
      const file = req.file;

      if (!file)
        return res.status(400).json({ error: "No receipt file uploaded" });

      // 1. Upload to Firebase Storage via Backend
      const fileName = `receipts/${userId}_${Date.now()}_${file.originalname}`;
      const blob = bucket.file(fileName);
      const blobStream = blob.createWriteStream({
        metadata: { contentType: file.mimetype },
      });

      blobStream.on("error", (err) =>
        res.status(500).json({ error: err.message })
      );

      blobStream.on("finish", async () => {
        // Get the Public URL
        await blob.makePublic();
        const receiptUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

        // 2. Create Firestore Record
        const enrollmentData = {
          courseId,
          courseTitle,
          userId,
          userEmail,
          amountPaid: parseFloat(amountPaid),
          receiptUrl,
          status: "pending",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        await db.collection("enrollments").add(enrollmentData);

        // 3. Send Email Notification via Resend
        await resend.emails.send({
          from: "HIGH-ER Training <info@higher.com.ng>",
          to: "raniem57@gmail.com",
          subject: `New Enrollment: ${courseTitle} - ${userName}`,
          text: `Student: ${userName}\nEmail: ${userEmail}\nAmount: ₦${amountPaid}\nView Receipt: ${receiptUrl}`,
        });

        res.json({ success: true });
      });

      blobStream.end(file.buffer);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

app.get("/", (req, res) => res.send("HIGH-ER Backend Active 🚀"));
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));
