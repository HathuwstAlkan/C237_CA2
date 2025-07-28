const express = require('express');
const path = require('path');
const mysql = require('mysql2/promise');
const session = require('express-session');
const flash = require('connect-flash');
const bcrypt = require('bcrypt');
const multer = require('multer'); // For file uploads
const fs = require('fs'); // For file system operations (e.g., deleting old files)

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
    Multer Storage Setup for Images
    ============================== */
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, 'public', 'uploads');
        // Create the uploads directory if it doesn't exist
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        // Use a unique name for the file to prevent collisions
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

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
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // Session expires after 1 week
}));

app.use(flash());

app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.messages = req.flash('success');
    res.locals.errors = req.flash('error');
    next();
});

// Set activePage for navbar highlighting
app.use((req, res, next) => {
    const p = req.path;
    res.locals.activePage =
        p === '/books' || (p.startsWith('/books/') && !p.startsWith('/admin/books')) ? 'books' : // Customer books list or single book
        p === '/admin/books' || p.startsWith('/admin/books/') ? 'admin-books' : // Admin books list or single book
        p.startsWith('/admin/stocks') ? 'stocks' :
        p.startsWith('/admin') ? 'admin' : // Catches /admin and /admin/dashboard
        p.startsWith('/customers') ? 'customers' :
        p.startsWith('/dashboard') ? 'dashboard' :
        p.startsWith('/profile') ? 'profile' :
        p.startsWith('/login') ? 'login' :
        p.startsWith('/register') ? 'register' :
        ''; // Default if no match
    next();
});

// cart count (only for regular users)
app.use(async (req, res, next) => {
    try {
        if (!req.session.user || req.session.user.role === 'admin') {
            res.locals.cartCount = 0;
            return next();
        }
        const [r] = await db.query(
            'SELECT COALESCE(SUM(quantity),0) AS cnt FROM cart WHERE customer_id = ?',
            [req.session.user.customer_id]
        );
        res.locals.cartCount = (r[0] && r[0].cnt) || 0;
        next();
    } catch (e) {
        console.error('cartCount middleware error:', e);
        res.locals.cartCount = 0;
        next();
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
    return res.redirect('partials/login');
};

const checkAdmin = (req, res, next) => {
    if (!req.session.user) {
        req.flash('error', 'Access denied: Please log in.');
        return res.redirect('partials/login');
    }
    if (req.session.user.role === 'admin') return next();
    req.flash('error', 'Access denied: You must be an administrator.');
    return res.redirect('/dashboard');
};

/* ==============================
    Routes
    ============================== */
// Landing page (registration form)
app.get('/', (req, res) => {
    res.render('registration');
});

// Explicit Login Page
app.get('/partials/login', (req, res) => {
    res.render('partials/login', {
        messages: req.flash('success'),
        errors: req.flash('error')
    });
});
// Explicit Register Page
app.get('/partials/register', (req, res) => {
    const formData = req.flash('formData')[0] || {};
    res.render('partials/register', {
        formData,
        messages: req.flash('success'),
        errors: req.flash('error')
    });
});

// Registration POST
app.post('/register', async (req, res) => {
    try {
        const {
            username,
            first_name,
            last_name,
            email,
            password,
            address,
            phone_number
        } = req.body;

        const errors = [];
        if (!username || !first_name || !last_name || !email || !password) {
            errors.push('Username, first name, last name, email, and password are required.');
        }
        if (phone_number && !/^\d{8}$/.test(phone_number)) {
            errors.push('Phone number must be 8 digits.');
        }

        if (errors.length) {
            if (req.xhr || req.headers.accept.includes('json')) {
                return res.json({ success: false, errors, formData: req.body });
            }
            req.flash('error', errors);
            req.flash('formData', req.body); // Preserve form data
            return res.redirect('/register');
        }

        const password_hash = await bcrypt.hash(password, 10);

        await db.query(
            `INSERT INTO customers
             (username, password_hash, role, first_name, last_name, email, phone_number, address)
             VALUES (?, ?, 'regular', ?, ?, ?, ?, ?)`,
            [username, password_hash, first_name, last_name, email, phone_number || null, address || null]
        );

        if (req.xhr || req.headers.accept.includes('json')) {
            return res.json({ success: true, message: 'Registration successful! Please log in.', redirectUrl: 'partials/login' });
        }
        req.flash('success', 'Registration successful! Please log in.');
        return res.redirect('partials/login');
    } catch (err) {
        console.error('Error during registration:', err);
        let serverErrors = [];
        if (err && err.code === 'ER_DUP_ENTRY') {
            serverErrors.push('Username or email already exists.');
        } else {
            serverErrors.push('Registration failed. Please try again.');
        }
        if (req.xhr || req.headers.accept.includes('json')) {
            return res.json({ success: false, errors: serverErrors, formData: req.body });
        }
        req.flash('error', serverErrors);
        req.flash('formData', req.body); // Preserve form data
        return res.redirect('/register');
    }
});

// Login POST
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            const errors = ['Email and password are required.'];
            if (req.xhr || req.headers.accept.includes('json')) {
                return res.json({ success: false, errors });
            }
            req.flash('error', errors);
            return res.redirect('partials/login');
        }

        const [rows] = await db.query(
            'SELECT customer_id, username, first_name, last_name, email, phone_number, address, role, password_hash, profile_image_url FROM customers WHERE email = ?',
            [email]
        );
        if (!rows || rows.length === 0) {
            const errors = ['Invalid email or password.'];
            if (req.xhr || req.headers.accept.includes('json')) {
                return res.json({ success: false, errors });
            }
            req.flash('error', errors);
            return res.redirect('partials/login');
        }

        const user = rows[0];
        if (!user.password_hash) {
            console.error('User found but password_hash is missing:', user);
            const errors = ['Invalid email or password.'];
            if (req.xhr || req.headers.accept.includes('json')) {
                return res.json({ success: false, errors });
            }
            req.flash('error', errors);
            return res.redirect('partials/login');
        }

        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) {
            const errors = ['Invalid email or password.'];
            if (req.xhr || req.headers.accept.includes('json')) {
                return res.json({ success: false, errors });
            }
            req.flash('error', errors);
            return res.redirect('partials/login');
        }

        req.session.user = {
            customer_id: user.customer_id,
            username: user.username,
            role: user.role,
            first_name: user.first_name,
            last_name: user.last_name,
            email: user.email,
            phone_number: user.phone_number,
            address: user.address,
            profile_image_url: user.profile_image_url
        };

        if (req.xhr || req.headers.accept.includes('json')) {
            return res.json({ success: true, message: 'Login successful!', redirectUrl: '/dashboard' });
        }
        req.flash('success', 'Login successful.');
        return res.redirect('/dashboard');
    } catch (err) {
        console.error('Error during login:', err); // This will show the real error in your terminal
        const errors = ['Login failed. Please try again.'];
        if (req.xhr || req.headers.accept.includes('json')) {
            return res.json({ success: false, errors });
        }
        req.flash('error', errors);
        return res.redirect('partials/login');
    }
});

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/'); // Always redirect to registration after logout
    });
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

