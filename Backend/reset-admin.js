const path = require("path");
const readline = require("readline");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const User = require("./models/users");
const {
  generateRecoveryCodes,
  hashRecoveryCode,
} = require("./utils/recovery-codes");

// Operator-only recovery for the single Admin account: sets a new password and
// issues a fresh set of recovery codes. Same trust level that creates the Admin.
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

function printRecoveryCodes(codes) {
  console.log("");
  console.log("=".repeat(62));
  console.log("ADMIN RECOVERY CODES - SHOWN ONCE, SAVE THEM NOW");
  console.log("=".repeat(62));
  for (const code of codes) {
    console.log(`   ${code}`);
  }
  console.log("-".repeat(62));
  console.log("Give these to the Admin. Any previous codes no longer work.");
  console.log("=".repeat(62));
  console.log("");
}

async function main() {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("Run this command in an interactive terminal.");
  }
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI must be configured in Backend/.env.");
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const admin = await User.findOne({ role: "Admin" }).select("+adminRecoveryCodeHashes");
  if (!admin) {
    throw new Error("No Admin account exists. Run: npm run seed:admin");
  }

  console.log(`Admin account found: @${admin.username}.`);
  console.log("This sets a new Admin password and replaces all recovery codes.");
  const confirmation = (await prompt('Type "RESET" to continue: "')).trim();
  if (confirmation !== "RESET") {
    throw new Error("Cancelled. Nothing was changed.");
  }

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);

  try {
    const password = await prompt("New Admin password (input hidden): ", true);
    const passwordConfirmation = await prompt("Confirm password (input hidden): ", true);

    if (password.length < 6) {
      throw new Error("Password must be at least 6 characters.");
    }
    if (password !== passwordConfirmation) {
      throw new Error("Passwords do not match.");
    }

    const recoveryCodes = generateRecoveryCodes();
    const hashedPassword = await bcrypt.hash(password, 10);

    await User.updateOne(
      { _id: admin._id },
      {
        $set: {
          password: hashedPassword,
          adminRecoveryCodeHashes: recoveryCodes.map(hashRecoveryCode),
        },
        // Signs the Admin out of every existing session.
        $inc: { tokenVersion: 1 },
      }
    );

    console.log(`Admin password updated for @${admin.username}.`);
    printRecoveryCodes(recoveryCodes);
  } finally {
    process.stdin.setRawMode(false);
  }
}

main()
  .catch((error) => {
    if (error.message === "Cancelled.") {
      console.log("Admin password reset cancelled.");
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
