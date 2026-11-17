# DZ Auto Flow — Admin panel

Private admin dashboard for the DZ Auto Flow Chrome extension.

- See every user: email, plan, status, prompts, last seen
- Change plan (Free / Pro with duration), block / unblock, reset password, add notes, delete
- Approve or reject Pro requests sent from the extension
- Read user feedback, export users to CSV

Only accounts listed as admins in the database can open the dashboard. The key in `config.js` is the
public (anon) key; every admin action is checked on the server.
