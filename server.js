require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const admin = require("firebase-admin");
const axios = require("axios");

const app = express();

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
    allowedHeaders: ["Content-Type", "Authorization", "verif-hash"],
  })
);

app.use(express.json());

// ==========================================
// 2. FIREBASE ADMIN INITIALIZATION
// ==========================================
let serviceAccount;

try {
  console.log("🔧 Initializing Firebase Admin...");

  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    if (fs.existsSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)) {
      const raw = fs.readFileSync(
        process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
        "utf8"
      );
      serviceAccount = JSON.parse(raw);
      console.log("✅ Service account loaded from ENV path");
    }
  } else if (fs.existsSync("./serviceAccountKey.json")) {
    serviceAccount = require("./serviceAccountKey.json");
    console.log("✅ Service account loaded from local file");
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    console.log("✅ Service account loaded from environment variable");
  }

  if (!admin.apps.length && serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log("✅ Firebase Admin Initialized Successfully");
  } else if (!admin.apps.length) {
    process.exit(1);
  }
} catch (err) {
  process.exit(1);
}

const db = admin.firestore();

// ==========================================
// 3. FLUTTERWAVE PAYMENT API
// ==========================================

// Route: Initialize Payment
app.post("/api/payments/initialize", async (req, res) => {
  const { courseId, email, name, amount } = req.body;

  try {
    const tx_ref = `BASIC_${courseId}_${Date.now()}`;

    const response = await axios.post(
      "https://api.flutterwave.com/v3/payments",
      {
        tx_ref: tx_ref, // Unique reference [cite: 6, 7]
        amount: amount, // Charge amount [cite: 7]
        currency: "NGN", // Default currency [cite: 8]
        redirect_url: `${process.env.CLIENT_ORIGIN}/basic/dashboard?status=success&course=${courseId}`, // Redirect after completion [cite: 9]
        customer: {
          email: email, // Required email [cite: 10]
          name: name,
        },
        // Configuration to handle timeouts and retries [cite: 45, 48]
        configurations: {
          session_duration: 10, // 10 minutes session [cite: 52]
          max_retry_attempt: 5, // 5 retry attempts [cite: 52]
        },
        customizations: {
          title: "HIGH-ER BASIC Training",
          description: "Enrolling in HIGH-ER ENTERPRISES BASIC Course",
          // Use a reliable Firebase Storage URL to prevent TIMEOUT errors
          logo: "https://firebasestorage.googleapis.com/v0/b/high-481fd.firebasestorage.app/o/logop.png?alt=media&token=22625ad4-b6ef-4623-a098-036843cddea3",
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`, // Bearer token auth [cite: 24]
          "Content-Type": "application/json",
        },
      }
    );

    res.json({ success: true, link: response.data.data.link });
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// Route: Webhook
app.post("/api/webhook/flutterwave", async (req, res) => {
  const secretHash = process.env.FLW_SECRET_HASH; // Stored as env variable [cite: 80]
  const signature = req.headers["verif-hash"]; // Check for verif-hash header [cite: 81]

  if (!signature || signature !== secretHash) {
    return res.status(401).end(); // Discard if signature doesn't match [cite: 83]
  }

  const payload = req.body;

  // Handle successful charge events [cite: 75, 76]
  if (
    payload.event === "charge.completed" &&
    payload.data.status === "successful"
  ) {
    const { tx_ref, customer } = payload.data;
    const courseId = tx_ref.split("_")[1];
    const userEmail = customer.email;

    try {
      await db
        .collection("basicCourses")
        .doc(courseId)
        .update({
          students: admin.firestore.FieldValue.arrayUnion(userEmail),
        });
      console.log(`✅ Access Granted: ${userEmail} to ${courseId}`);
    } catch (error) {
      console.error("Webhook Firestore Error:", error);
    }
  }
  res.status(200).end(); // Respond quickly to avoid timeout [cite: 104, 105]
});

// ==========================================
// 4. HEALTH CHECK & START
// ==========================================
app.get("/", (req, res) => res.send("HIGH-ER Backend Active 🚀"));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));
