const nodemailer = require("nodemailer");

const CONNECTION_TIMEOUT_MS = Number(process.env.SMTP_CONNECTION_TIMEOUT_MS) || 10000;
const GREETING_TIMEOUT_MS = Number(process.env.SMTP_GREETING_TIMEOUT_MS) || 10000;
const SOCKET_TIMEOUT_MS = Number(process.env.SMTP_SOCKET_TIMEOUT_MS) || 20000;

let cachedTransport;
let sendGridReady = false;

function hasSendGrid() {
    return (
        typeof process.env.SENDGRID_API_KEY === "string" &&
        process.env.SENDGRID_API_KEY.trim().length > 0
    );
}

function hasSmtp() {
    return (
        typeof process.env.SMTP_HOST === "string" &&
        process.env.SMTP_HOST.trim().length > 0 &&
        typeof process.env.MAIL_FROM === "string" &&
        process.env.MAIL_FROM.trim().length > 0
    );
}

// SendGrid is preferred because it uses plain HTTPS, which cloud hosts never
// block. SMTP stays available for local development.
function resolveProvider() {
    if (hasSendGrid()) {
        return "sendgrid";
    }
    if (hasSmtp()) {
        return "smtp";
    }
    return null;
}

function isMailConfigured() {
    return resolveProvider() !== null;
}

function fromAddress() {
    return process.env.MAIL_FROM.trim();
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function buildMessage({ to, fullName, code }) {
    const minutes = Number(process.env.PASSWORD_RESET_OTP_MINUTES) || 10;
    const displayName = process.env.MAIL_FROM_NAME || "POSSIA";
    return {
        to,
        subject: `${displayName} password reset code`,
        text: [
            `Hello ${fullName},`,
            "",
            `Your password reset code is: ${code}`,
            "",
            `The code expires in ${minutes} minutes and can only be used once.`,
            "If you did not request this, you can ignore this email."
        ].join("\n"),
        html: [
            `<p>Hello ${escapeHtml(fullName)},</p>`,
            "<p>Your password reset code is:</p>",
            `<p style="font-size:20px;font-weight:bold;letter-spacing:2px;">${escapeHtml(code)}</p>`,
            `<p>The code expires in ${minutes} minutes and can only be used once.</p>`,
            "<p>If you did not request this, you can ignore this email.</p>"
        ].join("")
    };
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

function smtpSenderName() {
    return process.env.MAIL_FROM_NAME
        ? `"${process.env.MAIL_FROM_NAME.replace(/"/g, "")}" <${fromAddress()}>`
        : fromAddress();
}

// SendGrid returns a long JSON error body; surface just the useful line so
// the deploy logs stay readable.
function describeSendGridError(error) {
    const errors = error?.response?.body?.errors;
    if (Array.isArray(errors) && errors.length > 0) {
        return errors.map((entry) => entry.message).filter(Boolean).join("; ");
    }
    if (typeof error?.response?.body === "string" && error.response.body.trim()) {
        return error.response.body.slice(0, 200);
    }
    return error?.message || "Unknown SendGrid error";
}

async function sendViaSendGrid(message) {
    const sgMail = require("@sendgrid/mail");
    if (!sendGridReady) {
        sgMail.setApiKey(process.env.SENDGRID_API_KEY.trim());
        sendGridReady = true;
    }

    try {
        return await sgMail.send({
            to: message.to,
            from: {
                email: fromAddress(),
                name: process.env.MAIL_FROM_NAME || "POSSIA"
            },
            subject: message.subject,
            text: message.text,
            html: message.html
        });
    } catch (error) {
        throw Object.assign(new Error(describeSendGridError(error)), { cause: error });
    }
}

async function sendViaSmtp(message) {
    return getTransport().sendMail({
        from: smtpSenderName(),
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html
    });
}

async function sendPasswordResetCode({ to, fullName, code }) {
    const message = buildMessage({ to, fullName, code });

    if (resolveProvider() === "sendgrid") {
        return sendViaSendGrid(message);
    }
    return sendViaSmtp(message);
}

// Reports delivery readiness once at boot instead of waiting for the first
// password reset to fail.
async function verifyMailConnection() {
    const provider = resolveProvider();
    if (!provider) {
        return { ok: false, provider: null, reason: "not-configured" };
    }

    if (provider === "sendgrid") {
        const key = process.env.SENDGRID_API_KEY.trim();
        if (!key.startsWith("SG.")) {
            return {
                ok: false,
                provider,
                reason: "SENDGRID_API_KEY does not look like a SendGrid API key."
            };
        }
        if (typeof process.env.MAIL_FROM !== "string" || !process.env.MAIL_FROM.trim()) {
            return {
                ok: false,
                provider,
                reason: "MAIL_FROM must match the verified SendGrid sender address."
            };
        }
        // SendGrid has no unauthenticated ping, so the first real send is the
        // delivery test.
        return { ok: true, provider };
    }

    try {
        await getTransport().verify();
        return { ok: true, provider };
    } catch (error) {
        return { ok: false, provider, reason: error.message };
    }
}

module.exports = { isMailConfigured, sendPasswordResetCode, verifyMailConnection };