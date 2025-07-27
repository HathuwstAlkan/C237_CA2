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

// const express = require('express');
// const path = require('path');
// const mysql = require('mysql2/promise'); // CRITICAL FIX: Changed to mysql2/promise
// const session = require('express-session');
// const flash = require('connect-flash');
// const crypto = require('crypto'); // For SHA1 hashing (used for current password verification)

// const app = express();

// // Database connection
// const db = mysql.createConnection({
//     host: '29vx1m.h.filess.io',
//     user: 'C237CA2_paidplant',
//     password: '3c01197c427f182364f4461deb0613ea96517367',
//     database: 'C237CA2_paidplant',
//     port: 61002,
// });

// // EJS View Engine Setup
// app.set('view engine', 'ejs');
// app.set('views', path.join(__dirname, 'views'));

// // Middleware Setup
// app.use(express.urlencoded({ extended: false }));
// app.use(express.json());
// app.use(express.static(path.join(__dirname, 'public')));

// // Session middleware configuration
// app.use(session({
//     secret: 'super_secret_session_key', // IMPORTANT: Change this to a strong, random string
//     resave: false,
//     saveUninitialized: true,
//     cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // Session expires after 1 week (in milliseconds)
// }));

// // Flash messages middleware
// app.use(flash());

// // Middleware to make flash messages available to all templates
// app.use((req, res, next) => {
//     res.locals.messages = req.flash('success');
//     res.locals.errors = req.flash('error');
//     next();
// });

// // --- Custom Middlewares ---
// // Middleware to check if user is logged in.
// const checkAuthenticated = (req, res, next) => {
//     if (req.session.user) {
//         return next();
//     } else {
//         if (req.xhr || req.headers.accept.includes('json')) {
//             return res.status(401).json({ success: false, errors: ['Please log in to view this resource.'] });
//         }
//         req.flash('error', 'Please log in to view this resource.');
//         res.redirect('/login');
//     }
// };

// // Middleware to check if user is admin.
// const checkAdmin = (req, res, next) => {
//     if (!req.session.user) {
//         req.flash('error', 'Access denied: Please log in.');
//         return res.redirect('/login');
//     }
//     if (req.session.user.role === 'admin') {
//         return next();
//     } else {
//         req.flash('error', 'Access denied: You must be an administrator.');
//         return res.redirect('/dashboard'); // Use return to stop execution
//     }
// };

// // --- Routes ---
// // Home Route: Renders the main index page.
// app.get('/', (req, res) => {
//     res.render('index', { user: req.session.user });
// });

// // PARTIAL ROUTES
// // Renders the login form
// app.get('/partials/login', (req, res) => {
//     res.render('partials/login', { layout: false, messages: res.locals.messages, errors: res.locals.errors });
// });

// // Renders the register form
// app.get('/partials/register', (req, res) => {
//     res.render('partials/register', { layout: false, formData: req.flash('formData')[0], messages: res.locals.messages, errors: res.locals.errors });
// });

// // Register Form Submission Route: Handles new user registration
// app.post('/register', async (req, res) => {
//     // Added first_name and last_name to destructuring
//     const { username, email, password, first_name, last_name, address, contact } = req.body;
//     const userRole = 'regular'; // Default to 'regular' user role - admin role to be manually assigned in database

//     // Validation
//     const errors = [];
//     // Added first_name and last_name to required fields check
//     if (!username || !email || !password || !first_name || !last_name || !address || !contact) {
//         errors.push('All fields are required.');
//     }

//     const specialChars = ["`","~","!","@","#","$","%","^","&","*","-","+","=","_", "?", "/", "<", ">",".",",",":",";","(",")","{","}","[","]","|"];
//     const hasSpecialChar = specialChars.some(char => password.includes(char));
//     const hasCapital = /[A-Z]/.test(password); // Check for at least one capital letter

