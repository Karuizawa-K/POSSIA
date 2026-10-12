
const mongoose = require("mongoose");

const saleSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        saleDate: {
            type: Date,
            default: Date.now,
            required: true
        },
        subtotal: {
            type: Number,
            required: true,
            min: 0
        },
        discount: {
            type: Number,
            required: true,
            default: 0,
            min: 0
        },
        totalAmount: {
            type: Number,
            required: true,
            min: 0
        },
        status: {
            type: String,
            required: true,
            default: "Completed"
        }
    },
    {
        versionKey: false,
        collection: "sales"
    }
);

module.exports = mongoose.model("Sale", saleSchema, "sales");