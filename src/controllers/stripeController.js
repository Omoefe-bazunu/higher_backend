const stripe = require("../config/stripe");
const { admin, db } = require("../config/firebase");
const {
  notifyAdminOfOrder,
  notifyClientOfOrder,
} = require("../services/orderNotify");

const SITE_URL = process.env.FRONTEND_URL;

async function getArtworksByIds(ids) {
  const uniqueIds = [...new Set(ids)];
  const refs = uniqueIds.map((id) => db.collection("artworks").doc(id));
  const snaps = await db.getAll(...refs);

  const artworks = {};
  snaps.forEach((snap, i) => {
    if (snap.exists) {
      artworks[uniqueIds[i]] = { id: snap.id, ...snap.data() };
    }
  });
  return artworks;
}

async function createCheckoutSession(req, res) {
  try {
    const { cart, customerInfo } = req.body;

    if (!Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ error: "Cart is empty" });
    }

    const { name, email, address, city, country } = customerInfo || {};
    if (!name || !email || !address || !city || !country) {
      return res.status(400).json({ error: "Missing customer info" });
    }

    const ids = cart.map((item) => item.id);
    const artworks = await getArtworksByIds(ids);

    const missing = ids.filter((id) => !artworks[id]);
    if (missing.length > 0) {
      return res.status(400).json({
        error: `Unknown product(s): ${missing.join(", ")}`,
      });
    }

    const items = cart.map((cartItem) => {
      const product = artworks[cartItem.id];
      const quantity = Number(cartItem.quantity);

      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new Error(`Invalid quantity for product ${cartItem.id}`);
      }

      return {
        id: product.id,
        name: product.name,
        price: product.price,
        category: product.category || "General",
        dimensions: product.dimensions || "",
        quantity,
      };
    });

    const totalAmount = items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );

    const line_items = items.map((item) => ({
      price_data: {
        currency: "usd",
        product_data: {
          name: item.name,
          description: item.dimensions
            ? `${item.category} · ${item.dimensions}`
            : item.category,
        },
        unit_amount: Math.round(item.price * 100),
      },
      quantity: item.quantity,
    }));

    const orderRef = await db.collection("orders").add({
      customerName: name.trim(),
      customerEmail: email.trim(),
      shippingAddress: address.trim(),
      city: city.trim(),
      country: country.trim(),
      items,
      totalAmount,
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`[checkout] order created: ${orderRef.id}`);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items,
      customer_email: email.trim(),
      metadata: { orderId: orderRef.id },
      success_url: `${SITE_URL}/orders?status=success`,
      cancel_url: `${SITE_URL}/checkout?status=cancelled`,
    });

    console.log(`[checkout] stripe session created: ${session.id}, orderId in metadata: ${session.metadata.orderId}`);

    res.json({ url: session.url, orderId: orderRef.id });
  } catch (err) {
    console.error("Stripe session error:", err);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
}

async function handleStripeWebhook(req, res) {
  console.log("[webhook] request received");
  console.log("[webhook] body is Buffer:", Buffer.isBuffer(req.body));
  console.log("[webhook] signature header present:", !!req.headers["stripe-signature"]);

  const sig = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
    console.log(`[webhook] signature verified. event type: ${event.type}`);
  } catch (err) {
    console.error("[webhook] signature verification failed:", err.message);
    return res.status(400).json({ error: "Invalid signature" });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const orderId = session.metadata?.orderId;

    console.log(`[webhook] checkout.session.completed for orderId: ${orderId}`);

    if (!orderId) {
      console.error("[webhook] no orderId in session metadata");
      return res.json({ received: true });
    }

    try {
      const orderRef = db.collection("orders").doc(orderId);
      const orderSnap = await orderRef.get();

      if (!orderSnap.exists) {
        console.error(`[webhook] order ${orderId} not found in Firestore`);
        return res.json({ received: true });
      }

      const order = orderSnap.data();
      console.log(`[webhook] found order ${orderId}, current status: ${order.status}`);

      if (order.status === "paid") {
        console.log(`[webhook] order ${orderId} already paid, skipping (Stripe retry)`);
        return res.json({ received: true });
      }

      await orderRef.update({
        status: "paid",
        stripeSessionId: session.id,
        stripePaymentIntent: session.payment_intent,
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`[webhook] order ${orderId} marked as paid`);

      await notifyAdminOfOrder({
        orderId,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        items: order.items,
        totalAmount: order.totalAmount,
      });

      console.log(`[webhook] admin notification sent for ${orderId}`);

      await notifyClientOfOrder({
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        orderId,
        totalAmount: order.totalAmount,
      });

      console.log(`[webhook] client notification sent for ${orderId}`);
    } catch (err) {
      console.error("[webhook] fulfillment error:", err);
      return res.status(500).json({ error: "Fulfillment failed" });
    }
  } else {
    console.log(`[webhook] ignored event type: ${event.type}`);
  }

  res.json({ received: true });
}

module.exports = { createCheckoutSession, handleStripeWebhook };