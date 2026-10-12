const nodemailer = require("nodemailer");

const CONNECTION_TIMEOUT_MS = Number(process.env.SMTP_CONNECTION_TIMEOUT_MS) || 10000;
const GREETING_TIMEOUT_MS = Number(process.env.SMTP_GREETING_TIMEOUT_MS) || 10000;
const SOCKET_TIMEOUT_MS = Number(process.env.SMTP_SOCKET_TIMEOUT_MS) || 20000;

let cachedTransport;

function isMailConfigured() {
    return (
        typeof process.env.SMTP_HOST === "string" &&
        process.env.SMTP_HOST.trim().length > 0 &&
        typeof process.env.MAIL_FROM === "string" &&
        process.env.MAIL_FROM.trim().length > 0
    );
}

function getTransport() {
    if (cachedTransport) {
        return cachedTransport;
    }

    const auth = process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined;

    cachedTransport = nodemailer.createTransport({
        host: process.env.SMTP_HOST.trim(),
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE
            ? process.env.SMTP_SECURE.toLowerCase() === "true"
            : Number(process.env.SMTP_PORT) === 465,
        auth,
        pool: true,
        maxConnections: 3,
        maxMessages: 100,
        connectionTimeout: CONNECTION_TIMEOUT_MS,
        greetingTimeout: GREETING_TIMEOUT_MS,
        socketTimeout: SOCKET_TIMEOUT_MS
    });

    return cachedTransport;
}

function senderName() {
    return process.env.MAIL_FROM_NAME
        ? `"${process.env.MAIL_FROM_NAME.replace(/"/g, "")}" <${process.env.MAIL_FROM.trim()}>`
        : process.env.MAIL_FROM.trim();
}

async function sendPasswordResetCode({ to, fullName, code }) {
    const minutes = Number(process.env.PASSWORD_RESET_OTP_MINUTES) || 10;
    const info = await getTransport().sendMail({
        from: senderName(),
        to,
        subject: `${process.env.MAIL_FROM_NAME || "POSSIA"} password reset code`,
        text: [
            `Hello ${fullName},`,
            "",
            `Your password reset code is: ${code}`,
            "",
            `The code expires in ${minutes} minutes and can only be used once.`,
            "If you did not request this, you can ignore this email."
        ].join("\n"),
        html: [
            `<p>Hello ${fullName},</p>`,
            `<p>Your password reset code is:</p>`,
            `<p style="font-size:20px;font-weight:bold;letter-spacing:2px;">${code}</p>`,
            `<p>The code expires in ${minutes} minutes and can only be used once.</p>`,
            "<p>If you did not request this, you can ignore this email.</p>"
        ].join("")
    });

    return info;
}

// Confirms credentials and reachability once at boot instead of waiting for
// the first password reset to fail.
async function verifyMailConnection() {
    if (!isMailConfigured()) {
        return { ok: false, reason: "not-configured" };
    }

    try {
        await getTransport().verify();
        return { ok: true };
    } catch (error) {
        return { ok: false, reason: error.message };
    }
}

module.exports = { isMailConfigured, sendPasswordResetCode, verifyMailConnection };