//     if (password.length < 8 || !hasCapital || !hasSpecialChar) {
//         let passwordError = 'Password must be at least 8 characters long';
//         if (!hasCapital) {
//             passwordError += ', include at least one capital letter';
//         }
//         if (!hasSpecialChar) {
//             passwordError += ', and include at least one special character: `~!@#$%^&*-_+=`?/<>.,:;(){}[]|';
//         }
//         passwordError += '.';
//         errors.push(passwordError);
//     }

//     if (errors.length > 0) {
//         return res.json({ success: false, errors: errors, formData: req.body });
//     }

//     // Insert into Customers table - Added first_name and last_name
//     const sql = 'INSERT INTO Customers (username, email, password_hash, first_name, last_name, address, phone_number, role) VALUES (?, ?, SHA1(?), ?, ?, ?, ?, ?)';
//     try {
//         const [result] = await db.query(sql, [username, email, password, first_name, last_name, address, contact, userRole]);
//         res.json({ success: true, message: 'Registration successful! Please log in.', redirectUrl: '/dashboard' });
//     } catch (err) {
//         console.error('Error during registration:', err);
//         const serverErrors = [];
//         if (err.code === 'ER_DUP_ENTRY') {
//             serverErrors.push('Username or email already exists.');
//         } else {
//             serverErrors.push('Registration failed. Please try again.');
//         }
//         res.json({ success: false, errors: serverErrors, formData: req.body });
//     }
// });

// // Login Form Submission Route: Authenticates user and sets session
// app.post('/login', async (req, res) => {
//     const { email, password } = req.body;

//     const errors = [];
//     if (!email || !password) {
//         errors.push('All fields are required.');
//     }

//     if (errors.length > 0) {
//         return res.json({ success: false, errors: errors });
//     }

//     // Select from Customers table
//     const sql = 'SELECT * FROM Customers WHERE email = ? AND password_hash = SHA1(?)';
//     try {
//         const [results] = await db.query(sql, [email, password]);

//         if (results.length > 0) {
//             req.session.user = results[0]; // Store user object from Customers table in session
//             res.json({ success: true, message: 'Login successful!', redirectUrl: '/dashboard' });
//         } else {
//             errors.push('Invalid email or password.');
//             res.json({ success: false, errors: errors });
//         }
//     } catch (err) {
//         console.error('Error during login:', err);
//         errors.push('An error occurred during login.');
//         res.json({ success: false, errors: errors });
//     }
// });

// // Route to fetch books (for search and filter) - Used by customer dashboard and admin book management
// app.get('/books', checkAuthenticated, async (req, res) => {
//     const { search, genre, sortBy } = req.query;
//     let sql = 'SELECT b.*, p.name AS publisher_name, s.quantity AS stock_quantity FROM Books b LEFT JOIN Stocks s ON b.book_id = s.book_id LEFT JOIN Publishers p ON s.publisher_id = p.publisher_id WHERE 1=1';
//     const params = [];

//     if (search) {
//         const searchTerm = `%${search}%`;
//         sql += ' AND (b.title LIKE ? OR b.author LIKE ? OR b.isbn LIKE ? OR b.genre LIKE ?)';
//         params.push(searchTerm, searchTerm, searchTerm, searchTerm);
//     }
//     if (genre && genre !== 'All') {
//         sql += ' AND b.genre = ?';
//         params.push(genre);
//     }

//     // Add sorting
//     let orderByClause = '';
//     switch (sortBy) {
//         case 'title_asc':
//             orderByClause = ' ORDER BY b.title ASC';
//             break;
//         case 'title_desc':
//             orderByClause = ' ORDER BY b.title DESC';
//             break;
//         case 'author_asc':
//             orderByClause = ' ORDER BY b.author ASC';
//             break;
//         case 'author_desc':
//             orderByClause = ' ORDER BY b.author DESC';
//             break;
//         case 'published_year_desc': // Newest First
//             orderByClause = ' ORDER BY b.published_year DESC';
//             break;
//         case 'published_year_asc': // Oldest First
//             orderByClause = ' ORDER BY b.published_year ASC';
//             break;
//         case 'price_asc':
//             orderByClause = ' ORDER BY b.price ASC';
//             break;
//         case 'price_desc':
//             orderByClause = ' ORDER BY b.price DESC';
//             break;
//         default:
//             orderByClause = ' ORDER BY b.title ASC'; // Default sort
//     }
//     sql += orderByClause;

