
const mongoose = require("mongoose");

const categorySchema = new mongoose.Schema(
    {
        categoryName: {
            type: String,
            required: true,
            trim: true,
            minlength: 2,
            maxlength: 100
        }
    },
    {
        timestamps: { createdAt: true, updatedAt: false },
        versionKey: false,
        collection: "categories"
    }
);

categorySchema.index(
    { categoryName: 1 },
    {
        unique: true,
        collation: { locale: "en", strength: 2 }
    }
);

module.exports = mongoose.model("Category", categorySchema, "categories");