const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: process.env.FRONTEND_URL }));
app.use(express.json());

const stripeRoutes = require("./src/routes/stripeRoutes");
app.use("/api", stripeRoutes);

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "Backend",
  });
});

app.get("/webhook/test", (req, res) => {
  res.json({
    message: "Webhook endpoint is accessible",
    urls: ["/api/webhook/stripe"],
    method: "POST",
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend running on port ${PORT}`);
  console.log(`Live`);
});
