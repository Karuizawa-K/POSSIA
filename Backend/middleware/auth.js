const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const User = require("../models/users");

// Rejects requests without a valid, non-archived session token.
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Unauthorized.",
    });
  }

  try {
    const decoded = jwt.verify(
      authHeader.slice("Bearer ".length),
      process.env.JWT_SECRET
    );
    if (!mongoose.Types.ObjectId.isValid(decoded.userId)) {
      return res.status(401).json({
        message: "Invalid or expired token.",
      });
    }

    const user = await User.findById(decoded.userId)
      .select("_id username fullName role tokenVersion isActive");
    if (!user || user.isActive === false) {
      return res.status(401).json({
        message: "Unauthorized.",
      });
    }
    if ((decoded.tokenVersion ?? 0) !== (user.tokenVersion || 0)) {
      return res.status(401).json({
        message: "Session expired. Please sign in again.",
      });
    }

    req.authUser = user;
    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      return res.status(401).json({
        message: "Invalid or expired token.",
      });
    }
    console.error(error);
    res.status(500).json({
      message: "Server error.",
    });
  }
}

// Rejects requests from any non-Admin session.
async function requireAdmin(req, res, next) {
  await requireAuth(req, res, () => {
    if (req.authUser.role !== "Admin") {
      return res.status(403).json({
        message: "Admin access is required.",
      });
    }

    req.adminUser = req.authUser;
    next();
  });
}

module.exports = { requireAuth, requireAdmin };