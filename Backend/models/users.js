const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
    {
        username: {
            type: String,
            required: true,
            trim: true,
            unique: true
        },
        email: {
            type: String,
            // Left unset on every account; kept only so existing documents can
            // be cleaned up by migrate:remove-email. New writes never set it.
            required: false,
            trim: true,
            lowercase: true
        },
        password: {
            type: String,
            required: true
        },
        fullName: {
            type: String,
            required: true,
            trim: true
        },
        role: {
            type: String,
            required: true,
            enum: ["Admin", "Staff"]
        },
        // Single-use codes that let the Admin recover the account without email.
        // Only hashes are stored; plaintext is shown once at issue time.
        adminRecoveryCodeHashes: {
            type: [String],
            default: [],
            select: false
        },
        // Encrypted copy of the active codes so a logged-in Admin can read them
        // back. Sealed with a key derived from JWT_SECRET; hashes above remain
        // the verification source of truth.
        adminRecoveryCodeBox: {
            type: String,
            default: null,
            select: false
        },
        tokenVersion: {
            type: Number,
            default: 0
        }
    },
    {
        timestamps: { createdAt: true, updatedAt: false },
        versionKey: false,
        collection: "users"
    }
);

module.exports = mongoose.model("User", userSchema, "users");