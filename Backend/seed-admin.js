const path = require("path");
const readline = require("readline");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const User = require("./models/users");
const SystemSetting = require("./models/system_settings");

function prompt(label, maskInput = false) {
  return new Promise((resolve, reject) => {
    let value = "";
    process.stdout.write(label);

    const onKeypress = (character, key) => {
      if (key.ctrl && key.name === "c") {
        process.stdout.write("\n");
        cleanup();
        reject(new Error("Cancelled."));
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        process.stdout.write("\n");
        cleanup();
        resolve(value);
        return;
      }

      if (key.name === "backspace") {
        const characters = Array.from(value);
        if (characters.length) {
          characters.pop();
          value = characters.join("");
          process.stdout.write("\b \b");
        }
        return;
      }

      if (!key.ctrl && !key.meta && character && !/[\u0000-\u001f\u007f]/.test(character)) {
        value += character;
        process.stdout.write(maskInput ? "*" : character);
      }
    };

    function cleanup() {
      process.stdin.removeListener("keypress", onKeypress);
    }

    process.stdin.on("keypress", onKeypress);
  });
}

async function main() {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("Run this command in an interactive terminal.");
  }
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI must be configured in Backend/.env.");
  }

  await mongoose.connect(process.env.MONGODB_URI);

  if (await User.exists({ role: "Admin" })) {
    console.log("An Admin account already exists; no account was created.");
    return;
  }

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);

  try {
    const username = (await prompt("Admin username: ")).trim();
    const fullName = (await prompt("Admin full name: ")).trim();
    const password = await prompt("Admin password (input hidden): ", true);
    const passwordConfirmation = await prompt("Confirm password (input hidden): ", true);

    if (!username || !fullName) {
      throw new Error("Username and full name are required.");
    }
    if (password.length < 6) {
      throw new Error("Password must be at least 6 characters.");
    }
    if (password !== passwordConfirmation) {
      throw new Error("Passwords do not match.");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const admin = await User.create({
      username,
      fullName,
      password: hashedPassword,
      role: "Admin",
    });
    await SystemSetting.create({
      key: "owner",
      ownerUserId: admin._id,
    });

    console.log(`Admin account "${username}" created successfully and designated as system owner.`);
  } finally {
    process.stdin.setRawMode(false);
  }
}

main()
  .catch((error) => {
    if (error.message === "Cancelled.") {
      console.log("Admin account creation cancelled.");
    } else {
      console.error(error.message);
      process.exitCode = 1;
    }
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });