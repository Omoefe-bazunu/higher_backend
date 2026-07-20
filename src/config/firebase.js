const admin = require("firebase-admin");
const serviceAccount = require("../../serviceAccountKey.json");

try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log("✅ Firebase Admin initialized");
} catch (err) {
  console.error("❌ Firebase Admin init failed:", err.message);
  process.exit(1);
}

const db = admin.firestore();

module.exports = { admin, db };
