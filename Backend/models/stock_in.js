
const mongoose = require("mongoose");

const stockInSchema = new mongoose.Schema(
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
        quantityAdded: {
            type: Number,
            required: true,
            min: 1,
            validate: {
                validator: Number.isInteger,
                message: "Quantity added must be a whole number."
            }
        },
        dateReceived: {
            type: Date,
            required: true,
            default: Date.now
        }
    },
    {
        versionKey: false,
        collection: "stock_in"
    }
);

module.exports = mongoose.model("StockIn", stockInSchema, "stock_in");