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
            required: true,
            trim: true,
            lowercase: true,
            unique: true,
            match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
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
        passwordResetOtpHash: {
            type: String,
            default: null,
            select: false
        },
        passwordResetOtpExpiresAt: {
            type: Date,
            default: null,
            select: false
        },
        passwordResetAttempts: {
            type: Number,
            default: 0,
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