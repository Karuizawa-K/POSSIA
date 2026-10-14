const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const authRoutes = require("./routes/auth");
const usersRoutes = require("./routes/users");
const inventoryRoutes = require("./routes/inventory");
const salesRoutes = require("./routes/sales");
const reportsRoutes = require("./routes/reports");

const app = express();
app.set("trust proxy", 1);
const frontendOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  : ["https://possia-apbmerchandising.vercel.app"];

app.use(
  cors({
    origin: frontendOrigins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  })
);

app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "POSSIA API is running." });
});
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use(authRoutes);
app.use(usersRoutes);
app.use(inventoryRoutes);
app.use(salesRoutes);
app.use(reportsRoutes);

const PORT = process.env.PORT || 5000;

// Connects to MongoDB and starts the HTTP listener.
async function startServer() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI must be set to your MongoDB Atlas connection string.");
  }
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET must be set before starting the server.");
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("MongoDB connected.");

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Server startup failed:", error.message);
  process.exitCode = 1;
});