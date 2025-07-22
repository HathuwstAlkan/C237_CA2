const express = require('express');
const path = require('path');
const mysql = require('mysql2/promise');
const session = require('express-session');
const flash = require('connect-flash');

const app = express();

// Database connection
const db = mysql.createConnection({
    host: '29vx1m.h.filess.io',
    user: 'C237CA2_paidplant',
    password: '3c01197c427f182364f4461deb0613ea96517367',
    database: 'C237CA2_paidplant',
    port: 61002,
});

// Test database connection
db.getConnection()
    .then(connection => {
        console.log('Connected to database pool successfully!');
        connection.release();
    })
    .catch(err => {
        console.error('Failed to connect to database pool:', err);
        process.exit(1);
    });

// --- EJS View Engine Setup ---
// Set EJS as the template engine for rendering dynamic content
app.set('view engine', 'ejs');
// Specify the directory where your EJS template files are located
app.set('views', path.join(__dirname, 'views'));

// --- Middleware Setup ---
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false }));

// Session middleware
app.use(session({
    secret: 'secret_key',
    resave: false,
    saveUninitialized: true, 
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // Session expires after 1 week (in milliseconds)
}));

// Flash messages middleware
app.use(flash());

// Middleware to check if user is logged in.
const checkAuthenticated = (req, res, next) => {
    if (req.session.user) {
        return next();
    } else {
        req.flash('error', 'Please log in to view this resource');
        res.redirect('/login');
    }
};

// Middleware to check if user is admin.
const checkAdmin = (req, res, next) => {
    // Ensure user is authenticated before checking role
    if (!req.session.user) {
        req.flash('error', 'Access denied: Please log in.');
        return res.redirect('/login');
    }
    if (req.session.user.role === 'admin') {
        return next();
    } else {
        req.flash('error', 'Access denied: You must be an administrator.');
        res.redirect('/dashboard'); // Redirect to dashboard or home for non-admins
    }
};

// --- Routes ---

// Home Route
app.get('/', (req, res) => {
    res.render('index', {
        user: req.session.user,
        messages: req.flash('success')
    });
});

// Register Page Route
app.get('/register', (req, res) => {
    res.render('register', { messages: req.flash('error'), formData: req.flash('formData')[0] });
});

// Customers List Route: Fetches all customers from the database and renders them
// This serves as your "View all items" (for customers) feature
app.get('/customers', async (req, res) => {
    try {
        const [customers] = await db.execute('SELECT * FROM customers');
        res.render('customerList', { customers: customers });
    } catch (error) {
        console.error('Error fetching customers:', error);
        res.status(500).send('Error fetching customer list.');
    }
});

// DELETE route for customers
// This should be protected by authentication/authorization middleware in a real app.
app.post('/customers/delete/:id', async (req, res) => {
    const customerId = req.params.id;

    try {
        // --- IMPORTANT: Implement Role-Based Authorization Here ---
        // You MUST check if the logged-in user has 'admin' role before allowing deletion.
        // This will involve checking 'req.session.user.role' after a user logs in.
        // For example:
        // if (!req.session.user || req.session.user.role !== 'admin') {
        //     req.flash('error', 'Access Denied: Only administrators can delete records.');
        //     return res.status(403).redirect('/customers'); // Redirect or render an error page
        // }

        const [result] = await db.execute('DELETE FROM customers WHERE customer_id = ?', [customerId]);

        if (result.affectedRows === 0) {
            req.flash('error', 'Customer not found.'); // Use flash for messages
            return res.status(404).redirect('/customers');
        }

        req.flash('success', 'Customer deleted successfully!'); // Set success flash message
        res.redirect('/customers');

    } catch (error) {
        console.error('Error deleting customer:', error);
        req.flash('error', 'Error deleting customer.');
        res.status(500).redirect('/customers');
    }
});

// --- Start the Server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('Press Ctrl+C to stop the server.');
});