// Profile Page
app.get('/profile', checkAuthenticated, async (req, res) => {
    try {
        // Fetch profile_image_url and last_address_update
        const [rows] = await db.query('SELECT customer_id, username, first_name, last_name, email, phone_number, address, role, last_address_update, profile_image_url FROM customers WHERE customer_id = ?', [req.session.user.customer_id]);
        if (rows.length === 0) {
            req.flash('error', 'User not found.');
            return res.redirect('partials/login');
        }
        res.render('profile', {
            user: rows[0],
            messages: req.flash('success'),
            errors: req.flash('error')
        });
    } catch (err) {
        console.error('Error fetching profile:', err);
        req.flash('error', 'Database error fetching profile.');
        res.redirect('/dashboard');
    }
});

// Update Profile (username, email, address, phone_number)
app.post('/profile', checkAuthenticated, async (req, res) => {
    const customerId = req.session.user.customer_id;
    const { username, first_name, last_name, email, phone_number, address } = req.body;
    const errors = [];

    // Basic validation
    if (!username || !first_name || !last_name || !email) {
        errors.push('Username, first name, last name, and email are required.');
    }
    if (phone_number && !/^\d{8}$/.test(phone_number)) {
        errors.push('Phone number must be 8 digits.');
    }

    if (errors.length > 0) {
        req.flash('error', errors);
        return res.redirect('/profile');
    }

    try {
        // Check for 24-hour cooldown on address update
        const [currentUserRows] = await db.query('SELECT address, last_address_update FROM customers WHERE customer_id = ?', [customerId]);
        const currentUser = currentUserRows[0];

        let updateAddressTimestamp = false;
        if (currentUser.address !== address) { // If address is being changed
            const now = new Date();
            const lastUpdate = currentUser.last_address_update ? new Date(currentUser.last_address_update) : null;
            const twentyFourHours = 24 * 60 * 60 * 1000;

            if (lastUpdate && (now.getTime() - lastUpdate.getTime() < twentyFourHours)) {
                req.flash('error', 'Address can only be updated once every 24 hours.');
                return res.redirect('/profile');
            }
            updateAddressTimestamp = true;
        }

        // Build update query dynamically for address timestamp
        let updateQuery = `UPDATE customers SET
                            username = ?, first_name = ?, last_name = ?, email = ?, phone_number = ?, address = ?`;
        const updateParams = [username, first_name, last_name, email, phone_number || null, address || null];

        if (updateAddressTimestamp) {
            updateQuery += `, last_address_update = NOW()`;
        }
        updateQuery += ` WHERE customer_id = ?`;
        updateParams.push(customerId);

        await db.query(updateQuery, updateParams);

        // Update session user to reflect changes immediately
        req.session.user.username = username;
        req.session.user.first_name = first_name;
        req.session.user.last_name = last_name;
        req.session.user.email = email;
        req.session.user.phone_number = phone_number || null;
        req.session.user.address = address || null;

        req.flash('success', 'Profile updated successfully!');
        res.redirect('/profile');
    } catch (err) {
        console.error('Error updating profile:', err);
        if (err.code === 'ER_DUP_ENTRY') {
            req.flash('error', 'Username or email already exists.');
        } else {
            req.flash('error', 'Failed to update profile.');
        }
        res.redirect('/profile');
    }
});