//     try {
//         const [books] = await db.query(sql, params);

//         // Fetch all unique genres separately for the filter dropdown
//         const [genresResult] = await db.query('SELECT DISTINCT genre FROM Books');
//         const genresList = genresResult.map(row => row.genre);

//         // If this is an AJAX request, send JSON
//         if (req.xhr || req.headers.accept.includes('json')) {
//             return res.json({ success: true, books: books, genres: genresList });
//         }
//         // This path is typically not used if /dashboard handles initial book display
//         res.render('bookListPartial', { books: books, genres: genresList, user: req.session.user });
//     } catch (err) {
//         console.error('Error fetching books:', err);
//         if (req.xhr || req.headers.accept.includes('json')) {
//             return res.status(500).json({ success: false, errors: ['Error fetching books.'] });
//         }
//         req.flash('error', 'Error fetching books.');
//         res.redirect('/dashboard');
//     }
// });

// // Individual Book Details Page
// app.get('/books/:id', checkAuthenticated, async (req, res) => {
//     const bookId = req.params.id;

//     try {
//         // Fetch book details
//         const [bookResults] = await db.query('SELECT b.*, p.name AS publisher_name FROM Books b LEFT JOIN Stocks s ON b.book_id = s.book_id LEFT JOIN Publishers p ON s.publisher_id = p.publisher_id WHERE b.book_id = ? LIMIT 1', [bookId]);
//         const book = bookResults[0];

//         if (!book) {
//             req.flash('error', 'Book not found.');
//             return res.status(404).redirect('/dashboard');
//         }

//         // Fetch other books for carousel (e.g., by same genre, excluding current book)
//         const [otherBooks] = await db.query('SELECT book_id, title, author, genre, price FROM Books WHERE genre = ? AND book_id != ? LIMIT 5', [book.genre, bookId]);

//         res.render('bookDetails', {
//             user: req.session.user,
//             book: book,
//             otherBooks: otherBooks
//         });

//     } catch (err) {
//         console.error('Error fetching book details:', err);
//         req.flash('error', 'Could not load book details.');
//         res.status(500).redirect('/dashboard');
//     }
// });


// // Dashboard Route: Renders user dashboard (accessible to all logged-in users).
// app.get('/dashboard', checkAuthenticated, async (req, res) => {
//     try {
//         // Fetch all books for initial display on dashboard
//         const [books] = await db.query('SELECT b.*, p.name AS publisher_name, s.quantity AS stock_quantity FROM Books b LEFT JOIN Stocks s ON b.book_id = s.book_id LEFT JOIN Publishers p ON s.publisher_id = p.publisher_id ORDER BY b.title ASC');
//         // Fetch unique genres for the filter dropdown
//         const [genres] = await db.query('SELECT DISTINCT genre FROM Books');
//         const genresList = genres.map(row => row.genre);

//         res.render('customerDashboard', {
//             user: req.session.user,
//             books: books,
//             genres: genresList
//         });
//     } catch (err) {
//         console.error('Error loading customer dashboard:', err);
//         req.flash('error', 'Could not load dashboard data.');
//         res.redirect('/'); // Redirect to home if dashboard data fails
//     }
// });

// // Admin Dashboard Route: Renders admin dashboard (accessible only to logged-in admins).
// app.get('/admin', checkAuthenticated, checkAdmin, async (req, res) => {
//     try {
//         res.render('adminDashboard', {
//             user: req.session.user
//         });
//     } catch (err) {
//         console.error('Error loading admin dashboard:', err);
//         req.flash('error', 'Could not load admin dashboard data.');
//         res.redirect('/'); // Redirect to home if admin dashboard data fails
//     }
// });

