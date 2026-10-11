const mongoose = require("mongoose");

const systemSettingSchema = new mongoose.Schema(
    {
        key: {
            type: String,
            required: true,
            unique: true
        },
        ownerUserId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        usedRecoveryCodeHashes: {
            type: [String],
            default: []
        }
    },
    {
        versionKey: false,
        collection: "system_settings"
    }
);

module.exports = mongoose.model("SystemSetting", systemSettingSchema, "system_settings");
