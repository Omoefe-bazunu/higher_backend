const stripe = require("../config/stripe");
const { admin, db } = require("../config/firebase");
const {
  notifyAdminOfOrder,
  notifyClientOfOrder,
} = require("../services/orderNotify");

const SITE_URL = process.env.FRONTEND_URL;

// Looks up canonical product data by ID. This is the ONLY place
// price/name/category should ever come from — never trust the client.

async function getProductsByIds(ids) {
  const uniqueIds = [...new Set(ids)];
  const refs = uniqueIds.map((id) => db.collection("artworks").doc(id));
  const snaps = await db.getAll(...refs);

  const products = {};
  snaps.forEach((snap, i) => {
    if (snap.exists) {
      products[uniqueIds[i]] = { id: snap.id, ...snap.data() };
    }
  });
  return products;
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

    // Client only sends {id, quantity} now — everything else is looked up.
    const ids = cart.map((item) => item.id);
    const products = await getProductsByIds(ids);

    const missing = ids.filter((id) => !products[id]);
    if (missing.length > 0) {
      return res.status(400).json({
        error: `Unknown product(s): ${missing.join(", ")}`,
      });
    }

    const items = cart.map((cartItem) => {
      const product = products[cartItem.id];
      const quantity = Number(cartItem.quantity);

      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new Error(`Invalid quantity for product ${cartItem.id}`);
      }

      return {
        id: product.id,
        name: product.name,
        price: product.price, // canonical, from Firestore
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

    // Create the order only after prices are verified server-side.
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

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items,
      customer_email: email.trim(),
      metadata: { orderId: orderRef.id },
      success_url: `${SITE_URL}/orders?status=success`,
      cancel_url: `${SITE_URL}/checkout?status=cancelled`,
    });

    res.json({ url: session.url, orderId: orderRef.id });
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

// const stripe = require("../config/stripe");
// const { admin, db } = require("../config/firebase");
// const {
//   notifyAdminOfOrder,
//   notifyClientOfOrder,
// } = require("../services/orderNotify");

// const SITE_URL = process.env.FRONTEND_URL;

// async function createCheckoutSession(req, res) {
//   try {
//     const { cart, orderId, customerEmail } = req.body;

//     if (!cart?.length || !orderId) {
//       return res.status(400).json({ error: "Missing cart or orderId" });
//     }

//     const line_items = cart.map((item) => ({
//       price_data: {
//         currency: "usd",
//         product_data: {
//           name: item.name,
//           description: item.dimensions
//             ? `${item.category || "General"} · ${item.dimensions}`
//             : item.category || "General",
//         },
//         unit_amount: Math.round(item.price * 100),
//       },
//       quantity: item.quantity,
//     }));

//     const session = await stripe.checkout.sessions.create({
//       mode: "payment",
//       payment_method_types: ["card"],
//       line_items,
//       customer_email: customerEmail,
//       metadata: { orderId },
//       success_url: `${SITE_URL}/orders?status=success`,
//       cancel_url: `${SITE_URL}/checkout?status=cancelled`,
//     });

//     res.json({ url: session.url });
//   } catch (err) {
//     console.error("Stripe session error:", err);
//     res.status(500).json({ error: "Failed to create checkout session" });
//   }
// }

// async function handleStripeWebhook(req, res) {
//   const sig = req.headers["stripe-signature"];

//   let event;
//   try {
//     event = stripe.webhooks.constructEvent(
//       req.body,
//       sig,
//       process.env.STRIPE_WEBHOOK_SECRET,
//     );
//   } catch (err) {
//     console.error("Webhook signature verification failed:", err.message);
//     return res.status(400).json({ error: "Invalid signature" });
//   }

//   if (event.type === "checkout.session.completed") {
//     const session = event.data.object;
//     const orderId = session.metadata?.orderId;

//     if (!orderId) {
//       console.error("Webhook: no orderId in session metadata");
//       return res.json({ received: true });
//     }

//     try {
//       const orderRef = db.collection("orders").doc(orderId);
//       const orderSnap = await orderRef.get();

//       if (!orderSnap.exists) {
//         console.error(`Webhook: order ${orderId} not found`);
//         return res.json({ received: true });
//       }

//       const order = orderSnap.data();

//       if (order.status === "paid") {
//         return res.json({ received: true }); // already fulfilled, Stripe retry
//       }

//       await orderRef.update({
//         status: "paid",
//         stripeSessionId: session.id,
//         stripePaymentIntent: session.payment_intent,
//         paidAt: admin.firestore.FieldValue.serverTimestamp(),
//       });

//       await notifyAdminOfOrder({
//         orderId,
//         customerName: order.customerName,
//         customerEmail: order.customerEmail,
//         items: order.items,
//         totalAmount: order.totalAmount,
//       });

//       await notifyClientOfOrder({
//         customerName: order.customerName,
//         customerEmail: order.customerEmail,
//         orderId,
//         totalAmount: order.totalAmount,
//       });
//     } catch (err) {
//       console.error("Order fulfillment error:", err);
//       return res.status(500).json({ error: "Fulfillment failed" });
//     }
//   }

//   res.json({ received: true });
// }

// module.exports = { createCheckoutSession, handleStripeWebhook };