// // Admin: Manage Books (Consolidated View, Add, Edit)
// app.get('/admin/books', checkAuthenticated, checkAdmin, async (req, res) => {
//     try {
//         const [books] = await db.query('SELECT b.*, p.name AS publisher_name, s.quantity AS stock_quantity FROM Books b LEFT JOIN Stocks s ON b.book_id = s.book_id LEFT JOIN Publishers p ON s.publisher_id = p.publisher_id ORDER BY b.title ASC');
//         const [publishers] = await db.query('SELECT publisher_id, name FROM Publishers');
//         res.render('adminManageBooks', {
//             books: books,
//             publishers: publishers,
//             user: req.session.user,
//             formData: req.flash('formData')[0], // For add/edit form re-population
//             editBookData: req.flash('editBookData')[0] // For specific edit form re-population
//         });
//     } catch (err) {
//         console.error('Error fetching books for admin:', err);
//         req.flash('error', 'Could not load books for management.');
//         res.redirect('/admin');
//     }
// });

// // Admin: Handle Add New Book Submission (POST to /admin/books)
// app.post('/admin/books', checkAuthenticated, checkAdmin, async (req, res) => {
//     const { title, author, isbn, genre, price, published_year, description, publisher_id, stock_quantity } = req.body;
//     const errors = [];

//     if (!title || !author || !isbn || !genre || !price || !published_year || !description || !publisher_id || !stock_quantity) {
//         errors.push('All fields are required.');
//     }
//     if (isNaN(price) || price <= 0) errors.push('Price must be a positive number.');
//     if (isNaN(published_year) || published_year <= 0) errors.push('Published year must be a valid year.');
//     if (isNaN(stock_quantity) || stock_quantity < 0) errors.push('Stock quantity must be a non-negative number.');

//     if (errors.length > 0) {
//         req.flash('error', errors);
//         req.flash('formData', req.body);
//         return res.redirect('/admin/books'); // Redirect back to manage books page
//     }

//     try {
//         // Insert into Books table
//         const [bookResult] = await db.query(
//             'INSERT INTO Books (title, author, isbn, genre, price, published_year, description) VALUES (?, ?, ?, ?, ?, ?, ?)',
//             [title, author, isbn, genre, parseFloat(price), parseInt(published_year), description]
//         );
//         const newBookId = bookResult.insertId;

//         // Insert into Stocks table
//         await db.query(
//             'INSERT INTO Stocks (book_id, publisher_id, quantity) VALUES (?, ?, ?)',
//             [newBookId, publisher_id, parseInt(stock_quantity)]
//         );

//         req.flash('success', 'Book added successfully!');
//         res.redirect('/admin/books');
//     } catch (err) {
//         console.error('Error adding new book:', err);
//         req.flash('error', 'Failed to add book. It might be a duplicate ISBN.');
//         req.flash('formData', req.body);
//         res.redirect('/admin/books'); // Redirect back to manage books page
//     }
// });

// // Admin: Handle Edit Book Submission (POST to /admin/books/edit/:id)
// app.post('/admin/books/edit/:id', checkAuthenticated, checkAdmin, async (req, res) => {
//     const bookId = req.params.id;
//     const { title, author, isbn, genre, price, published_year, description, publisher_id, stock_quantity } = req.body;
//     const errors = [];

//     if (!title || !author || !isbn || !genre || !price || !published_year || !description || !publisher_id || !stock_quantity) {
//         errors.push('All fields are required.');
//     }
//     if (isNaN(price) || price <= 0) errors.push('Price must be a positive number.');
//     if (isNaN(published_year) || published_year <= 0) errors.push('Published year must be a valid year.');
//     if (isNaN(stock_quantity) || stock_quantity < 0) errors.push('Stock quantity must be a non-negative number.');

//     if (errors.length > 0) {
//         req.flash('error', errors);
//         // Store data for re-population in the edit form
//         req.flash('editBookData', { book_id: bookId, ...req.body });
//         return res.redirect(`/admin/books#editBookCollapse-${bookId}`); // Redirect to specific collapse
//     }

//     try {
//         // Update Books table
//         await db.query(
//             'UPDATE Books SET title = ?, author = ?, isbn = ?, genre = ?, price = ?, published_year = ?, description = ? WHERE book_id = ?',
//             [title, author, isbn, genre, parseFloat(price), parseInt(published_year), description, bookId]
//         );

