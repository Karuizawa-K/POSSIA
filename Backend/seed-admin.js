const path = require("path");
const readline = require("readline");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const User = require("./models/users");
const {
  generateRecoveryCodes,
  hashRecoveryCode,
  sealCodes,
} = require("./utils/recovery-codes");

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,32}$/;
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
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET must be configured in Backend/.env.");
  }

  await mongoose.connect(process.env.MONGODB_URI);

  if (await User.exists({ role: "Admin" })) {
    console.log("An Admin account already exists; only one Admin is allowed. No account was created.");
    return;
  }

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);

  try {
    const username = (await prompt("Admin username: ")).trim();
    const fullName = (await prompt("Admin full name: ")).trim();
    const password = await prompt("Admin password (input hidden): ", true);
    const passwordConfirmation = await prompt("Confirm password (input hidden): ", true);

    if (!USERNAME_PATTERN.test(username)) {
      throw new Error(
        "Username must be 3-32 characters using letters, numbers, dot, underscore, or hyphen."
      );
    }
    if (!fullName) {
      throw new Error("Full name is required.");
    }
    if (password.length < 6) {
      throw new Error("Password must be at least 6 characters.");
    }
    if (password !== passwordConfirmation) {
      throw new Error("Passwords do not match.");
    }
    if (await User.exists({ username })) {
      throw new Error("That username is already registered.");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const recoveryCodes = generateRecoveryCodes();
    await User.create({
      username,
      fullName,
      password: hashedPassword,
      role: "Admin",
      adminRecoveryCodeHashes: recoveryCodes.map(hashRecoveryCode),
      adminRecoveryCodeBox: sealCodes(recoveryCodes, process.env.JWT_SECRET),
    });

    console.log(`Admin account "${username}" created successfully.`);
    printRecoveryCodes(recoveryCodes);
  } finally {
    process.stdin.setRawMode(false);
  }
}

function printRecoveryCodes(codes) {
  console.log("");
  console.log("=".repeat(62));
  console.log("ADMIN RECOVERY CODES - SHOWN ONCE, SAVE THEM NOW");
  console.log("=".repeat(62));
  for (const code of codes) {
    console.log(`   ${code}`);
  }
  console.log("-".repeat(62));
  console.log("Each code works once and cannot be recovered later.");
  console.log("Store them offline (printed, sealed). Anyone holding a code");
  console.log("can reset the Admin password.");
  console.log("Lost them? Run: npm run reset:admin");
  console.log("=".repeat(62));
  console.log("");
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