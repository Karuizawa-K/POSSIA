
const mongoose = require("mongoose");

const stockOutSchema = new mongoose.Schema(
    {
        productId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Product",
            required: true
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        quantityRemoved: {
            type: Number,
            required: true,
            min: 1,
            validate: {
                validator: Number.isInteger,
                message: "Quantity removed must be a whole number."
            }
        },
        reason: {
            type: String,
            required: true,
            trim: true
        },
        dateRemoved: {
            type: Date,
            required: true,
            default: Date.now
        }
    },
    {
        versionKey: false,
        collection: "stock_out"
    }
);

module.exports = mongoose.model("StockOut", stockOutSchema, "stock_out");