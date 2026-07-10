/**
 * One-time helper: promotes an existing account to admin so it can access
 * the admin dashboard. Create your normal account on the website first,
 * then run this from the backend folder:
 *
 *   node make-admin.js you@example.com
 */
const db = require('./db');

const email = process.argv[2];

if (!email) {
  console.error('Usage: node make-admin.js your@email.com');
  process.exit(1);
}

const user = db.prepare('SELECT id, full_name, email, is_admin FROM users WHERE email = ?').get(email.toLowerCase().trim());

if (!user) {
  console.error(`No account found with email "${email}". Create the account on the website first, then run this script.`);
  process.exit(1);
}

if (user.is_admin) {
  console.log(`${user.email} is already an admin.`);
  process.exit(0);
}

db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(user.id);
console.log(`Done — ${user.full_name} (${user.email}) is now an admin. They can log in at /admin.html with their normal password.`);
