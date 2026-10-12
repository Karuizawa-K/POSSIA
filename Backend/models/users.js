
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
    {
        username: {
            type: String,
            required: true,
            trim: true,
            unique: true
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