// Change Password
app.post('/profile/change-password', checkAuthenticated, async (req, res) => {
    const customerId = req.session.user.customer_id;
    const { current_password, new_password, confirm_new_password } = req.body;
    const errors = [];

    if (!current_password || !new_password || !confirm_new_password) {
        errors.push('All password fields are required.');
    }
    if (new_password !== confirm_new_password) {
        errors.push('New password and confirmation do not match.');
    }
    if (new_password.length < 6) {
        errors.push('New password must be at least 6 characters long.');
    }

    if (errors.length > 0) {
        req.flash('error', errors);
        return res.redirect('/profile');
    }

    try {
        const [userRows] = await db.query('SELECT password_hash FROM customers WHERE customer_id = ?', [customerId]);
        const user = userRows[0];

        const isMatch = await bcrypt.compare(current_password, user.password_hash);
        if (!isMatch) {
            req.flash('error', 'Current password is incorrect.');
            return res.redirect('/profile');
        }

        const newPasswordHash = await bcrypt.hash(new_password, 10);
        await db.query('UPDATE customers SET password_hash = ? WHERE customer_id = ?', [newPasswordHash, customerId]);

        req.flash('success', 'Password changed successfully!');
        res.redirect('/profile');
    } catch (err) {
        console.error('Error changing password:', err);
        req.flash('error', 'Failed to change password.');
        res.redirect('/profile');
    }
});

// Update Profile Image (URL or File Upload)
app.post('/profile/update-image', checkAuthenticated, upload.single('profile_image_file'), async (req, res) => {
    const customerId = req.session.user.customer_id;
    let imageUrl = req.body.profile_image_url || null; // Prefer URL if provided

    try {
        // If a file was uploaded, use its path and delete the old file
        if (req.file) {
            imageUrl = `/uploads/${req.file.filename}`;

            // Delete old image if it exists and was a file upload
            const [oldImageRows] = await db.query('SELECT profile_image_url FROM customers WHERE customer_id = ?', [customerId]);
            const oldImageUrl = oldImageRows[0]?.profile_image_url;

            if (oldImageUrl && oldImageUrl.startsWith('/uploads/')) {
                const oldImagePath = path.join(__dirname, 'public', oldImageUrl);
                if (fs.existsSync(oldImagePath)) {
                    fs.unlink(oldImagePath, (err) => {
                        if (err) console.error('Error deleting old profile image file:', oldImagePath, err);
                    });
                }
            }
        } else if (imageUrl === '') { // If URL field was explicitly cleared by user
            imageUrl = null;
            // Also delete old file if it was an uploaded file
            const [oldImageRows] = await db.query('SELECT profile_image_url FROM customers WHERE customer_id = ?', [customerId]);
            const oldImageUrl = oldImageRows[0]?.profile_image_url;
            if (oldImageUrl && oldImageUrl.startsWith('/uploads/')) {
                const oldImagePath = path.join(__dirname, 'public', oldImageUrl);
                if (fs.existsSync(oldImagePath)) {
                    fs.unlink(oldImagePath, (err) => {
                        if (err) console.error('Error deleting old profile image file:', oldImagePath, err);
                    });
                }
            }
        }

        await db.query('UPDATE customers SET profile_image_url = ? WHERE customer_id = ?', [imageUrl, customerId]);
        req.session.user.profile_image_url = imageUrl; // Update session
        req.flash('success', 'Profile image updated!');
        res.redirect('/profile');
    } catch (err) {
        console.error('Error updating profile image:', err);
        req.flash('error', 'Failed to update profile image.');
        res.redirect('/profile');
    }
});


