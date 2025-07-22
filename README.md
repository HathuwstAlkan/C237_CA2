C237 CA2 Bookstore Web Application

## What's completed
1. Git Initialization and Initial Commit: Project repository set up and initial code pushed.
2. Database Setup: MySQL database (C237CA2_paidplant) configured on filess.io with users, Books, and Cart tables created and dummy data inserted.
3. User Authentication (Partial):
    Login and Register routes implemented.
    Session management with express-session and connect-flash for messages.
    Password hashing using SHA1
4. Role-Based Authorization Middleware: checkAuthenticated and checkAdmin middleware functions implemented.
5. User/Customer Management (Admin-only):
6. View All Users/Customers (/customers route) implemented and protected by checkAuthenticated and checkAdmin.
7. Delete User/Customer (/customers/delete/:id route) implemented and protected by checkAuthenticated and checkAdmin.
8. Cart Functionality (Partial):
    "Add Item to Cart" form (/cart/new route) implemented and protected by checkAuthenticated.
    POST route (/cart) to add items to the Cart table implemented and protected by checkAuthenticated.

## What's still in progress
1. Full CRUD for Main Resource (Books/Cart Items): Implement view, edit, and delete for cart items.
2. User Profile Management: Allow logged-in users to edit their own profiles.
3. Search/Filter: Add server-side search or filter for books/users.
4. Frontend UI: Improve responsiveness, user-friendliness, and navigation across all EJS views.
5. Admin Features: Implement CRUD operations for Books.

## Any blockers
1. Cannot export SQL file due to max_user_connections
2. ghost area for some extracts of code due to lack of space 
3. Lack of experience with filess.io and github leading to inefficiency