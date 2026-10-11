
const mongoose = require("mongoose");

const saleDetailSchema = new mongoose.Schema(
    {
        saleId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Sale",
            required: true
        },
        productId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Product",
            required: true
        },
        quantity: {
            type: Number,
            required: true,
            min: 1,
            validate: {
                validator: Number.isInteger,
                message: "Quantity must be a whole number."
            }
        },
        unitPrice: {
            type: Number,
            required: true,
            min: 0
        },
        subtotal: {
            type: Number,
            required: true,
            min: 0
        }
    },
    {
        versionKey: false,
        collection: "sale_details"
    }
);

saleDetailSchema.index({ saleId: 1 });

module.exports = mongoose.model("SaleDetail", saleDetailSchema, "sale_details");