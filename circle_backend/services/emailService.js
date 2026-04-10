const transporter = require("../config/mailer");

async function sendPasswordResetEmail({ to, name, token }) {
  const resetUrl = `${process.env.FRONTEND_URL}/circle.html?token=${token}`;

  await transporter.sendMail({
    from: `"Circle" <${process.env.EMAIL_USER}>`,
    to,
    subject: "Reset your Circle password",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#7c6bff">Reset your password</h2>
        <p>Hi ${name},</p>
        <p>We received a request to reset your Circle password.
           Click the button below — this link expires in <strong>1 hour</strong>.</p>
        <a href="${resetUrl}"
           style="display:inline-block;margin:20px 0;padding:12px 28px;
                  background:#7c6bff;color:#fff;border-radius:8px;
                  text-decoration:none;font-weight:600">
          Reset Password
        </a>
        <p style="color:#888;font-size:13px">
          If you didn't request this, you can safely ignore this email.<br/>
          The link will expire in 1 hour.
        </p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="color:#aaa;font-size:12px">Circle · sent to ${to}</p>
      </div>
    `,
  });
}

module.exports = { sendPasswordResetEmail };