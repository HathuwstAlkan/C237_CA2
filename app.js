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
    secret: 'your_super_secret_key_for_session', // IMPORTANT: Change this to a strong, random string
    resave: false, // Don't save session if unmodified
    saveUninitialized: true, // Save new but uninitialized sessions
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // Session expires after 1 week
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
    if (!req.session.user || req.session.user.role !== 'admin') {
        req.flash('error', 'Access denied: You must be an administrator.');
        return res.redirect('/dashboard');
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

// Middleware to validate registration input.
const validateRegistration = (req, res, next) => {
    const { username, email, password, address, contact } = req.body;
    if (!username || !email || !password || !address || !contact) {
        req.flash('error', 'All fields are required.');
        req.flash('formData', req.body);
        return res.redirect('/register');
    }
    if (password.length < 6) {
        req.flash('error', 'Password should be at least 6 characters long.');
        req.flash('formData', req.body);
        return res.redirect('/register');
    }
    next();
};

// Register Form Submission Route: Handles new user registration.
app.post('/register', validateRegistration, (req, res) => {
    const { username, email, password, address, contact, role } = req.body;
    const userRole = (role === 'admin' && req.session.user && req.session.user.role === 'admin') ? 'admin' : 'regular'; // Only admin can register other admins

    // IMPORTANT: Use bcrypt for password hashing in production! SHA1 is insecure.
    const sql = 'INSERT INTO users (username, email, password, address, phone_number, role) VALUES (?, ?, SHA1(?), ?, ?, ?)';
    db.execute(sql, [username, email, password, address, contact, userRole])
        .then(result => {
            console.log('User registered:', result);
            req.flash('success', 'Registration successful! Please log in.');
            res.redirect('/login');
        })
        .catch(err => {
            console.error('Error during registration:', err);
            if (err.code === 'ER_DUP_ENTRY') {
                req.flash('error', 'Username or email already exists.');
            } else {
                req.flash('error', 'Registration failed. Please try again.');
            }
            req.flash('formData', req.body);
            res.redirect('/register');
        });
});

// Login Form Submission Route: Authenticates user and sets session.
app.post('/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        req.flash('error', 'All fields are required.');
        return res.redirect('/login');
    }

    // IMPORTANT: Use bcrypt.compare() with bcrypt hashes in production!
    const sql = 'SELECT * FROM users WHERE email = ? AND password = SHA1(?)';
    db.execute(sql, [email, password])
        .then(([results]) => {
            if (results.length > 0) {
                req.session.user = results[0];
                req.flash('success', 'Login successful!');
                res.redirect('/dashboard');
            } else {
                req.flash('error', 'Invalid email or password.');
                res.redirect('/login');
            }
        })
        .catch(err => {
            console.error('Error during login:', err);
            req.flash('error', 'An error occurred during login.');
            res.redirect('/login');
        });
});

// Dashboard Route: Renders the user dashboard (accessible to all logged-in users).
app.get('/dashboard', checkAuthenticated, (req, res) => {
    res.render('customerDashboard', { user: req.session.user, messages: req.flash('success')});
});

// Admin Dashboard Route: Renders the admin dashboard (accessible only to logged-in admins).
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
app.get('/customers', checkAuthenticated, checkAdmin, (req, res) => {
    db.execute('SELECT user_id, username, first_name, last_name, email, phone_number, role FROM users')
        .then(([users]) => {
            res.render('customerList', { users: users, user: req.session.user, messages: req.flash('success'), errors: req.flash('error') });
        })
        .catch(err => {
            console.error('Error fetching users (customers):', err);
            req.flash('error', 'Error fetching customer list.');
            res.status(500).redirect('/dashboard');
        });
});

// DELETE route for users (customers): Allows admins to delete users.
app.post('/customers/delete/:id', checkAuthenticated, checkAdmin, (req, res) => {
    const userId = req.params.id;

    db.execute('DELETE FROM users WHERE user_id = ?', [userId])
        .then(([result]) => {
            if (result.affectedRows === 0) {
                req.flash('error', 'User (customer) not found.');
                return res.status(404).redirect('/customers');
            }
            req.flash('success', 'User (customer) deleted successfully!');
            res.redirect('/customers');
        })
        .catch(err => {
            console.error('Error deleting user (customer):', err);
            req.flash('error', 'Error deleting user.');
            res.status(500).redirect('/customers');
        });
});

// Add Item form: Renders the form to add a book to the cart.
app.get('/cart/new', checkAuthenticated, async (req, res) => {
    try {
        // Fetches available books for the dropdown
        const [books] = await db.execute('SELECT id, title FROM Books');
        res.render('create_cart_item', {
            user: req.session.user,
            books,
            messages: req.flash('error') // Pass error messages to the form
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
    const customer_id = req.session.user.user_id; // Using user_id from session for customer_id

    try {
        await db.execute(
            'INSERT INTO Cart (customer_id, book_id, quantity) VALUES (?,?,?)',
            [customer_id, book_id, quantity]
        );
        req.flash('success', 'Book added to cart successfully!');
        res.redirect('/dashboard'); // Redirect to dashboard or a cart view
    } catch (err) {
        console.error('Error adding to cart:', err);
        req.flash('error', 'Could not add to cart. Please try again.');
        res.redirect('/cart/new');
    }
});

// Starting the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});
