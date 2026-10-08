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

app.use(express.json());

// Session config
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

// Restrict access to Inventory and Report for Staff users
app.use((req, res, next) => {
    const restrictedPages = ["/inventory.html", "/reports.html"];
    const role = req.session.user?.role?.toLowerCase();

    if (req.method === "GET" &&
        restrictedPages.includes(req.path) &&
        role === "staff") {
        return res.status(403).json({
            message: "Sorry, You do not have permission for this action."
        });
    }

    next();
});
//========================

// Serve static files
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

    // Temp env accounts to be replaced with a database user query later.
    const validEmail = process.env.DEMO_EMAIL?.trim();
    const validPassword = process.env.DEMO_PASSWORD;
    const configuredRole = process.env.DEMO_ROLE?.trim();
    const role = ["Admin", "Staff"].find(
        (allowedRole) =>
            allowedRole.toLowerCase() === configuredRole?.toLowerCase()
    );
    const staffEmail = process.env.DEMO_STAFF_EMAIL?.trim();
    const staffPassword = process.env.DEMO_STAFF_PASSWORD;
    const hasStaffEmail = Boolean(staffEmail);
    const hasStaffPassword = Boolean(staffPassword);

    //===========================================================================

    // Check for missing or invalid env
    if (!validEmail || !validPassword ||
        !process.env.SESSION_SECRET || !role ||
        hasStaffEmail !== hasStaffPassword) {
        return res.status(500).json({
            message: "Server configuration is incomplete or invalid."
        });
    }

    const demoUsers = [
        { email: validEmail, password: validPassword, role }
    ];

    if (hasStaffEmail) {
        demoUsers.push({
            email: staffEmail,
            password: staffPassword,
            role: "Staff"
        });
    }

    const user = demoUsers.find(
        (account) =>
            email.trim().toLowerCase() === account.email.toLowerCase() &&
            password === account.password
    );
    //========================

    // Temp credential check for development
    if (!user) {
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

        // Keep the authenticated account's role in its server-side session.
        req.session.user = {
            email: user.email,
            role: user.role
        };
        //========================

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