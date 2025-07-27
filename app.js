'use strict';

const express = require('express');
const path = require('path');
const mysql = require('mysql2/promise');
const session = require('express-session');
const flash = require('connect-flash');
const bcrypt = require('bcrypt');

const app = express();

/* ==============================
   Database connection (pool)
   ============================== */
const db = mysql.createPool({
  host: '29vx1m.h.filess.io',
  user: 'C237CA2_paidplant',
  password: '3c01197c427f182364f4461deb0613ea96517367',
  database: 'C237CA2_paidplant',
  port: 61002,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

/* ==============================
   View engine & middleware
   ============================== */
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: 'super_secret_session_key',
  resave: false,
  saveUninitialized: true,
  // Session expires after 1 week (in milliseconds)
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

app.use(flash());

// Make common locals available in all EJS views
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.messages = req.flash('success');
  res.locals.errors = req.flash('error');
  next();
});

/* ==============================
   Auth helpers
   ============================== */
const wantsJSON = (req) => {
  const acc = (req.headers && req.headers.accept) || '';
  return req.xhr || acc.includes('json');
};

const checkAuthenticated = (req, res, next) => {
  if (req.session.user) return next();
  if (wantsJSON(req)) {
    return res.status(401).json({ success: false, errors: ['Please log in to view this resource.'] });
  }
  req.flash('error', 'Please log in to view this resource.');
  return res.redirect('/');
};

const checkAdmin = (req, res, next) => {
  if (!req.session.user) {
    req.flash('error', 'Access denied: Please log in.');
    return res.redirect('/');
  }
  if (req.session.user.role === 'admin') return next();
  req.flash('error', 'Access denied: You must be an administrator.');
  return res.redirect('/dashboard');
};

/* ==============================
   Routes
   ============================== */
// Home (landing with dynamic partial loader)
app.get('/', (req, res) => {
  res.render('index');
});

// Partials to be injected into #auth-form-area
app.get('/partials/login', (req, res) => {
  res.render('partials/login', { layout: false });
});

app.get('/partials/register', (req, res) => {
  const formData = req.flash('formData')[0] || null;
  res.render('partials/register', { layout: false, formData });
});

// Registration
app.post('/register', async (req, res) => {
  try {
    const {
      username,
      first_name,
      last_name,
      email,
      password,
      address,
      contact,
      phone_number
    } = req.body;

    // Keep required fields minimal; password only needs to be present
    const phone = phone_number || contact || null;
    const errors = [];

    if (!username || !first_name || !last_name || !email || !password) {
      errors.push('Username, first name, last name, email, and password are required.');
    }

    // Optional: keep phone validation (you can remove this too if you want no rule)
    if (phone && !/^\d{8}$/.test(phone)) {
      errors.push('Phone number must be 8 digits.');
    }

    if (errors.length) {
      return res.json({ success: false, errors, formData: req.body });
    }

    // Hash whatever password is provided (no complexity checks)
    const password_hash = await bcrypt.hash(password, 10);

    await db.query(
      `INSERT INTO Customers
       (username, password_hash, role, first_name, last_name, email, phone_number, address)
       VALUES (?, ?, 'regular', ?, ?, ?, ?, ?)`,
      [username, password_hash, first_name, last_name, email, phone || null, address || null]
    );

    return res.json({
      success: true,
      message: 'Registration successful! Please log in.',
      redirectUrl: '/'   // your index.ejs will handle loading the login partial
    });
  } catch (err) {
    console.error('Error during registration:', err);
    const serverErrors = [];
    if (err && err.code === 'ER_DUP_ENTRY') {
      serverErrors.push('Username or email already exists.');
    } else {
      serverErrors.push('Registration failed. Please try again.');
    }
    return res.json({ success: false, errors: serverErrors, formData: req.body });
  }
});

// Login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.json({ success: false, errors: ['Email and password are required.'] });
    }

    const [rows] = await db.query(
      'SELECT customer_id, username, first_name, last_name, email, phone_number, address, role, password_hash FROM Customers WHERE email = ?',
      [email]
    );
    if (!rows || rows.length === 0) {
      return res.json({ success: false, errors: ['Invalid email or password.'] });
    }

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.json({ success: false, errors: ['Invalid email or password.'] });
    }

    req.session.user = {
      customer_id: user.customer_id,
      username: user.username,
      role: user.role,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      phone_number: user.phone_number,
      address: user.address
    };

    return res.json({ success: true, message: 'Login successful.', redirectUrl: '/dashboard' });
  } catch (err) {
    console.error('Error during login:', err);
    return res.json({ success: false, errors: ['Login failed. Please try again.'] });
  }
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// Dashboards
app.get('/dashboard', checkAuthenticated, (req, res) => {
  if (req.session.user.role === 'admin') {
    return res.render('adminDashboard', { user: req.session.user });
  }
  return res.render('customerDashboard', { user: req.session.user });
});

app.get('/admin', checkAuthenticated, checkAdmin, (req, res) => {
  return res.render('adminDashboard', { user: req.session.user });
});

// Customers admin list
app.get('/customers', checkAuthenticated, checkAdmin, async (req, res) => {
  try {
    const [users] = await db.query(
      'SELECT customer_id, username, first_name, last_name, email, phone_number, role FROM Customers'
    );
    // NOTE: Ensure you have views/customerList.ejs. If not, change to res.json(users)
    res.render('customerList', {
      users,
      user: req.session.user,
      messages: req.flash('success'),
      errors: req.flash('error')
    });
  } catch (err) {
    console.error('Error fetching users (customers):', err);
    req.flash('error', 'Error fetching customer list.');
    res.status(500).redirect('/dashboard');
  }
});

app.post('/customers/delete/:id', checkAuthenticated, checkAdmin, async (req, res) => {
  const userId = req.params.id;
  try {
    const [result] = await db.query('DELETE FROM Customers WHERE customer_id = ?', [userId]);
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

// Cart routes
app.get('/cart/new', checkAuthenticated, async (req, res) => {
  try {
    const [books] = await db.query('SELECT book_id, title FROM Books');
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

app.post('/cart', checkAuthenticated, async (req, res) => {
  const { book_id, quantity } = req.body;
  const customer_id = req.session.user.customer_id;
  try {
    await db.query(
      'INSERT INTO Cart (customer_id, book_id, quantity) VALUES (?, ?, ?)',
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

app.post('/cart/delete/:id', checkAuthenticated, async (req, res) => {
  const cartItemId = req.params.id;
  const customerId = req.session.user.customer_id;
  try {
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
  } catch (err) {
    console.error('Error deleting cart item:', err);
    req.flash('error', 'Error deleting cart item.');
    res.status(500).redirect('/dashboard');
  }
});

/* ==============================
   Start server
   ============================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on http://localhost:${PORT}`));
