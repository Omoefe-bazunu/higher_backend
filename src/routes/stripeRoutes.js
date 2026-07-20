const express = require("express");
const router = express.Router();
const {
  createCheckoutSession,
  handleStripeWebhook,
} = require("../controllers/stripeController");

// Raw body ONLY for this route — Stripe signature verification requires it.
// This is self-contained here so server.js just needs a single normal mount.
router.post(
  "/webhook/stripe",
  express.raw({ type: "application/json" }),
  handleStripeWebhook,
);

router.post("/create-checkout-session", createCheckoutSession);

module.exports = router;
