const path = require("path");
const mongoose = require("mongoose");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const User = require("./models/users");
const SystemSetting = require("./models/system_settings");

async function main() {
    if (!process.env.MONGODB_URI) {
        throw new Error("MONGODB_URI must be configured in Backend/.env.");
    }

    await mongoose.connect(process.env.MONGODB_URI);
    const existingOwner = await SystemSetting.findOne({ key: "owner" });
    if (existingOwner) {
        const owner = await User.findById(existingOwner.ownerUserId).select("username role");
        if (!owner || owner.role !== "Admin") {
            throw new Error("The configured owner is missing or is not an Admin; use trusted database recovery.");
        }
        console.log(`System owner is already configured as "${owner.username}". No changes made.`);
        return;
    }

    const oldestAdmin = await User.findOne({ role: "Admin" })
        .sort({ createdAt: 1, _id: 1 })
        .select("_id username");
    if (!oldestAdmin) {
        throw new Error("No Admin account exists. Create the first Admin before initializing ownership.");
    }

    await SystemSetting.create({
        key: "owner",
        ownerUserId: oldestAdmin._id
    });
    console.log(`System owner initialized as the oldest Admin, "${oldestAdmin.username}".`);
}

main()
    .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }
    });
