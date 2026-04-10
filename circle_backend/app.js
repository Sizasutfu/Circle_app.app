require("dotenv").config();

const express = require("express");
const userRoutes = require("./routes/userRoutes");

const app = express();

app.use(express.json());

// Routes
app.use("/api/users", userRoutes);

// Global error handler
app.use((err, req, res, next) => {
  console.error("[Unhandled Error]", err);
  res.status(500).json({ success: false, message: "Internal server error." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;