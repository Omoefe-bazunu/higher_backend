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
// 1. FIREBASE ADMIN INITIALIZATION
// ==========================================
let serviceAccount;

try {
  console.log("🔧 Initializing Firebase Admin...");
  console.log("📂 Current directory:", process.cwd());
  console.log("🔍 ENV PATH:", process.env.FIREBASE_SERVICE_ACCOUNT_PATH);

  // Option A: Render Secret File Path
  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    console.log("🔍 Checking path:", process.env.FIREBASE_SERVICE_ACCOUNT_PATH);

    if (fs.existsSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)) {
      const raw = fs.readFileSync(
        process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
        "utf8"
      );
      serviceAccount = JSON.parse(raw);
      console.log("✅ Service account loaded from ENV path");
    } else {
      console.error(
        "❌ File not found at:",
        process.env.FIREBASE_SERVICE_ACCOUNT_PATH
      );
    }
  }
  // Option B: Local Development
  else if (fs.existsSync("./serviceAccountKey.json")) {
    serviceAccount = require("./serviceAccountKey.json");
    console.log("✅ Service account loaded from local file");
  }
  // Option C: Environment Variable (Backup method)
  else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    console.log("✅ Service account loaded from environment variable");
  } else {
    console.error("❌ No service account credentials found!");
    console.log("Checked:");
    console.log("  1. ENV PATH:", process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
    console.log("  2. Local: ./serviceAccountKey.json");
    console.log("  3. ENV VAR: FIREBASE_SERVICE_ACCOUNT");
  }

  // Initialize Firebase Admin
  if (!admin.apps.length && serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log("✅ Firebase Admin Initialized Successfully");
  } else if (!admin.apps.length) {
    console.error("❌ Firebase Admin initialization failed - no credentials");
    process.exit(1);
  }
} catch (err) {
  console.error("❌ Firebase Admin initialization error:", err);
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
        tx_ref: tx_ref,
        amount: amount,
        currency: "NGN",
        redirect_url: `${process.env.CLIENT_ORIGIN}/basic/dashboard?status=success&course=${courseId}`,
        customer: {
          email: email,
          name: name,
        },
        customizations: {
          title: "HIGH-ER BASIC Training",
          description: "Enrolling in Technical Track",
          logo: "https://higher.com.ng/logo.png",
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
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
  const secretHash = process.env.FLW_SECRET_HASH;
  const signature = req.headers["verif-hash"];

  if (!signature || signature !== secretHash) {
    return res.status(401).end();
  }

  const payload = req.body;

  if (payload.event === "charge.completed" && payload.status === "successful") {
    const { tx_ref, customer } = payload.data;
    // Format: BASIC_courseId_timestamp
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
  res.status(200).end();
});

// ==========================================
// 4. HEALTH CHECK & START
// ==========================================
app.get("/", (req, res) => res.send("HIGH-ER Backend Active 🚀"));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));