//         // Update Stocks table (assuming one publisher per book for simplicity, or handle multiple)
//         await db.query(
//             'INSERT INTO Stocks (book_id, publisher_id, quantity) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)',
//             [bookId, publisher_id, parseInt(stock_quantity)]
//         );

//         req.flash('success', 'Book updated successfully!');
//         res.redirect('/admin/books');
//     } catch (err) {
//         console.error('Error updating book:', err);
//         req.flash('error', 'Failed to update book. It might be a duplicate ISBN or other DB error.');
//         req.flash('editBookData', { book_id: bookId, ...req.body }); // Re-populate on error
//         res.redirect(`/admin/books#editBookCollapse-${bookId}`); // Redirect to specific collapse
//     }
// });

// // Admin: Delete Book
// app.post('/admin/books/delete/:id', checkAuthenticated, checkAdmin, async (req, res) => {
//     const bookId = req.params.id;
//     try {
//         // Delete from dependent tables first due to foreign key constraints
//         await db.query('DELETE FROM Stocks WHERE book_id = ?', [bookId]);
//         await db.query('DELETE FROM Cart WHERE book_id = ?', [bookId]);

//         const [result] = await db.query('DELETE FROM Books WHERE book_id = ?', [bookId]);
//         if (result.affectedRows === 0) {
//             req.flash('error', 'Book not found.');
//             return res.status(404).redirect('/admin/books');
//         }
//         req.flash('success', 'Book deleted successfully!');
//         res.redirect('/admin/books');
//     } catch (err) {
//         console.error('Error deleting book:', err);
//         req.flash('error', 'Failed to delete book.');
//         res.status(500).redirect('/admin/books');
//     }
// });


// // Customers List Route: Fetches and displays all customers for admins
// app.get('/customers', checkAuthenticated, checkAdmin, async (req, res) => {
//     try {
//         // Select from Customers table
//         const [customers] = await db.query('SELECT customer_id, username, first_name, last_name, email, phone_number, role, address FROM Customers');
//         res.render('customerList', { // Keeping filename customerList.ejs as per user's existing reference
//             users: customers,
//             currentUser: req.session.user,
//             editUserData: req.flash('editUserData')[0] // For specific edit form re-population
//         });
//     } catch (err) {
//         console.error('Error fetching customers:', err);
//         req.flash('error', 'Error fetching customer list.');
//         res.status(500).redirect('/admin'); // Redirect to admin dashboard
//     }
// });

// // Admin: Handle Edit User Role Submission (POST to /customers/edit-role/:id)
// app.post('/customers/edit-role/:id', checkAuthenticated, checkAdmin, async (req, res) => {
//     const customerId = req.params.id; // Using customer_id
//     const { role } = req.body;

//     if (!role || (role !== 'admin' && role !== 'regular')) {
//         req.flash('error', 'Invalid role specified.');
//         req.flash('editUserData', { customer_id: customerId, ...req.body }); // Re-populate on error
//         return res.redirect(`/customers#editUserCollapse-${customerId}`); // Redirect to specific collapse
//     }

//     try {
//         // Update Customers table
//         const [result] = await db.query('UPDATE Customers SET role = ? WHERE customer_id = ?', [role, customerId]);
//         if (result.affectedRows === 0) {
//             req.flash('error', 'User not found or role already set.');
//         } else {
//             req.flash('success', `User role updated to ${role} successfully!`);
//         }
//         res.redirect('/customers');
//     } catch (err) {
//         console.error('Error updating user role:', err);
//         req.flash('error', 'Failed to update user role.');
//         req.flash('editUserData', { customer_id: customerId, ...req.body }); // Re-populate on error
//         res.redirect(`/customers#editUserCollapse-${customerId}`); // Redirect to specific collapse
//     }
// });


// // DELETE route for customers: Allows admins to delete customers
// app.post('/customers/delete/:id', checkAuthenticated, checkAdmin, async (req, res) => {
//     const customerId = req.params.id; // Using customer_id