// customers admin list
app.get('/customers', checkAuthenticated, checkAdmin, async (req, res) => {
    try {
        const [users] = await db.query(
            'SELECT customer_id, username, first_name, last_name, email, phone_number, role FROM customers'
        );
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

// Admin: Update User Role (from customerList.ejs)
app.post('/customers/update-role/:id', checkAuthenticated, checkAdmin, async (req, res) => {
    const customerId = req.params.id;
    const { role } = req.body;

    try {
        if (!['admin', 'regular'].includes(role)) {
            req.flash('error', 'Invalid role specified.');
            return res.status(400).redirect('/customers');
        }

        const [result] = await db.query(
            'UPDATE customers SET role = ? WHERE customer_id = ?',
            [role, customerId]
        );

        if (result.affectedRows === 0) {
            req.flash('error', 'User not found or role already set.');
            return res.status(404).redirect('/customers');
        }

        req.flash('success', `User role updated to '${role}' successfully!`);
        res.redirect('/customers');
    } catch (err) {
        console.error('Error updating user role:', err);
        req.flash('error', 'Failed to update user role.');
        res.status(500).redirect('/customers');
    }
});


app.post('/customers/delete/:id', checkAuthenticated, checkAdmin, async (req, res) => {
    const userId = req.params.id;
    try {
        // Before deleting customer, delete their profile image if it's an uploaded file
        const [userImageRows] = await db.query('SELECT profile_image_url FROM customers WHERE customer_id = ?', [userId]);
        const userImageUrl = userImageRows[0]?.profile_image_url;

        if (userImageUrl && userImageUrl.startsWith('/uploads/')) {
            const userImagePath = path.join(__dirname, 'public', userImageUrl);
            if (fs.existsSync(userImagePath)) {
                fs.unlink(userImagePath, (err) => {
                    if (err) console.error('Error deleting user profile image file during user deletion:', userImagePath, err);
                });
            }
        }

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
            `SELECT book_id, title, author, isbn, genre, price, published_year, image_url, description
             FROM books WHERE book_id = ? LIMIT 1`,
            [id]
        );
        if (!rows.length) {
            req.flash('error', 'Book not found.');
            return res.redirect('/admin/books'); // Redirect to admin books list if not found
        }
        const book = rows[0];

        // Related books: same genre, exclude current
        const [related] = await db.query(
            `SELECT book_id, title, author, price, image_url
             FROM books WHERE genre <=> ? AND book_id <> ? ORDER BY title ASC LIMIT 6`,
            [book.genre, id]
        );

        res.render('admin/book', { // Render admin-specific book view
            user: req.session.user,
            book,
            related
        });
    } catch (err) {
        console.error('Error loading admin book page:', err);
        req.flash('error', 'Could not load admin book page.');
        res.redirect('/admin/books'); // Redirect to admin books list on error
    }
});

// Customer Books List (Public/Customer View)
app.get('/books', async (req, res) => {
    try {
        const { search = '', genre = '', sort = 'title_asc' } = req.query;

        let sql = `SELECT book_id, title, author, isbn, genre, price, published_year, image_url
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

        // Sorting (Alphabetical by title by default, as requested)
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

        res.render('books/index', { // Renders customer-specific books index
            user: req.session.user,
            books,
            genres,
            q: { search, genre, sort }
        });
    } catch (err) {
        console.error('Error listing books:', err);
        req.flash('error', 'Could not load books.');
        res.redirect('/dashboard'); // Redirect to dashboard on error
    }
});

// Admin Books List (for managing books - CRUD)
app.get('/admin/books', checkAuthenticated, checkAdmin, async (req, res) => {
    try {
        const { search = '', genre = '', sort = 'title_asc' } = req.query;

        let sql = `SELECT book_id, title, author, isbn, genre, price, published_year, image_url
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

        // Sorting (Alphabetical by title by default, as requested)
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

        res.render('books/index', { // Render admin-specific books index
            user: req.session.user,
            books,
            genres,
            q: { search, genre, sort }
        });
    } catch (err) {
        console.error('Error listing admin books:', err);
        req.flash('error', 'Could not load admin books list.');
        res.redirect('/admin'); // Redirect to admin dashboard on error
    }
});


// ==============================
// books: NEW form (admin only)
// ==============================
app.get('/books/new', checkAuthenticated, checkAdmin, async (req, res) => {
  try {
    const [publishers] = await db.query(
      'SELECT publisher_id, name FROM Publishers ORDER BY name ASC'
    );

    res.render('books/new', {
      user: req.session.user,
      publishers,           // <-- pass the list of publishers
      formData: req.flash('formData')[0] || {},
      errors: req.flash('error'),
      messages: req.flash('success')
    });
  } catch (err) {
    console.error('Error loading new book form:', err);
    req.flash('error', 'Could not load new book form.');
    res.redirect('/books');
  }
});


// ==============================
// books: CREATE (admin only)
// ==============================
app.post('/books', checkAuthenticated, checkAdmin, upload.single('image_file'), async (req, res) => {
  try {
    const {
      title, author, isbn, genre, price,
      published_year, image_url, description,
      publisher_id, stock_quantity
    } = req.body;

    const errors = [];
    if (!title || !author || !isbn || !price) errors.push('Title, author, ISBN, and price are required.');
    if (price && isNaN(price)) errors.push('Price must be a number.');
    if (published_year && (isNaN(published_year) || published_year < 1500 || published_year > (new Date().getFullYear() + 1))) {
      errors.push('Published year is invalid.');
    }
    if (!publisher_id) errors.push('Publisher is required.');
    const qty = (stock_quantity === '' || stock_quantity == null) ? 0 : parseInt(stock_quantity, 10);
    if (isNaN(qty) || qty < 0) errors.push('Initial stock must be a non-negative integer.');

    if (errors.length) {
      req.flash('error', errors);
      return res.redirect('/books/new');
    }

    // pick image URL (prefer URL; if none and file uploaded, use uploaded file path)
    let finalImageUrl = image_url || null;
    if (req.file && !image_url) {
      finalImageUrl = `/uploads/${req.file.filename}`;
    }

    // INSERT book (8 columns => 8 placeholders) ✔
    const [bookResult] = await db.query(
      `INSERT INTO books (title, author, isbn, genre, price, published_year, image_url, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        author,
        isbn || null,
        genre || null,
        parseFloat(price),
        published_year ? parseInt(published_year, 10) : null,
        finalImageUrl,
        description || null
      ]
    );

    // capture the new PK ✔
    const newBookId = bookResult.insertId;

    // INSERT/UPSERT initial stock ✔
    await db.query(
      `INSERT INTO Stocks (book_id, publisher_id, quantity)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)`,
      [newBookId, parseInt(publisher_id, 10), qty]
    );

    req.flash('success', 'Book created.');
    return res.redirect('/books');   // go to the unified books list
  } catch (err) {
    console.error('Error creating book:', err);
    if (err.code === 'ER_DUP_ENTRY') {
      req.flash('error', 'ISBN already exists.');
    } else {
      req.flash('error', 'Failed to create book.');
    }
    return res.redirect('/books/new');
  }
});


// ==============================
// books: EDIT form (admin only)
// ==============================
// Edit Book (form)
// Edit Book form (works for /books/:id/edit and /admin/books/:id/edit)
app.get(['/books/:id/edit', '/admin/books/:id/edit'], checkAuthenticated, checkAdmin, async (req, res) => {
  try {
    const id = req.params.id;

    const [rows] = await db.query(
      'SELECT * FROM Books WHERE book_id = ? LIMIT 1',
      [id]
    );

    if (!rows || rows.length === 0) {
      req.flash('error', 'Book not found.');
      return res.redirect('/books');
    }

    res.render('books/edit', {
      user: req.session.user,
      book: rows[0],              // <-- THIS is what edit.ejs needs
      errors: req.flash('error'),
      messages: req.flash('success')
    });
  } catch (err) {
    console.error('Error loading edit page:', err);
    req.flash('error', 'Could not load edit page.');
    res.redirect('/books');
  }
});



// ==============================
// books: UPDATE (admin only)
// ==============================
// Update Book (submit)
app.post('/books/:id/edit', checkAuthenticated, checkAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    let {
      title,
      author,
      isbn,
      genre,
      price,
      published_year,
      description,
      image_url
    } = req.body;

    // Basic validation
    const errors = [];
    if (!title || !author || !isbn || !genre || !price) {
      errors.push('Title, author, ISBN, genre, and price are required.');
    }
    if (price && (isNaN(price) || Number(price) <= 0)) {
      errors.push('Price must be a positive number.');
    }
    if (published_year && isNaN(published_year)) {
      errors.push('Published year must be a number.');
    }
    if (errors.length) {
      req.flash('error', errors);
      return res.redirect(`/books/${id}/edit`);
    }

    // If you use multer and allow file uploads on edit:
    // const coverPath = (req.file && `/uploads/${req.file.filename}`) || image_url || null;
    // and then use coverPath instead of image_url below.

    await db.query(
      `UPDATE Books
       SET title = ?, author = ?, isbn = ?, genre = ?, price = ?, published_year = ?, description = ?, image_url = ?
       WHERE book_id = ?`,
      [
        title.trim(),
        author.trim(),
        isbn.trim(),
        genre.trim(),
        Number(price),
        published_year ? parseInt(published_year, 10) : null,
        description || null,
        image_url || null, // or coverPath if using multer
        id
      ]
    );

    req.flash('success', 'Book updated.');
    // Go back to list (or use `/books/${id}` if you have a show page)
    res.redirect('/books');
  } catch (err) {
    console.error('Error updating book:', err);
    req.flash('error', 'Failed to update book.');
    res.redirect(`/books/${req.params.id}/edit`);
  }
});


// ==============================
// books: DELETE (admin only)
// ==============================
app.post('/books/:id/delete', checkAuthenticated, checkAdmin, async (req, res) => {
    const id = req.params.id;
    try {
        // Fetch book image URL to delete file if it's an uploaded one
        const [bookImageRows] = await db.query('SELECT image_url FROM books WHERE book_id = ?', [id]);
        const bookImageUrl = bookImageRows[0]?.image_url;

        // Remove dependents first due to FKs
        await db.query('DELETE FROM stocks WHERE book_id = ?', [id]);
        await db.query('DELETE FROM cart WHERE book_id = ?', [id]);
        await db.query('DELETE FROM books WHERE book_id = ?', [id]);

        // Delete the associated image file if it was an upload
        if (bookImageUrl && bookImageUrl.startsWith('/uploads/')) {
            const imagePath = path.join(__dirname, 'public', bookImageUrl);
            if (fs.existsSync(imagePath)) {
                fs.unlink(imagePath, (err) => {
                    if (err) console.error('Error deleting book image file:', imagePath, err);
                });
            }
        }

        req.flash('success', 'Book deleted.');
        res.redirect('/admin/books'); // Redirect to admin books list
    } catch (err) {
        console.error('Error deleting book:', err);
        req.flash('error', 'Failed to delete book.');
        res.redirect('/admin/books'); // Redirect to admin books list
    }
});

// ==============================
// books: SHOW (individual book) - This is for customer view of a single book
// Public: viewable by all
// ==============================
app.get('/books/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const [rows] = await db.query(
            `SELECT book_id, title, author, isbn, genre, price, published_year, image_url, description
             FROM books WHERE book_id = ? LIMIT 1`, [id]
        );
        if (!rows.length) {
            req.flash('error', 'Book not found.');
            return res.redirect('/books'); // Redirect to customer books list
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
        res.redirect('/books'); // Redirect to customer books list
    }
});

// ─── Cart routes ───

// Render “Add to Cart” form
app.get('/cart/new', checkAuthenticated, async (req, res) => {
  try {
    const [books] = await db.query('SELECT book_id, title FROM books');
    res.render('cart/create_cart_item', {
      user:     req.session.user,
      books,
      errors:   req.flash('error'),
      messages: req.flash('success')
    });
  } catch (err) {
    console.error('Error loading create cart item form:', err);
    req.flash('error', 'Could not load cart item form.');
    res.redirect('/dashboard');
  }
});

// Create: handle form POST
app.post('/cart', checkAuthenticated, async (req, res) => {
  const { book_id, quantity } = req.body;
  const customer_id = req.session.user.customer_id;
  try {
    await db.query(
      'INSERT INTO cart (customer_id, book_id, quantity) VALUES (?, ?, ?)',
      [customer_id, book_id, quantity]
    );
    req.flash('success', 'Book added to cart successfully!');
    return res.redirect('/cart');
  } catch (err) {
    console.error('Error adding to cart:', err);
    req.flash('error', 'Could not add to cart. Please try again.');
    return res.redirect('/cart/new');
  }
});

// Read: list cart items + total (with debug)
app.get('/cart', checkAuthenticated, async (req, res) => {
  const customer_id = req.session.user.customer_id;
  try {
    let [items] = await db.query(`
      SELECT
        c.cart_id      AS cart_item_id,
        b.title,
        b.price,
        c.quantity
      FROM cart c
      JOIN books b ON c.book_id = b.book_id
      WHERE c.customer_id = ?`, [customer_id]
    );
    // Convert DECIMAL strings to numbers
    items = items.map(i => ({ ...i, price: parseFloat(i.price) }));
    const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    return res.render('cart/cart_list', {
      user:     req.session.user,
      items,
      total,
      messages: req.flash('success'),
      errors:   req.flash('error')
    });
  } catch (err) {
    console.error('Cart route error:', err);
    // DEBUG: send full stack to browser
    return res.status(500).send(`<pre>${err.stack}</pre>`);
  }
});

// Update: adjust quantity
app.post('/cart/:id/update', checkAuthenticated, async (req, res) => {
  const cartItemId  = req.params.id;
  const qty         = parseInt(req.body.quantity, 10);
  const customer_id = req.session.user.customer_id;
  if (isNaN(qty) || qty < 1) {
    req.flash('error', 'Quantity must be at least 1.');
    return res.redirect('/cart');
  }
  try {
    await db.query(
      'UPDATE cart SET quantity = ? WHERE cart_id = ? AND customer_id = ?',
      [qty, cartItemId, customer_id]
    );
    req.flash('success', 'Cart updated.');
  } catch (err) {
    console.error('Error updating cart item:', err);
    req.flash('error', 'Could not update cart.');
  }
  res.redirect('/cart');
});

// Delete: remove item
app.post('/cart/:id/delete', checkAuthenticated, async (req, res) => {
  const cartItemId  = req.params.id;
  const customer_id = req.session.user.customer_id;
  try {
    await db.query(
      'DELETE FROM cart WHERE cart_id = ? AND customer_id = ?',
      [cartItemId, customer_id]
    );
    req.flash('success', 'Item removed.');
  } catch (err) {
    console.error('Error deleting cart item:', err);
    req.flash('error', 'Could not remove item.');
  }
  res.redirect('/cart');
});

// Create or Increase: handle form POST
app.post('/cart', checkAuthenticated, async (req, res) => {
  const { book_id, quantity } = req.body;
  const customer_id = req.session.user.customer_id;
  const qty = parseInt(quantity, 10);

  try {
    // 1) Look for an existing cart entry for this user+book
    const [[existing]] = await db.query(
      `SELECT cart_id, quantity
         FROM cart
        WHERE customer_id = ? AND book_id = ?`,
      [ customer_id, book_id ]
    );

    if (existing) {
      // 2a) If found, update its quantity
      await db.query(
        `UPDATE cart
            SET quantity = ?
          WHERE cart_id = ?`,
        [ existing.quantity + qty, existing.cart_id ]
      );
    } else {
      // 2b) Otherwise insert a new row
      await db.query(
        `INSERT INTO cart (customer_id, book_id, quantity)
         VALUES (?, ?, ?)`,
        [ customer_id, book_id, qty ]
      );
    }

    req.flash('success', 'Cart updated!');
    res.redirect('/cart');
  } catch (err) {
    console.error('Error adding to cart:', err);
    req.flash('error', 'Could not add to cart. Please try again.');
    res.redirect('/cart/new');
  }
});

// ─── Checkout page ───
app.get('/checkout', checkAuthenticated, async (req, res) => {
  const customer_id = req.session.user.customer_id;
  try {
    // pull your cart items + book info
    let [items] = await db.query(`
      SELECT
        c.cart_id      AS cart_item_id,
        b.title,
        b.price,
        c.quantity
      FROM cart c
      JOIN books b ON c.book_id = b.book_id
      WHERE c.customer_id = ?`, [customer_id]
    );
    // convert decimal strings to numbers
    items = items.map(i => ({ ...i, price: parseFloat(i.price) }));
    const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

    return res.render('cart/checkout', {
      user:     req.session.user,
      items,
      total,
      messages: req.flash('success'),
      errors:   req.flash('error')
    });
  } catch (err) {
    console.error('Error loading checkout:', err);
    req.flash('error', 'Could not load checkout.');
    return res.redirect('/cart');
  }
});

// ─── PayPal callback: record payment & clear cart ───
app.post('/payment-complete', checkAuthenticated, async (req, res) => {
  const customer_id     = req.session.user.customer_id;
  const { amount, transactionID } = req.body;

  try {
    // Record into total_amount & payment_method
    await db.query(
      `INSERT INTO payments
         (customer_id, total_amount, payment_method)
       VALUES (?, ?, ?)`,
      [customer_id, amount, transactionID]
    );

    // Clear the cart
    await db.query('DELETE FROM cart WHERE customer_id = ?', [customer_id]);

    return res.json({ success: true });
  } catch (err) {
    console.error('Error in /payment-complete:', err);
    return res.json({ success: false, error: err.message });
  }
});

// ─── Fake Quick‑Pay (no PayPal) ───
app.post('/checkout/fake', checkAuthenticated, async (req, res) => {
  const customer_id = req.session.user.customer_id;
  try {
    // Recompute total server‑side
    const [items] = await db.query(`
      SELECT b.price, c.quantity
      FROM cart c
      JOIN books b ON c.book_id = b.book_id
      WHERE c.customer_id = ?`, [customer_id]
    );
    const total = items
      .map(i => parseFloat(i.price) * i.quantity)
      .reduce((sum, v) => sum + v, 0);

    // Record fake payment under payment_method = 'FakePay'
    await db.query(
      `INSERT INTO payments
         (customer_id, total_amount, payment_method)
       VALUES (?, ?, 'FakePay')`,
      [customer_id, total]
    );

    // Clear the cart
    await db.query('DELETE FROM cart WHERE customer_id = ?', [customer_id]);

    req.flash('success', 'Quick Pay successful! (This was a fake payment.)');
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Fake checkout error:', err);
    req.flash('error', 'Quick Pay failed. Please try again.');
    res.redirect('/checkout');
  }
});


// ==============================
// Admin: Stocks - LIST (with search)
// ==============================
app.get('/admin/stocks', checkAuthenticated, checkAdmin, async (req, res) => {
    try {
        const { search = '' } = req.query;

        let sql = `
            SELECT s.book_id, s.publisher_id, s.quantity,
                   b.title, b.image_url,
                   p.name AS publisher_name
            FROM Stocks s
            JOIN Books b ON b.book_id = s.book_id
            JOIN Publishers p ON p.publisher_id = s.publisher_id
            WHERE 1=1`;
        const params = [];

        if (search) {
            const term = `%${search}%`;
            sql += ` AND (b.title LIKE ? OR p.name LIKE ?)`;
            params.push(term, term);
        }

        sql += ` ORDER BY b.title ASC, p.name ASC`;

        const [stocks] = await db.query(sql, params);

        res.render('admin/stocks/index', {
            user: req.session.user,
            stocks,
            q: { search }
        });
    } catch (err) {
        console.error('Error listing stocks:', err);
        req.flash('error', 'Could not load stocks.');
        res.redirect('/admin');
    }
});

// ==============================
// Admin: Stocks - NEW form
// ==============================
app.get('/admin/stocks/new', checkAuthenticated, checkAdmin, async (req, res) => {
    try {
        const [books] = await db.query('SELECT book_id, title FROM Books ORDER BY title ASC');
        const [publishers] = await db.query('SELECT publisher_id, name FROM Publishers ORDER BY name ASC');

        res.render('admin/stocks/new', {
            user: req.session.user,
            books,
            publishers,
            formData: {},
            errors: req.flash('error'),
            messages: req.flash('success')
        });
    } catch (err) {
        console.error('Error loading new stock form:', err);
        req.flash('error', 'Could not load stock form.');
        res.redirect('/admin/stocks');
    }
});

// ==============================
// Admin: Stocks - CREATE
// ==============================
app.post('/admin/stocks', checkAuthenticated, checkAdmin, async (req, res) => {
    try {
        const { book_id, publisher_id, quantity } = req.body;
        const errors = [];

        if (!book_id || !publisher_id) errors.push('Book and Publisher are required.');
        if (quantity === undefined || quantity === null || isNaN(quantity) || Number(quantity) < 0) {
            errors.push('Quantity must be a non-negative number.');
        }

        if (errors.length) {
            req.flash('error', errors);
            return res.redirect('/admin/stocks/new');
        }

        await db.query(
            'INSERT INTO Stocks (book_id, publisher_id, quantity) VALUES (?, ?, ?)',
            [parseInt(book_id), parseInt(publisher_id), parseInt(quantity)]
        );

        req.flash('success', 'Stock entry created.');
        res.redirect('/admin/stocks');
    } catch (err) {
        console.error('Error creating stock:', err);
        if (err.code === 'ER_DUP_ENTRY') {
            req.flash('error', 'That book already has a stock entry for this publisher. Use Edit instead.');
        } else {
            req.flash('error', 'Failed to create stock entry.');
        }
        res.redirect('/admin/stocks/new');
    }
});

// ==============================
// Admin: Stocks - EDIT form
// ==============================
app.get('/admin/stocks/:book_id/:publisher_id/edit', checkAuthenticated, checkAdmin, async (req, res) => {
    try {
        const { book_id, publisher_id } = req.params;

        const [rows] = await db.query(
            `SELECT s.book_id, s.publisher_id, s.quantity,
                    b.title, p.name AS publisher_name
               FROM Stocks s
               JOIN Books b ON b.book_id = s.book_id
               JOIN Publishers p ON p.publisher_id = s.publisher_id
               WHERE s.book_id = ? AND s.publisher_id = ?
               LIMIT 1`,
            [book_id, publisher_id]
        );

        if (!rows.length) {
            req.flash('error', 'Stock entry not found.');
            return res.redirect('/admin/stocks');
        }

        res.render('admin/stocks/edit', {
            user: req.session.user,
            stock: rows[0],
            errors: req.flash('error'),
            messages: req.flash('success')
        });
    } catch (err) {
        console.error('Error loading stock edit form:', err);
        req.flash('error', 'Could not load stock edit form.');
        res.redirect('/admin/stocks');
    }
});

// ==============================
// Admin: Stocks - UPDATE
// ==============================
app.post('/admin/stocks/:book_id/:publisher_id/edit', checkAuthenticated, checkAdmin, async (req, res) => {
    try {
        const { book_id, publisher_id } = req.params;
        const { quantity } = req.body;

        const q = parseInt(quantity);
        if (isNaN(q) || q < 0) {
            req.flash('error', 'Quantity must be a non-negative number.');
            return res.redirect(`/admin/stocks/${book_id}/${publisher_id}/edit`);
        }

        await db.query(
            'UPDATE Stocks SET quantity = ? WHERE book_id = ? AND publisher_id = ?',
            [q, parseInt(book_id), parseInt(publisher_id)]
        );

        req.flash('success', 'Stock updated.');
        res.redirect('/admin/stocks');
    } catch (err) {
        console.error('Error updating stock:', err);
        req.flash('error', 'Failed to update stock.');
        res.redirect(`/admin/stocks/${req.params.book_id}/${req.params.publisher_id}/edit`);
    }
});

// ==============================
// Admin: Stocks - DELETE
// ==============================
app.post('/admin/stocks/:book_id/:publisher_id/delete', checkAuthenticated, checkAdmin, async (req, res) => {
    try {
        const { book_id, publisher_id } = req.params;

        const [result] = await db.query(
            'DELETE FROM Stocks WHERE book_id = ? AND publisher_id = ?',
            [parseInt(book_id), parseInt(publisher_id)]
        );

        if (result.affectedRows === 0) {
            req.flash('error', 'Stock entry not found.');
        } else {
            req.flash('success', 'Stock entry deleted.');
        }
        res.redirect('/admin/stocks');
    } catch (err) {
        console.error('Error deleting stock:', err);
        req.flash('error', 'Failed to delete stock.');
        res.redirect('/admin/stocks');
    }
});

/* ==============================
    Start server
    ============================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on http://localhost:${PORT}`));
