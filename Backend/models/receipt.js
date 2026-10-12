
const mongoose = require("mongoose");

const receiptSchema = new mongoose.Schema(
    {
        paymentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Payment",
            required: true,
            unique: true
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        receiptNumber: {
            type: String,
            required: true,
            unique: true,
            trim: true
        },
        receiptDate: {
            type: Date,
            required: true,
            default: Date.now
        }
    },
    {
        versionKey: false,
        collection: "receipts"
    }
);

module.exports = mongoose.model("Receipt", receiptSchema, "receipts");