const express = require("express");
const session = require("express-session");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({
    path: path.join(__dirname, ".env")
});

const app = express();
const PORT = process.env.PORT || 3000;

const frontendPath = path.join(__dirname, "../Frontend");

// Parse JSON requests from the frontend
app.use(express.json());

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 30 * 60 * 1000 // 30 minutes
    }
}));

// Serve CSS, images, and other frontend assets
app.use(express.static(frontendPath, {
    index: false
}));

// Open the login page
app.get("/", (req, res) => {
    res.sendFile(path.join(frontendPath, "index.html"));
});

// Handle login requests
app.post("/api/login", (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({
            message: "Please enter your email and password."
        });
    }

    const validEmail = process.env.DEMO_EMAIL;
    const validPassword = process.env.DEMO_PASSWORD;

    if (!validEmail || !validPassword ||
        !process.env.SESSION_SECRET) {
        return res.status(500).json({
            message: "Server configuration is incomplete."
        });
    }

    // Temporary credential check for development
    if (
        email.trim().toLowerCase() !==
            validEmail.trim().toLowerCase() ||
        password !== validPassword
    ) {
        return res.status(401).json({
            message: "Invalid email or password."
        });
    }

    // Regenerate the session after successful authentication
    req.session.regenerate((err) => {
        if (err) {
            return res.status(500).json({
                message: "Unable to create a session."
            });
        }

        req.session.user = {
            email: validEmail,
            role: "Admin"
        };

        req.session.save((err) => {
            if (err) {
                return res.status(500).json({
                    message: "Unable to save your session."
                });
            }

            res.json({
                message: "Login successful.",
                redirect: "/dashboard"
            });
        });
    });
});

// Protect the dashboard
app.get("/dashboard", (req, res) => {
    if (!req.session.user) {
        return res.redirect("/");
    }

    res.sendFile(
        path.join(frontendPath, "dashboard.html")
    );
});

// Check whether the user is logged in
app.get("/api/session", (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({
            authenticated: false
        });
    }

    res.json({
        authenticated: true,
        user: req.session.user
    });
});

// Logout
app.post("/api/logout", (req, res, next) => {
    req.session.destroy((err) => {
        if (err) {
            return next(err);
        }

        res.clearCookie("connect.sid");
        res.json({
            message: "Logged out successfully."
        });
    });
});

app.listen(PORT, () => {
    console.log(`POSSIA running at http://localhost:${PORT}`);
});