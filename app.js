const express = require('express');
const path = require('path');
const mysql = require('mysql2');
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

// --- EJS View Engine Setup ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware Setup
app.use(express.urlencoded({ extended: false })); // Parses URL-encoded bodies from forms
app.use(express.json()); // Parses JSON bodies
app.use(express.static(path.join(__dirname, 'public'))); // Serves static files from 'public' folder

// Session middleware configuration
app.use(session({
    secret: 'secret_key',
    resave: false,
    saveUninitialized: true, 
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // Session expires after 1 week (in milliseconds)
}));

// Flash messages middleware for temporary messages
app.use(flash());

// EJS View Engine Setup
app.set('view engine', 'ejs'); // Sets EJS as the template engine
app.set('views', path.join(__dirname, 'views')); // Specifies the views directory

// Custom Middleware
// Middleware to check if user is logged in.
const checkAuthenticated = (req, res, next) => {
    if (req.session.user) {
        return next();
    } else {
        req.flash('error', 'Please log in to view this resource.');
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
    next();
};

// Routes
// Home Route: Renders the index page.
app.get('/', (req, res) => {
    res.render('index', { user: req.session.user, messages: req.flash('success')});
});

// Register Page Route: Renders the registration form.
app.get('/register', (req, res) => {
    res.render('register', { messages: req.flash('error'), formData: req.flash('formData')[0] });
});

// Login Page Route: Renders the login form.
app.get('/login', (req, res) => {
    res.render('login', { messages: req.flash('success'), errors: req.flash('error') });
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


// Add Item form
app.get('/cart/new', checkAuthenticated, async (req, res) => {
    try {
        const [books] = await db.execute('SELECT id, title FROM Books');
        res.render('create_cart_item', {
            user: req.session.user,
            books,
            messages: req.flash('error')
        });
    } catch (err) {
        console.error('Error loading create form:', err);
        req.flash('error', 'Could not load form');
        res.redirect('/dashboard');
    }
});

// Handle form POST
app.post('/cart', checkAuthenticated, async (req, res) => {
    const { book_id, quantity } = req.body;
    const customer_id = req.session.user.id;
    try {
        await db.execute(
            'INSERT INTO Cart (customer_id, book_id, quantity) VALUES (?,?,?)',
            [customer_id, book_id, quantity]
        );
        req.flash('success', 'Book added to cart!');
        res.redirect('/cart');
    } catch (err) {
        console.error('Error adding to cart:', err);
        req.flash('error', 'Could not add to cart');
        res.redirect('/cart/new');
    }
});

// Starting the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});
