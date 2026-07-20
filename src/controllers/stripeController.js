const stripe = require("../config/stripe");
const { admin, db } = require("../config/firebase");
const {
  notifyAdminOfOrder,
  notifyClientOfOrder,
} = require("../services/orderNotify");

const SITE_URL = process.env.FRONTEND_URL;

async function createCheckoutSession(req, res) {
  try {
    const { cart, orderId, customerEmail } = req.body;

    if (!cart?.length || !orderId) {
      return res.status(400).json({ error: "Missing cart or orderId" });
    }

    const line_items = cart.map((item) => ({
      price_data: {
        currency: "usd",
        product_data: {
          name: item.name,
          description: item.dimensions
            ? `${item.category || "General"} · ${item.dimensions}`
            : item.category || "General",
        },
        unit_amount: Math.round(item.price * 100),
      },
      quantity: item.quantity,
    }));

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items,
      customer_email: customerEmail,
      metadata: { orderId },
      success_url: `${SITE_URL}/orders?status=success`,
      cancel_url: `${SITE_URL}/checkout?status=cancelled`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe session error:", err);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
}

async function handleStripeWebhook(req, res) {
  const sig = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).json({ error: "Invalid signature" });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const orderId = session.metadata?.orderId;

    if (!orderId) {
      console.error("Webhook: no orderId in session metadata");
      return res.json({ received: true });
    }

    try {
      const orderRef = db.collection("orders").doc(orderId);
      const orderSnap = await orderRef.get();

      if (!orderSnap.exists) {
        console.error(`Webhook: order ${orderId} not found`);
        return res.json({ received: true });
      }

      const order = orderSnap.data();

      if (order.status === "paid") {
        return res.json({ received: true }); // already fulfilled, Stripe retry
      }

      await orderRef.update({
        status: "paid",
        stripeSessionId: session.id,
        stripePaymentIntent: session.payment_intent,
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await notifyAdminOfOrder({
        orderId,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        items: order.items,
        totalAmount: order.totalAmount,
      });

      await notifyClientOfOrder({
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        orderId,
        totalAmount: order.totalAmount,
      });
    } catch (err) {
      console.error("Order fulfillment error:", err);
      return res.status(500).json({ error: "Fulfillment failed" });
    }
  }

  res.json({ received: true });
}

module.exports = { createCheckoutSession, handleStripeWebhook };
