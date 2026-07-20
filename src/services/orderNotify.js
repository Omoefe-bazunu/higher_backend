const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = "Tailored Furnitures <orders@tailoredfurnitures.com>";
const SUPPORT = "orders@tailoredfurnitures.com";

async function notifyAdminOfOrder({
  orderId,
  customerName,
  customerEmail,
  items,
  totalAmount,
}) {
  const itemRows = items
    .map(
      (i) =>
        `<li>${i.name} × ${i.quantity} — $${(i.price * i.quantity).toLocaleString()}</li>`,
    )
    .join("");

  await resend.emails.send({
    from: FROM,
    to: SUPPORT,
    subject: `New Order Received — ${customerName}`,
    html: `
      <p>A new order has been placed.</p>
      <ul>
        <li><strong>Order ID:</strong> ${orderId}</li>
        <li><strong>Customer:</strong> ${customerName}</li>
        <li><strong>Email:</strong> ${customerEmail}</li>
        <li><strong>Total:</strong> $${totalAmount.toLocaleString()}</li>
      </ul>
      <p><strong>Items:</strong></p>
      <ul>${itemRows}</ul>
    `,
  });
}

async function notifyClientOfOrder({
  customerName,
  customerEmail,
  orderId,
  totalAmount,
}) {
  await resend.emails.send({
    from: FROM,
    to: customerEmail,
    replyTo: SUPPORT,
    subject: `Order Confirmed — Thank you, ${customerName}!`,
    html: `
      <div style="font-family: sans-serif; line-height: 1.6; color: #1a1a1a; max-width: 600px;">
        <h2>Thank you for your order, ${customerName}!</h2>
        <p>Your order <strong>#${orderId.slice(0, 8).toUpperCase()}</strong> has been received and is now being processed.</p>
        <p>Your total investment: <strong>$${totalAmount.toLocaleString()}</strong></p>
        <p>We will be in touch shortly with delivery details.</p>
        <p style="color: #888; font-size: 13px;">— Tailored Furnitures Studio</p>
      </div>
    `,
  });
}

module.exports = { notifyAdminOfOrder, notifyClientOfOrder };
