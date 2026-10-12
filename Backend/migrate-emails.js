const path = require("path");
const mongoose = require("mongoose");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const User = require("./models/users");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function placeholderEmail(username) {
    const safeUsername = String(username || "user")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, "-");
    return `${safeUsername || "user"}+update-needed@invalid.local`;
}

async function main() {
    if (!process.env.MONGODB_URI) {
        throw new Error("MONGODB_URI must be configured in Backend/.env.");
    }

    await mongoose.connect(process.env.MONGODB_URI);

    const users = await User.find().select("_id username email").sort({ createdAt: 1 });
    const missing = users.filter((user) => {
        const email = user.email || "";
        return !EMAIL_PATTERN.test(email);
    });

    const assigned = [];
    for (const user of missing) {
        user.email = placeholderEmail(user.username);
        await user.save();
        assigned.push({ username: user.username, email: user.email });
    }

    await User.createIndexes();

    console.log(`Accounts checked: ${users.length}`);
    console.log(`Placeholder emails assigned: ${assigned.length}`);
    for (const entry of assigned) {
        console.log(`  ${entry.username} -> ${entry.email}`);
    }
    if (assigned.length > 0) {
        console.log("");
        console.log("Sign in as the Admin and replace each placeholder email in Admin Settings.");
        console.log("Placeholder accounts cannot use Forgot password until their email is updated.");
    }
    console.log("Safe to run again: accounts with a valid email are left untouched.");
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