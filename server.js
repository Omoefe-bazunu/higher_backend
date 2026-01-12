require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const admin = require("firebase-admin");
const multer = require("multer");
const { Resend } = require("resend");

const app = express();
const resend = new Resend(process.env.RESEND_API_KEY);
const upload = multer({ storage: multer.memoryStorage() });

// CORS Configuration
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

// Firebase Admin Initialization
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
  } else if (fs.existsSync("./serviceAccountKey.json")) {
    serviceAccount = require("./serviceAccountKey.json");
  }

  if (!admin.apps.length && serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: "high-481fd.firebasestorage.app",
    });
    console.log("✅ Firebase Admin Initialized");
  }
} catch (err) {
  console.error("❌ Firebase Init Error:", err);
}

const db = admin.firestore();
const bucket = admin.storage().bucket();

// Manual Enrollment Route
app.post(
  "/api/enrollments/submit",
  upload.single("receipt"),
  async (req, res) => {
    try {
      const { courseId, courseTitle, userId, userEmail, userName, amountPaid } =
        req.body;
      const file = req.file;

      if (!file) return res.status(400).json({ error: "No receipt uploaded" });

      const fileName = `receipts/${userId}_${Date.now()}_${file.originalname}`;
      const blob = bucket.file(fileName);
      const blobStream = blob.createWriteStream({
        metadata: { contentType: file.mimetype },
        resumable: false,
      });

      blobStream.on("error", (err) =>
        res.status(500).json({ error: err.message })
      );

      blobStream.on("finish", async () => {
        await blob.makePublic();
        const receiptUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

        const enrollmentData = {
          courseId,
          courseTitle,
          userId,
          userEmail,
          amountPaid: parseFloat(amountPaid),
          receiptUrl,
          status: "pending", // Always starts as pending for admin approval
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        await db.collection("enrollments").add(enrollmentData);

        try {
          await resend.emails.send({
            from: "HIGH-ER Training <info@higher.com.ng>",
            to: "raniem57@gmail.com",
            subject: `Enrollment: ${courseTitle} - ${userName}`,
            text: `Student: ${userName}\nEmail: ${userEmail}\nAmount: ₦${amountPaid}\nReceipt: ${receiptUrl}`,
          });
        } catch (e) {
          console.warn("Email notify failed");
        }

        res.json({ success: true });
      });

      blobStream.end(file.buffer);
    } catch (err) {
      res.status(500).json({ error: "Server Error" });
    }
  }
);

// Add this route to your server.js
app.post("/api/enrollments/request-certificate", async (req, res) => {
  try {
    const { enrollmentId, userEmail, userName, courseTitle } = req.body;

    // 1. Update status in Firestore to 'certificate_requested'
    await db.collection("enrollments").doc(enrollmentId).update({
      certificateStatus: "requested",
      requestedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 2. Notify Admin via Resend
    await resend.emails.send({
      from: "HIGH-ER Training <info@higher.com.ng>",
      to: "raniem57@gmail.com",
      subject: `🏆 Certificate Request: ${userName}`,
      text: `
        New Certificate Request!
        
        Student: ${userName}
        Email: ${userEmail}
        Track: ${courseTitle}
        
        Action Required: 
        1. Design the certificate for this student.
        2. Email it to ${userEmail}.
        3. Mark as 'Certified' in the Admin Dashboard.
      `,
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to process request" });
  }
});

// Add this to your server.js
app.post("/api/enrollments/toggle-progress", async (req, res) => {
  try {
    const { enrollmentId, lessonTitle, isDone } = req.body;

    if (!enrollmentId || !lessonTitle) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const enrollRef = db.collection("enrollments").doc(enrollmentId);

    if (isDone) {
      // If it was already done, remove it (uncheck)
      await enrollRef.update({
        completedLessons: admin.firestore.FieldValue.arrayRemove(lessonTitle),
      });
    } else {
      // If not done, add it (check)
      await enrollRef.update({
        completedLessons: admin.firestore.FieldValue.arrayUnion(lessonTitle),
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Progress Update Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