//     try {
//         // Delete related records first due to foreign key constraints
//         await db.query('DELETE FROM Cart WHERE customer_id = ?', [customerId]);
//         await db.query('DELETE FROM Payments WHERE customer_id = ?', [customerId]);

//         // Delete from Customers table
//         const [result] = await db.query('DELETE FROM Customers WHERE customer_id = ?', [customerId]);
//         if (result.affectedRows === 0) {
//             req.flash('error', 'Customer not found.');
//             return res.status(404).redirect('/customers');
//         }
//         req.flash('success', 'Customer deleted successfully!');
//         res.redirect('/customers');
//     } catch (err) {
//         console.error('Error deleting customer:', err);
//         req.flash('error', 'Error deleting customer.');
//         res.status(500).redirect('/customers');
//     }
// });

// // Add Item form: Renders form to add a book to the cart
// app.get('/cart/new', checkAuthenticated, async (req, res) => {
//     try {
//         const [books] = await db.query('SELECT book_id, title FROM Books');
//         res.render('create_cart_item', {
//             user: req.session.user,
//             books: books
//         });
//     } catch (err) {
//         console.error('Error loading create cart item form:', err);
//         req.flash('error', 'Could not load cart item form.');
//         res.redirect('/dashboard');
//     }
// });

// // Handle form POST: Adds book to the user's cart
// app.post('/cart', checkAuthenticated, async (req, res) => {
//     const { book_id, quantity } = req.body;
//     const customer_id = req.session.user.customer_id; // Using customer_id

//     try {
//         await db.query(
//             'INSERT INTO Cart (customer_id, book_id, quantity) VALUES (?,?,?)',
//             [customer_id, book_id, quantity]
//         );
//         req.flash('success', 'Book added to cart successfully!');
//         res.redirect('/dashboard');
//     } catch (err) {
//         console.error('Error adding to cart:', err);
//         req.flash('error', 'Could not add to cart. Please try again.');
//         res.redirect('/cart/new');
//     }
// });

// // DELETE route for items in the cart
// app.post('/cart/delete/:id', checkAuthenticated, async (req, res) => {
//     const cartItemId = req.params.id;
//     const customerId = req.session.user.customer_id; // Using customer_id

//     try {
//         // Ensure only the owner of the cart item can delete it
//         const [result] = await db.query(
//             'DELETE FROM Cart WHERE cart_item_id = ? AND customer_id = ?',
//             [cartItemId, customerId]
//         );

//         if (result.affectedRows === 0) {
//             req.flash('error', 'Cart item not found or you do not have permission to delete it.');
//             return res.status(404).redirect('/dashboard');
//         }

//         req.flash('success', 'Cart item deleted successfully!');
//         res.redirect('/dashboard');
//     } catch (error) {
//         console.error('Error deleting cart item:', error);
//         req.flash('error', 'Error deleting cart item.');
//         res.status(500).redirect('/dashboard');
//     }
// });

// // User Profile Routes
// app.get('/profile', checkAuthenticated, async (req, res) => {
//     try {
//         // Select from Customers table
//         const [customerProfile] = await db.query('SELECT username, email, address, phone_number, first_name, last_name FROM Customers WHERE customer_id = ?', [req.session.user.customer_id]);
//         if (!customerProfile[0]) {
//             req.flash('error', 'User profile not found.');
//             return res.redirect('/dashboard');
//         }
//         res.render('profile', { user: req.session.user, profileData: customerProfile[0] });
//     } catch (err) {
//         console.error('Error loading profile:', err);
//         req.flash('error', 'Could not load profile data.');
//         res.redirect('/dashboard');
//     }
// });

// app.post('/profile/update', checkAuthenticated, async (req, res) => {
//     const { username, email, address, contact, first_name, last_name, currentPassword, newPassword } = req.body;
//     const customerId = req.session.user.customer_id; // Using customer_id
//     const errors = [];

//     try {
//         // Verify current password if changing email/password
//         const [customerCheck] = await db.query('SELECT password_hash FROM Customers WHERE customer_id = ?', [customerId]);
//         const storedHash = customerCheck[0].password_hash;

