
const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
    {
        categoryId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Category",
            required: true
        },
        barcode: {
            type: String,
            required: true,
            trim: true,
            unique: true
        },
        productName: {
            type: String,
            required: true,
            trim: true
        },
        unitPrice: {
            type: Number,
            required: true,
            min: 0
        },
        stockQuantity: {
            type: Number,
            required: true,
            default: 0,
            min: 0,
            validate: {
                validator: Number.isInteger,
                message: "Stock quantity must be a whole number."
            }
        },
        isActive: {
            type: Boolean,
            required: true,
            default: true
        }
    },
    {
        timestamps: { createdAt: true, updatedAt: false },
        versionKey: false,
        collection: "products"
    }
);

module.exports = mongoose.model("Product", productSchema, "products");