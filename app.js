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

// EJS View Engine Setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware Setup
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Session middleware configuration
app.use(session({
    secret: 'super_secret_session_key',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // Session expires after 1 week (in miliseconds)
}));

// Flash messages middleware
app.use(flash());

// --- Custom Middlewares ---
// Middleware to check if user is logged in.
const checkAuthenticated = (req, res, next) => {
    if (req.session.user) {
        return next();
    } else {
        // For AJAX requests, send JSON. Otherwise, redirect.
        if (req.xhr || req.headers.accept.includes('json')) {
            return res.status(401).json({ success: false, errors: ['Please log in to view this resource.'] });
            }
        }
        req.flash('error', 'Please log in to view this resource.');
        res.redirect('/login');
    };

// Middleware to check if user is admin.
const checkAdmin = (req, res, next) => {
    if (!req.session.user) {
        req.flash('error', 'Access denied: Please log in.');
        return res.redirect('/login');
    }
    if (req.session.user.role === 'admin') {
        return next();
    } else {
        req.flash('error', 'Access denied: You must be an administrator.');
        return res.redirect('/dashboard'); // Use return to stop execution
    }
};

// --- Routes ---
// Home Route: Renders the main index page.
app.get('/', (req, res) => {
    res.render('index', { user: req.session.user, messages: req.flash('success')});
});

// PARTIAL ROUTES
// Renders the login form
app.get('/partials/login', (req, res) => {
    res.render('partials/login', { layout: false, messages: req.flash('success'), errors: req.flash('error') });
});

// Renders the register form 
app.get('/partials/register', (req, res) => {
    res.render('partials/register', { layout: false, messages: req.flash('error'), formData: req.flash('formData')[0] });
});

// Register Form Submission Route: Handles new user registration
app.post('/register', async (req, res) => {
    const { username, email, password, address, contact } = req.body;
    const userRole = 'regular'; // Default to 'regular' user role - admin role to be manually assigned in database

    // Validation
    const errors = [];
    if (!username || !email || !password || !address || !contact) {
        errors.push('All fields are required.');
    }

    const specialChars = ["`","~","!","@","#","$","%","^","&","*","-","+","=","_", "?", "/", "<", ">",".",",",":",";","(",")","{","}","[","]","|"];
    const hasSpecialChar = specialChars.some(char => password.includes(char));
    const hasCapital = /[A-Z]/.test(password); // Check for at least one capital letter

    if (password.length < 8 || !hasCapital || !hasSpecialChar) {
        let passwordError = 'Password must be at least 8 characters long';
        if (!hasCapital) {
            passwordError += ', include at least one capital letter';
        }
        if (!hasSpecialChar) {
            passwordError += ', and include at least one special character: `~!@#$%^&*-_+=`?/<>.,:;(){}[]|';
        }
        passwordError += '.';
        errors.push(passwordError);
    }

    if (errors.length > 0) {
        return res.json({ success: false, errors: errors, formData: req.body });
    }

    const sql = 'INSERT INTO users (username, email, password, address, phone_number, role) VALUES (?, ?, SHA1(?), ?, ?, ?)';
    try {
        await db.query(sql, [username, email, password, address, contact, userRole]);
        res.json({ success: true, message: 'Registration successful! Please log in.', redirectUrl: '/dashboard' });
    } catch (err) {
        console.error('Error during registration:', err);
        const serverErrors = [];
        if (err.code === 'ER_DUP_ENTRY') {
            serverErrors.push('Username or email already exists.');
        } else {
            serverErrors.push('Registration failed. Please try again.');
        }
        res.json({ success: false, errors: serverErrors, formData: req.body });
    }
});

// Login Form Submission Route: Authenticates user and sets session
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    const errors = [];
    if (!email || !password) {
        errors.push('All fields are required.');
    }

    if (errors.length > 0) {
        return res.json({ success: false, errors: errors });
    }

    const sql = 'SELECT * FROM users WHERE email = ? AND password = SHA1(?)';
    try {
        const [results] = await db.query(sql, [email, password]);

        if (results.length > 0) {
            req.session.user = results[0];
            res.json({ success: true, message: 'Login successful!', redirectUrl: '/dashboard' });
        } else {
            errors.push('Invalid email or password.');
            res.json({ success: false, errors: errors });
        }
    } catch (err) {
        console.error('Error during login:', err);
        errors.push('An error occurred during login.');
        res.json({ success: false, errors: errors });
    }
});

