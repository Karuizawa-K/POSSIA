
const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
    {
        saleId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Sale",
            required: true
        },
        paymentMethod: {
            type: String,
            required: true,
            trim: true
        },
        amountPaid: {
            type: Number,
            required: true,
            min: 0
        },
        changeAmount: {
            type: Number,
            required: true,
            default: 0,
            min: 0
        },
        referenceNumber: {
            type: String,
            default: null,
            trim: true
        },
        paymentDate: {
            type: Date,
            required: true,
            default: Date.now
        }
    },
    {
        versionKey: false,
        collection: "payments"
    }
);

paymentSchema.index({ saleId: 1 });

module.exports = mongoose.model("Payment", paymentSchema, "payments");