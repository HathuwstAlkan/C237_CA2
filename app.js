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
  host: 'c237-all.mysql.database.azure.com',
  user: 'c237admin',
  password: 'c2372025!',
  database: 'c237_004_24026438',
  port: 3306,
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

// Set activePage
app.use((req, res, next) => {
  const p = req.path;
  res.locals.activePage =
    p.startsWith('/books') ? 'books' :
    p.startsWith('/admin') ? 'admin' :
    p.startsWith('/customers') ? 'customers' :
    p.startsWith('/dashboard') ? 'dashboard' : '';
  next();
});

// cart count (optional)
app.use(async (req, res, next) => {
  try {
    if (!req.session.user) { res.locals.cartCount = 0; return next(); }
    const [r] = await db.query(
      'SELECT COALESCE(SUM(quantity),0) AS cnt FROM cart WHERE customer_id = ?',
      [req.session.user.customer_id]
    );
    res.locals.cartCount = (r[0] && r[0].cnt) || 0;
    next();
  } catch (e) {
    console.error('cartCount middleware error:', e);
    res.locals.cartCount = 0; next();
  }
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
      `INSERT INTO customers
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
      'SELECT customer_id, username, first_name, last_name, email, phone_number, address, role, password_hash FROM customers WHERE email = ?',
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

// customers admin list
app.get('/customers', checkAuthenticated, checkAdmin, async (req, res) => {
  try {
    const [users] = await db.query(
      'SELECT customer_id, username, first_name, last_name, email, phone_number, role FROM customers'
    );
    // NOTE: Ensure you have views/customerList.ejs. If not, change to res.json(users)
    res.render('admin/customerList', {
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
    const [result] = await db.query('DELETE FROM customers WHERE customer_id = ?', [userId]);
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

// Admin: individual book page (details + admin actions)
app.get('/admin/books/:id', checkAuthenticated, checkAdmin, async (req, res) => {
  try {
    const id = req.params.id;

    const [rows] = await db.query(
      `SELECT book_id, title, author, isbn, genre, price, published_year, published_date, image_url, description
       FROM books WHERE book_id = ? LIMIT 1`,
      [id]
    );
    if (!rows.length) {
      req.flash('error', 'Book not found.');
      return res.redirect('/books');
    }
    const book = rows[0];

    // Related books: same genre, exclude current
    const [related] = await db.query(
      `SELECT book_id, title, author, price, image_url
       FROM books WHERE genre <=> ? AND book_id <> ? ORDER BY title ASC LIMIT 6`,
      [book.genre, id]
    );

    res.render('admin/book', {
      user: req.session.user,
      book,
      related
    });
  } catch (err) {
    console.error('Error loading admin book page:', err);
    req.flash('error', 'Could not load admin book page.');
    res.redirect('/books');
  }
});

// cart routes
app.get('/cart/new', checkAuthenticated, async (req, res) => {
  try {
    const [books] = await db.query('SELECT book_id, title FROM books');
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
      'INSERT INTO cart (customer_id, book_id, quantity) VALUES (?, ?, ?)',
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
      'DELETE FROM cart WHERE cart_item_id = ? AND customer_id = ?',
      [cartItemId, customerId]
    );
    if (result.affectedRows === 0) {
      req.flash('error', 'cart item not found or you do not have permission to delete it.');
      return res.status(404).redirect('/dashboard');
    }
    req.flash('success', 'cart item deleted successfully!');
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Error deleting cart item:', err);
    req.flash('error', 'Error deleting cart item.');
    res.status(500).redirect('/dashboard');
  }
});

// ==============================
// books: LIST with search/filter/sort
// Public: viewable by all
// ==============================
app.get('/books', async (req, res) => {
  try {
    const { search = '', genre = '', sort = 'title_asc' } = req.query;

    let sql = `SELECT book_id, title, author, isbn, genre, price, published_year, published_date, image_url
               FROM books WHERE 1=1`;
    const params = [];

    if (search) {
      const term = `%${search}%`;
      sql += ` AND (title LIKE ? OR author LIKE ? OR isbn LIKE ?)`;
      params.push(term, term, term);
    }
    if (genre && genre !== 'All') {
      sql += ` AND genre = ?`;
      params.push(genre);
    }

    // Sorting
    let orderBy = ' ORDER BY title ASC';
    switch (sort) {
      case 'title_desc': orderBy = ' ORDER BY title DESC'; break;
      case 'author_asc': orderBy = ' ORDER BY author ASC'; break;
      case 'author_desc': orderBy = ' ORDER BY author DESC'; break;
      case 'year_desc': orderBy = ' ORDER BY published_year DESC'; break;
      case 'year_asc': orderBy = ' ORDER BY published_year ASC'; break;
      case 'price_asc': orderBy = ' ORDER BY price ASC'; break;
      case 'price_desc': orderBy = ' ORDER BY price DESC'; break;
    }
    sql += orderBy;

    const [books] = await db.query(sql, params);
    const [genresRows] = await db.query(`SELECT DISTINCT genre FROM books WHERE genre IS NOT NULL AND genre <> '' ORDER BY genre ASC`);
    const genres = ['All', ...genresRows.map(r => r.genre)];

    res.render('books/index', {
      user: req.session.user,
      books,
      genres,
      q: { search, genre, sort }
    });
  } catch (err) {
    console.error('Error listing books:', err);
    req.flash('error', 'Could not load books.');
    res.redirect('/dashboard');
  }
});

// ==============================
// books: NEW form (admin only)
// ==============================
app.get('/books/new', checkAuthenticated, checkAdmin, async (req, res) => {
  res.render('books/new', {
    user: req.session.user,
    formData: {},
    errors: req.flash('error'),
    messages: req.flash('success')
  });
});

// ==============================
// books: CREATE (admin only)
// ==============================
app.post('/books', checkAuthenticated, checkAdmin, async (req, res) => {
  try {
    const { title, author, isbn, genre, price, published_year, published_date, image_url, description } = req.body;
    const errors = [];

    if (!title || !author || !isbn || !price) errors.push('Title, author, ISBN, and price are required.');
    if (price && isNaN(price)) errors.push('Price must be a number.');
    if (published_year && (isNaN(published_year) || published_year < 1500 || published_year > (new Date().getFullYear()+1))) {
      errors.push('Published year is invalid.');
    }

    if (errors.length) {
      req.flash('error', errors);
      return res.redirect('/books/new');
    }

    await db.query(
      `INSERT INTO books (title, author, isbn, genre, price, published_year, published_date, image_url, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title, author, isbn || null, genre || null,
        parseFloat(price),
        published_year ? parseInt(published_year) : null,
        published_date || null,
        image_url || null,
        description || null
      ]
    );

    req.flash('success', 'Book created.');
    res.redirect('/books');
  } catch (err) {
    console.error('Error creating book:', err);
    if (err.code === 'ER_DUP_ENTRY') {
      req.flash('error', 'ISBN already exists.');
    } else {
      req.flash('error', 'Failed to create book.');
    }
    res.redirect('/books/new');
  }
});