// Dashboard Route: Renders user dashboard (accessible to all logged-in users).
app.get('/dashboard', checkAuthenticated, (req, res) => {
    res.render('customerDashboard', { user: req.session.user, messages: req.flash('success')});
});

// Admin Dashboard Route: Renders admin dashboard (accessible only to logged-in admins).
app.get('/admin', checkAuthenticated, checkAdmin, (req, res) => {
    res.render('adminDashboard', { user: req.session.user, messages: req.flash('success')});
});

// Logout Route: Destroys user session and redirects to home.
app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('Error destroying session:', err);
        }
        res.redirect('/');
    });
});

// Customers List Route: Fetches and displays all users (customers) for admins.
app.get('/customers', checkAuthenticated, checkAdmin, async (req, res) => {
    try {
        const [users] = await db.query('SELECT user_id, username, first_name, last_name, email, phone_number, role FROM users');
        res.render('customerList', { users: users, user: req.session.user, messages: req.flash('success'), errors: req.flash('error') });
    } catch (err) {
        console.error('Error fetching users (customers):', err);
        req.flash('error', 'Error fetching customer list.');
        res.status(500).redirect('/dashboard');
    }
});

// DELETE route for users (customers): Allows admins to delete users. -- done by 24016508 Cham Shi Qi
app.post('/customers/delete/:id', checkAuthenticated, checkAdmin, async (req, res) => {
    const userId = req.params.id;

    try {
        const [result] = await db.query('DELETE FROM users WHERE user_id = ?', [userId]);
        if (result.affectedRows === 0) {
            req.flash('error', 'User (customer) not found.');
            return res.status(404).redirect('/customers');
        }
        req.flash('success', 'User (customer) deleted successfully!');
        res.redirect('/customers');
    } catch (err) {
        console.error('Error deleting user (customer):', err);
        req.flash('error', 'Error deleting user.');
        res.status(500).redirect('/customers');
    }
});

// Add Item form: Renders the form to add a book to the cart.
app.get('/cart/new', checkAuthenticated, async (req, res) => {
    try {
        const [books] = await db.query('SELECT id, title FROM Books');
        res.render('create_cart_item', {
            user: req.session.user,
            books,
            messages: req.flash('error')
        });
    } catch (err) {
        console.error('Error loading create cart item form:', err);
        req.flash('error', 'Could not load cart item form.');
        res.redirect('/dashboard');
    }
});

// Handle form POST: Adds a book to the user's cart.
app.post('/cart', checkAuthenticated, async (req, res) => {
    const { book_id, quantity } = req.body;
    const customer_id = req.session.user.user_id;

    try {
        await db.query(
            'INSERT INTO Cart (customer_id, book_id, quantity) VALUES (?,?,?)',
            [customer_id, book_id, quantity]
        );
        req.flash('success', 'Book added to cart successfully!');
        res.redirect('/dashboard');
    } catch (err) {
        console.error('Error adding to cart:', err);
        req.flash('error', 'Could not add to cart. Please try again.');
        res.redirect('/cart/new');
    }
});

// DELETE route for items in the cart -- done by 24016508 Cham Shi Qi
app.post('/cart/delete/:id', checkAuthenticated, async (req, res) => {
    const cartItemId = req.params.id;
    const customerId = req.session.user.user_id; // Get current user's ID

    try {
        // Ensure only the owner of the cart item can delete it
        const [result] = await db.query(
            'DELETE FROM Cart WHERE cart_item_id = ? AND customer_id = ?',
            [cartItemId, customerId]
        );

        if (result.affectedRows === 0) {
            req.flash('error', 'Cart item not found or you do not have permission to delete it.');
            return res.status(404).redirect('/dashboard');
        }

        req.flash('success', 'Cart item deleted successfully!');
        res.redirect('/dashboard');
    } catch (error) {
        console.error('Error deleting cart item:', error);
        req.flash('error', 'Error deleting cart item.');
        res.status(500).redirect('/dashboard');
    }
});


// Starting the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server started on http://localhost:${PORT}`);
});
