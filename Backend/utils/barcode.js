const { randomInt } = require("crypto");

const IN_STORE_PREFIXES = ["20", "21", "22", "23", "24", "25", "26", "27", "28", "29"];

// Computes the EAN-13 check digit for twelve leading digits.
function ean13CheckDigit(firstTwelveDigits) {
  const digits = String(firstTwelveDigits);
  if (!/^\d{12}$/.test(digits)) {
    throw new Error("EAN-13 check digit requires exactly 12 digits.");
  }

  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    sum += Number(digits[index]) * (index % 2 === 0 ? 1 : 3);
  }

  return String((10 - (sum % 10)) % 10);
}

// Builds a random in-store EAN-13 candidate barcode.
function generateEan13Candidate(prefix) {
  const usedPrefix = IN_STORE_PREFIXES.includes(prefix) ? prefix : IN_STORE_PREFIXES[0];
  let body = "";
  while (body.length < 10) {
    body += String(randomInt(0, 10));
  }

  const firstTwelve = `${usedPrefix}${body}`;
  return `${firstTwelve}${ean13CheckDigit(firstTwelve)}`;
}

// Returns a candidate barcode that no product already uses.
async function generateUniqueBarcode(Product, { attempts = 10 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const candidate = generateEan13Candidate();
    const taken = await Product.exists({ barcode: candidate });
    if (!taken) {
      return candidate;
    }
  }

  throw Object.assign(new Error("Unable to generate an unused barcode. Try again."), {
    status: 503,
  });
}

module.exports = {
  IN_STORE_PREFIXES,
  ean13CheckDigit,
  generateEan13Candidate,
  generateUniqueBarcode,
};