// ==============================
// books: EDIT form (admin only)
// ==============================
app.get('/books/:id/edit', checkAuthenticated, checkAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const [rows] = await db.query(
      `SELECT book_id, title, author, isbn, genre, price, published_year, published_date, image_url, description
       FROM books WHERE book_id = ? LIMIT 1`, [id]
    );
    if (!rows.length) {
      req.flash('error', 'Book not found.');
      return res.redirect('/books');
    }
    res.render('books/edit', {
      user: req.session.user,
      book: rows[0],
      errors: req.flash('error'),
      messages: req.flash('success')
    });
  } catch (err) {
    console.error('Error loading edit form:', err);
    req.flash('error', 'Could not load edit form.');
    res.redirect('/books');
  }
});

// ==============================
// books: UPDATE (admin only)
// ==============================
app.post('/books/:id/edit', checkAuthenticated, checkAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { title, author, isbn, genre, price, published_year, published_date, image_url, description } = req.body;
    const errors = [];

    if (!title || !author || !isbn || !price) errors.push('Title, author, ISBN, and price are required.');
    if (price && isNaN(price)) errors.push('Price must be a number.');
    if (published_year && (isNaN(published_year) || published_year < 1500 || published_year > (new Date().getFullYear()+1))) {
      errors.push('Published year is invalid.');
    }

    if (errors.length) {
      req.flash('error', errors);
      return res.redirect(`/books/${id}/edit`);
    }

    await db.query(
      `UPDATE books
       SET title = ?, author = ?, isbn = ?, genre = ?, price = ?, published_year = ?, published_date = ?, image_url = ?, description = ?
       WHERE book_id = ?`,
      [
        title, author, isbn || null, genre || null,
        parseFloat(price),
        published_year ? parseInt(published_year) : null,
        published_date || null,
        image_url || null,
        description || null,
        id
      ]
    );

    req.flash('success', 'Book updated.');
    res.redirect('/books');
  } catch (err) {
    console.error('Error updating book:', err);
    if (err.code === 'ER_DUP_ENTRY') {
      req.flash('error', 'ISBN already exists.');
    } else {
      req.flash('error', 'Failed to update book.');
    }
    res.redirect(`/books/${req.params.id}/edit`);
  }
});

// ==============================
// books: DELETE (admin only)
// ==============================
app.post('/books/:id/delete', checkAuthenticated, checkAdmin, async (req, res) => {
  const id = req.params.id;
  try {
    // Remove dependents first due to FKs
    await db.query('DELETE FROM stocks WHERE book_id = ?', [id]);
    await db.query('DELETE FROM cart WHERE book_id = ?', [id]);
    await db.query('DELETE FROM books WHERE book_id = ?', [id]);

    req.flash('success', 'Book deleted.');
    res.redirect('/books');
  } catch (err) {
    console.error('Error deleting book:', err);
    req.flash('error', 'Failed to delete book.');
    res.redirect('/books');
  }
});

// ==============================
// books: SHOW (individual book)
// Public: viewable by all
// ==============================
app.get('/books/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const [rows] = await db.query(
      `SELECT book_id, title, author, isbn, genre, price, published_year, published_date, image_url, description
       FROM books WHERE book_id = ? LIMIT 1`, [id]
    );
    if (!rows.length) {
      req.flash('error', 'Book not found.');
      return res.redirect('/books');
    }
    const book = rows[0];

    // Related books: same genre, not the same book
    const [related] = await db.query(
      `SELECT book_id, title, author, price, image_url
       FROM books WHERE genre <=> ? AND book_id <> ? ORDER BY title ASC LIMIT 6`,
      [book.genre, id]
    );

    res.render('books/show', {
      user: req.session.user,
      book,
      related
    });
  } catch (err) {
    console.error('Error showing book:', err);
    req.flash('error', 'Could not load book.');
    res.redirect('/books');
  }
});

/* ==============================
   Start server
   ============================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on http://localhost:${PORT}`));