//         if (currentPassword && storedHash !== crypto.createHash('sha1').update(currentPassword).digest('hex')) {
//             errors.push('Incorrect current password.');
//         }

//         // Prepare update fields
//         let updateSql = 'UPDATE Customers SET '; // Update Customers table
//         const updateParams = [];
//         const updateFields = [];

//         if (username && username !== req.session.user.username) {
//             updateFields.push('username = ?');
//             updateParams.push(username);
//         }
//         if (email && email !== req.session.user.email) {
//             // Check if new email already exists in Customers table
//             const [emailExists] = await db.query('SELECT customer_id FROM Customers WHERE email = ? AND customer_id != ?', [email, customerId]);
//             if (emailExists.length > 0) {
//                 errors.push('New email already in use by another account.');
//             } else {
//                 updateFields.push('email = ?');
//                 updateParams.push(email);
//             }
//         }
//         // Added first_name and last_name to update fields
//         if (first_name && first_name !== req.session.user.first_name) {
//             updateFields.push('first_name = ?');
//             updateParams.push(first_name);
//         }
//         if (last_name && last_name !== req.session.user.last_name) {
//             updateFields.push('last_name = ?');
//             updateParams.push(last_name);
//         }

//         if (address && address !== req.session.user.address) {
//             updateFields.push('address = ?');
//             updateParams.push(address);
//         }
//         if (contact && contact !== req.session.user.phone_number) { // Assuming 'contact' maps to 'phone_number'
//             updateFields.push('phone_number = ?');
//             updateParams.push(contact);
//         }

//         if (newPassword) {
//             const specialChars = ["`","~","!","@","#","$","%","^","&","*","-","+","=","_", "?", "/", "<", ">",".",",",":",";","(",")","{","}","[","]","|"];
//             const hasSpecialChar = specialChars.some(char => newPassword.includes(char));
//             const hasCapital = /[A-Z]/.test(newPassword);

//             if (newPassword.length < 8 || !hasCapital || !hasSpecialChar) {
//                 let passwordError = 'New password must be at least 8 characters long';
//                 if (!hasCapital) {
//                     passwordError += ', include at least one capital letter';
//                 }
//                 if (!hasSpecialChar) {
//                     passwordError += ', and include at least one special character: `~!@#$%^&*-_+=`?/<>.,:;(){}[]|';
//                 }
//                 passwordError += '.';
//                 errors.push(passwordError);
//             } else {
//                 updateFields.push('password_hash = SHA1(?)');
//                 updateParams.push(newPassword);
//             }
//         }

//         if (errors.length > 0) {
//             req.flash('error', errors);
//             return res.redirect('/profile');
//         }

//         if (updateFields.length > 0) {
//             updateSql += updateFields.join(', ') + ' WHERE customer_id = ?';
//             updateParams.push(customerId);
//             await db.query(updateSql, updateParams);

//             // Update session user data to reflect changes immediately
//             // Select from Customers table
//             const [updatedCustomer] = await db.query('SELECT customer_id, username, email, role, address, phone_number, first_name, last_name FROM Customers WHERE customer_id = ?', [customerId]);
//             req.session.user = updatedCustomer[0];
//             req.flash('success', 'Profile updated successfully!');
//         } else {
//             req.flash('info', 'No changes detected.'); // Use 'info' for no changes
//         }
//         res.redirect('/profile');

//     } catch (err) {
//         console.error('Error updating profile:', err);
//         if (err.code === 'ER_DUP_ENTRY') {
//             req.flash('error', 'Username or email already exists.');
//         } else {
//             req.flash('error', 'Failed to update profile. Please try again.');
//         }
//         res.redirect('/profile');
//     }
// });


// // Logout Route: Destroys user session and redirects to home.
// app.get('/logout', (req, res) => {
//     req.session.destroy(err => {
//         if (err) {
//             console.error('Error destroying session:', err);
//         }
//         res.redirect('/');
//     });
// });


// // Starting the server
// const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => {
//     console.log(`Server started on http://localhost:${PORT}`);
// });
