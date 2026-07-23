const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: process.env.FRONTEND_URL }));

const stripeRoutes = require("./src/routes/stripeRoutes");

// Webhook route must be mounted BEFORE express.json(), with raw body.
// This bypasses global JSON parsing entirely for this one path.
app.use(
  "/api/webhook/stripe",
  express.raw({ type: "application/json" }),
  require("./src/controllers/stripeController").handleStripeWebhook
);

// Everything else uses normal JSON parsing
app.use(express.json());
app.use("/api", stripeRoutes);

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString(), service: "Backend" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend running on port ${PORT}`);
  console.log(`Live`);
});
